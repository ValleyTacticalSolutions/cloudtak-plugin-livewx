/**
 * METAR from the AWC minute cache (not the bbox API).
 * Respects AWC guidance: prefer cache files, ≤100 req/min, avoid per-pan queries.
 * https://aviationweather.gov/data/api/
 */
import { fetchBytes } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { firstSymbolLayer, mapOf } from '../core/map-host.ts';
import { PLANE_TILT_ICON, ensureMapIcons, removeMapIcons } from '../core/map-icons.ts';
import { state } from '../core/state.ts';
import { formatStationLocal, timeZoneAt } from '../core/timezone.ts';
import { convertPressure, convertTemp, type UnitSystem } from '../core/units.ts';
import { escapeHtml, registerFeatureLayers, unregisterFeatureLayers } from './feature-popup.ts';
import { mapEnvelope } from './geo-layer.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
} from './registry.ts';

const CACHE_URL = 'https://aviationweather.gov/data/cache/metars.cache.csv.gz';
/** Cache file updates once a minute — never hit AWC more often than that. */
const MIN_FETCH_GAP_MS = 60_000;
/** METAR usually updates hourly; refresh a few times per hour is plenty. */
const POLL_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 120_000;
const BACKOFF_MAX_MS = 15 * 60_000;
const SOURCE_ID = 'livewx-metar-src';
const CIRCLE_ID = 'livewx-metar-circle';
const ICON_ID = 'livewx-metar-icon';
/** Circle + icon layers; clicks on either open the popup. */
const POPUP_IDS = [CIRCLE_ID, ICON_ID];
/** Station ID labels appear from this zoom (thousands of stations nationwide). */
const LABEL_MIN_ZOOM = 6;

const FLIGHT_COLORS = [
    'match',
    ['get', 'fltcat'],
    'VFR', '#2f9e44',
    'MVFR', '#1971c2',
    'IFR', '#e03131',
    'LIFR', '#9c36b5',
    '#868e96',
] as unknown[];

type MetarRow = {
    id: string;
    lon: number;
    lat: number;
    props: Record<string, unknown>;
};

type Cloud = { cover?: string; base?: number | null };

let running = false;
let allRows: MetarRow[] = [];
let visible: FeatureCollection = emptyFc();
let lastError = '';
let lastFetchAt = 0;
let backoffUntil = 0;
let backoffMs = BACKOFF_BASE_MS;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let moveHandler: (() => void) | null = null;
let abort: AbortController | null = null;
let fetchInFlight: Promise<void> | null = null;

function asNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
}

function asStr(v: unknown): string {
    if (v == null) return '';
    return String(v).trim();
}

function parseClouds(raw: unknown): Cloud[] {
    if (Array.isArray(raw)) return raw as Cloud[];
    if (typeof raw === 'string' && raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? parsed as Cloud[] : [];
        } catch {
            return [];
        }
    }
    return [];
}

/** GeoJSON cloud bases are hundreds of feet; cache CSV uses feet AGL. */
function cloudBaseFt(base: number): number {
    return base > 0 && base < 1000 ? base * 100 : base;
}

/** METAR wind stays in knots (same as the raw observation). */
function windText(props: Record<string, unknown>): string {
    const dir = asStr(props.wdir);
    const spd = asNum(props.wspd);
    const gst = asNum(props.wgst);
    if (spd == null && !dir) return '—';
    const dirPart = !dir || dir === 'VRB' || dir === '0' || dir === '000'
        ? (spd === 0 ? 'Calm' : 'Variable')
        : `${dir}°`;
    if (dirPart === 'Calm' && (spd === 0 || spd == null)) return 'Calm';
    const spdLabel = spd == null ? '' : `${Math.round(spd)} kt`;
    let out = dirPart === 'Variable' || dirPart === 'Calm'
        ? `${dirPart}${spdLabel ? ` ${spdLabel}` : ''}`
        : `${dirPart} at ${spdLabel || '—'}`;
    if (gst != null) out += `, gusting ${Math.round(gst)} kt`;
    return out;
}

function skyText(props: Record<string, unknown>): string {
    const clouds = parseClouds(props.clouds);
    if (clouds.length) {
        return clouds.map((c) => {
            const cover = asStr(c.cover) || '—';
            const base = asNum(c.base);
            if (base == null) return cover;
            return `${cover} ${cloudBaseFt(base)} ft`;
        }).join(', ');
    }
    const cover = asStr(props.cover);
    const ceil = asNum(props.ceil);
    if (!cover && ceil == null) return '—';
    if (ceil != null) return `${cover || 'Ceiling'} ${cloudBaseFt(ceil)} ft`;
    return cover || '—';
}

function altimText(props: Record<string, unknown>, units: UnitSystem): string {
    const hPa = asNum(props.altim);
    if (hPa == null) return '—';
    const p = convertPressure(hPa, units);
    return `${p.value} ${p.unit}`;
}

/** Always show °C and °F (METAR source values are Celsius). */
function bothTemps(celsius: number): string {
    const c = convertTemp(celsius, 'metric');
    const f = convertTemp(celsius, 'us');
    return `${c.value}${c.unit} (${f.value}${f.unit})`;
}

function tempPair(props: Record<string, unknown>): string {
    const t = asNum(props.temp);
    const d = asNum(props.dewp);
    if (t == null && d == null) return '—';
    const parts: string[] = [];
    if (t != null) parts.push(bothTemps(t));
    if (d != null) parts.push(`dewpoint ${bothTemps(d)}`);
    return parts.join(' / ');
}

/** Decoded METAR card with raw text underneath. Observation time is station-local. */
export async function metarDetailHtml(props: Record<string, unknown>): Promise<string> {
    const units = state.units;
    const id = asStr(props.id) || 'METAR';
    const site = asStr(props.site);
    const raw = asStr(props.rawOb);
    const when = asStr(props.obsTime);
    const lat = asNum(props.lat);
    const lon = asNum(props.lon);
    let whenLabel = '—';
    if (when) {
        const ms = Date.parse(when);
        if (Number.isFinite(ms)) {
            const tz = (lat != null && lon != null) ? await timeZoneAt(lat, lon) : '';
            whenLabel = formatStationLocal(ms, tz);
        }
    }
    const flt = asStr(props.fltcat) || '—';
    const vis = asStr(props.visib) || '—';
    const wx = asStr(props.wx) || 'None';

    const rows: Array<[string, string]> = [
        ['Flight category', flt],
        ['Observed', whenLabel],
        ['Wind', windText(props)],
        ['Visibility', vis === '—' ? '—' : `${vis} SM`],
        ['Weather', wx],
        ['Sky', skyText(props)],
        ['Temperature', tempPair(props)],
        ['Altimeter', altimText(props, units)],
    ];

    const dl = rows.map(([k, v]) =>
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`,
    ).join('');

    const title = site ? `${id} — ${site}` : id;
    return `<div class="livewx-alert-card">
<div class="livewx-alert-eyebrow">METAR</div>
<div class="livewx-alert-title">${escapeHtml(title)}</div>
<dl class="livewx-alert-dl">${dl}</dl>
${raw ? `<div class="livewx-metar-raw">
<div class="livewx-metar-raw-label">Raw</div>
<pre class="livewx-metar-raw-text">${escapeHtml(raw)}</pre>
</div>` : ''}
</div>`;
}

async function gunzipText(buf: ArrayBuffer): Promise<string> {
    // A proxy may already have unpacked the .gz; plain text has no gzip magic bytes.
    const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    if (head[0] !== 0x1f || head[1] !== 0x8b) return new TextDecoder().decode(buf);
    const DS = (globalThis as unknown as {
        DecompressionStream?: new (format: string) => GenericTransformStream;
    }).DecompressionStream;
    if (!DS) throw new Error('Gzip decompress not supported in this browser');
    const stream = new Response(buf).body?.pipeThrough(new DS('gzip'));
    if (!stream) throw new Error('Gzip decompress failed');
    return new Response(stream).text();
}

/** RFC-style CSV split that keeps quoted commas intact. */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    out.push(cur);
    return out;
}

function uniqueHeaders(headers: string[]): string[] {
    const counts = new Map<string, number>();
    return headers.map((h) => {
        const key = h.trim();
        const n = counts.get(key) ?? 0;
        counts.set(key, n + 1);
        return n === 0 ? key : `${key}_${n}`;
    });
}

function parseCacheCsv(text: string): MetarRow[] {
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) return [];
    const headers = uniqueHeaders(splitCsvLine(lines[0]));
    const idx = (name: string) => headers.indexOf(name);
    const iId = idx('station_id');
    const iLat = idx('latitude');
    const iLon = idx('longitude');
    const iRaw = idx('raw_text');
    const iTime = idx('observation_time');
    const iTemp = idx('temp_c');
    const iDew = idx('dewpoint_c');
    const iWdir = idx('wind_dir_degrees');
    const iWspd = idx('wind_speed_kt');
    const iWgst = idx('wind_gust_kt');
    const iVis = idx('visibility_statute_mi');
    const iAltim = idx('altim_in_hg');
    const iWx = idx('wx_string');
    const iCat = idx('flight_category');
    const skyPairs: Array<{ cover: number; base: number }> = [];
    for (const h of headers) {
        if (!h.startsWith('sky_cover')) continue;
        const suffix = h.slice('sky_cover'.length); // '' | '_1' | '_2'
        const baseName = `cloud_base_ft_agl${suffix}`;
        const coverI = idx(h);
        const baseI = idx(baseName);
        if (coverI >= 0) skyPairs.push({ cover: coverI, base: baseI });
    }

    const rows: MetarRow[] = [];
    for (let li = 1; li < lines.length; li++) {
        const cols = splitCsvLine(lines[li]);
        const id = (cols[iId] || '').trim();
        const lat = Number(cols[iLat]);
        const lon = Number(cols[iLon]);
        if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const clouds: Cloud[] = [];
        for (const p of skyPairs) {
            const cover = (cols[p.cover] || '').trim();
            if (!cover) continue;
            const baseRaw = p.base >= 0 ? Number(cols[p.base]) : NaN;
            clouds.push({
                cover,
                base: Number.isFinite(baseRaw) ? baseRaw : null,
            });
        }
        const inHg = Number(cols[iAltim]);
        const altimHpa = Number.isFinite(inHg) ? inHg * 33.863886 : null;
        rows.push({
            id,
            lat,
            lon,
            props: {
                id,
                lat,
                lon,
                rawOb: (cols[iRaw] || '').trim(),
                obsTime: (cols[iTime] || '').trim(),
                temp: cols[iTemp] || '',
                dewp: cols[iDew] || '',
                wdir: (cols[iWdir] || '').trim(),
                wspd: cols[iWspd] || '',
                wgst: cols[iWgst] || '',
                visib: (cols[iVis] || '').trim(),
                altim: altimHpa == null ? '' : String(altimHpa),
                wx: (cols[iWx] || '').trim(),
                fltcat: (cols[iCat] || '').trim() || 'UNK',
                clouds: clouds.length ? JSON.stringify(clouds) : '',
                cover: clouds[0]?.cover || '',
            },
        });
    }
    return rows;
}

function bounds(): { west: number; south: number; east: number; north: number } | null {
    const env = mapEnvelope();
    if (!env) return null;
    const [west, south, east, north] = env.split(',').map(Number);
    if ([west, south, east, north].some((n) => !Number.isFinite(n))) return null;
    return { west, south, east, north };
}

function filterVisible(): FeatureCollection {
    const b = bounds();
    const features = [];
    for (const row of allRows) {
        if (b) {
            // Handle antimeridian simply: skip wrap for now; CONUS-safe.
            if (row.lon < b.west || row.lon > b.east || row.lat < b.south || row.lat > b.north) {
                continue;
            }
        }
        features.push({
            type: 'Feature' as const,
            id: row.id,
            geometry: { type: 'Point' as const, coordinates: [row.lon, row.lat] },
            properties: row.props,
        });
    }
    return { type: 'FeatureCollection', features };
}

function paint(map: LiveWxMap): void {
    ensureGeoJsonSource(map, SOURCE_ID, visible);
    const before = firstSymbolLayer(map);
    if (!map.getLayer(CIRCLE_ID)) {
        map.addLayer({
            id: CIRCLE_ID,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': 11,
                // Flight category colors (VFR / MVFR / IFR / LIFR / unknown).
                'circle-color': FLIGHT_COLORS,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff',
            },
        }, before);
    }
    // Style swaps drop images, so (re-)add the icon on every paint.
    if (ensureMapIcons(map, [PLANE_TILT_ICON]) && !map.getLayer(ICON_ID)) {
        map.addLayer({
            id: ICON_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'icon-image': PLANE_TILT_ICON.id,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                // Station ID (e.g. KFLG); overlapping labels are hidden, the icon stays.
                'text-field': ['step', ['zoom'], '', LABEL_MIN_ZOOM, ['get', 'id']],
                'text-size': 12,
                'text-offset': [0, 1.35],
                'text-anchor': 'top',
                'text-optional': true,
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#0f172a',
                'text-halo-width': 1.5,
            },
        });
    }
}

function applyVisible(): void {
    visible = filterVisible();
    const map = mapOf();
    if (map && running) paint(map);
    refreshStatus('metars');
}

async function fetchCache(force = false): Promise<void> {
    if (!running) return;
    const now = Date.now();
    if (!force && now < backoffUntil) {
        lastError = `Rate limited — retry in ${Math.ceil((backoffUntil - now) / 1000)}s`;
        refreshStatus('metars');
        return;
    }
    if (!force && lastFetchAt && now - lastFetchAt < MIN_FETCH_GAP_MS) {
        applyVisible();
        return;
    }
    if (fetchInFlight) {
        await fetchInFlight;
        return;
    }

    abort?.abort();
    abort = new AbortController();
    const ac = abort;

    fetchInFlight = (async () => {
        try {
            const buf = await fetchBytes(CACHE_URL, { signal: ac.signal });
            const text = await gunzipText(buf);
            allRows = parseCacheCsv(text);
            lastFetchAt = Date.now();
            lastError = '';
            backoffMs = BACKOFF_BASE_MS;
            backoffUntil = 0;
            applyVisible();
        } catch (e) {
            if (ac.signal.aborted) return;
            const msg = e instanceof Error ? e.message : 'Fetch failed';
            if (/429|Too Many Requests/i.test(msg)) {
                backoffUntil = Date.now() + backoffMs;
                lastError = `Rate limited — backing off ${Math.round(backoffMs / 1000)}s`;
                backoffMs = Math.min(BACKOFF_MAX_MS, backoffMs * 2);
            } else if (/403|Forbidden/i.test(msg)) {
                backoffUntil = Date.now() + BACKOFF_MAX_MS;
                lastError = 'Blocked by AWC — try again later';
            } else {
                lastError = msg;
            }
            // Keep prior dots if we have them.
            if (allRows.length) applyVisible();
            else refreshStatus('metars');
        } finally {
            fetchInFlight = null;
        }
    })();

    await fetchInFlight;
}

function bindMove(): void {
    const map = mapOf();
    if (!map || moveHandler) return;
    moveHandler = () => {
        if (moveTimer) clearTimeout(moveTimer);
        // Local filter only — no network on pan/zoom.
        moveTimer = setTimeout(() => {
            if (running) applyVisible();
        }, 120);
    };
    map.on('moveend', moveHandler);
}

function unbindMove(): void {
    if (moveTimer) {
        clearTimeout(moveTimer);
        moveTimer = null;
    }
    const map = mapOf();
    if (map && moveHandler) {
        try { map.off('moveend', moveHandler); } catch { /* ignore */ }
    }
    moveHandler = null;
}

export function registerMetarLayer(): void {
    registerLayer({
        id: 'metars',
        group: 'more',
        label: 'METAR',
        description: 'Airport METAR (AWC cache)',
        hosts: ['aviationweather.gov', 'api.weather.gov'],
        sends: 'Minute cache',
        start: async () => {
            running = true;
            registerFeatureLayers(POPUP_IDS, {
                label: 'METAR',
                detailHtml: metarDetailHtml,
            });
            bindMove();
            await fetchCache(true);
            if (!running) return;
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(() => { void fetchCache(false); }, POLL_MS);
        },
        stop: () => {
            running = false;
            abort?.abort();
            abort = null;
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            unbindMove();
            unregisterFeatureLayers(POPUP_IDS);
            const map = mapOf();
            if (map) {
                removeLayerSafe(map, ICON_ID);
                removeLayerSafe(map, CIRCLE_ID);
                removeMapIcons(map, [PLANE_TILT_ICON]);
                removeSourceSafe(map, SOURCE_ID);
            }
            allRows = [];
            visible = emptyFc();
            lastError = '';
        },
        restore: (map) => {
            if (!running) return;
            registerFeatureLayers(POPUP_IDS, {
                label: 'METAR',
                detailHtml: metarDetailHtml,
            });
            bindMove();
            visible = filterVisible();
            paint(map);
        },
        status: () => {
            if (lastError) return lastError;
            if (!running) return 'Off';
            return `${visible.features.length} station${visible.features.length === 1 ? '' : 's'}`;
        },
    });
}
