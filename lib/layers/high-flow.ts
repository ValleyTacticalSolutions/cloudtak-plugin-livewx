/**
 * Streams Running High: tap details and an in-view summary for the NWM
 * high-flow layers. The lines themselves are raster tiles (catalog.ts); a tap
 * queries the service for the nearest reach and shows its numbers.
 */
import { NWM_SERVICES } from '../core/constants.ts';
import { fetchJson } from '../core/egress.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { pointUi } from '../core/point.ts';
import { state } from '../core/state.ts';
import { convertFlow } from '../core/units.ts';
import { escapeHtml, hitsFeaturePopupLayers, showFeatureHtml } from './feature-popup.ts';
import { mapEnvelope } from './geo-layer.ts';
import { refreshStatus } from './registry.ts';

export type HighFlowId = 'high_flow_now' | 'high_flow_5day';

/**
 * The service's grades (annual exceedance probability of a flow that big),
 * rarest first, in the service's own colors.
 */
export const HIGH_FLOW_GRADES = [
    { value: '2', label: '1-in-50-year flow or worse', short: '1-in-50-year flow', color: '#ff00e5' },
    { value: '4', label: '1-in-25-year flow', short: '1-in-25-year flow', color: '#9e00ff' },
    { value: '10', label: '1-in-10-year flow', short: '1-in-10-year flow', color: '#1400ff' },
    { value: '20', label: '1-in-5-year flow', short: '1-in-5-year flow', color: '#2ec6ff' },
    { value: '50', label: '1-in-2-year flow', short: '1-in-2-year flow', color: '#39efff' },
    { value: '>50', label: 'Over the high-water mark', short: 'over the high-water mark', color: '#b4fff2' },
    { value: '', label: 'Running high, size not known', short: 'size not known', color: '#bdc2bb' },
] as const;

type Grade = (typeof HIGH_FLOW_GRADES)[number];

const HORIZONS: Record<HighFlowId, {
    label: string;
    service: string;
    flowField: string;
    catField: string;
    flowLabel: string;
    /** Phrase for the summary line. */
    when: string;
    validField?: string;
}> = {
    high_flow_now: {
        label: 'Streams Running High (Now)',
        service: 'ana_high_flow_magnitude',
        flowField: 'max_flow',
        catField: 'recur_cat',
        flowLabel: 'Flow now',
        when: 'now',
        validField: 'valid_time',
    },
    high_flow_5day: {
        label: 'Streams Running High (5 Days)',
        service: 'mrf_nbm_5day_max_high_flow_magnitude',
        flowField: 'maxflow_5day_cfs',
        catField: 'recur_cat_5day',
        flowLabel: 'Peak flow, next 5 days',
        when: 'in the next 5 days',
    },
};

/** Return-period flows, commonest first. */
const RETURN_FLOWS = [
    ['flow_2yr', '1-in-2-year flow'],
    ['flow_5yr', '1-in-5-year flow'],
    ['flow_10yr', '1-in-10-year flow'],
    ['flow_25yr', '1-in-25-year flow'],
    ['flow_50yr', '1-in-50-year flow'],
] as const;

/** How far from a tap (in screen pixels) a line still counts as tapped. */
const TAP_TOLERANCE_PX = 8;
const SUMMARY_DEBOUNCE_MS = 800;

const active = new Set<HighFlowId>();
const summaries = new Map<HighFlowId, string>();
const summaryGen = new Map<HighFlowId, number>();
let boundMap: LiveWxMap | null = null;
let summaryTimer: ReturnType<typeof setTimeout> | null = null;

type Props = Record<string, unknown>;
type ReachFeature = {
    properties?: Props;
    geometry?: { type: string; coordinates: unknown } | null;
};

function layerUrl(id: HighFlowId): string {
    return `${NWM_SERVICES}/${HORIZONS[id].service}/MapServer/0/query`;
}

export function gradeOf(raw: unknown): Grade {
    const v = typeof raw === 'string' ? raw.trim() : '';
    return HIGH_FLOW_GRADES.find((g) => g.value === v) ?? HIGH_FLOW_GRADES[HIGH_FLOW_GRADES.length - 1];
}

function gradeDetail(g: Grade): string {
    if (g.value === '>50') return 'Over the high-water mark (under a 1-in-2-year flow)';
    return g.label;
}

function flowText(raw: unknown): string | null {
    const cfs = Number(raw);
    if (raw == null || raw === '' || !Number.isFinite(cfs)) return null;
    const { value, unit } = convertFlow(cfs, state.units);
    const shown = Math.abs(value) < 10
        ? value.toFixed(1)
        : Math.round(value).toLocaleString();
    return `${shown} ${unit}`;
}

/** Service times are UTC strings like "2026-10-30 20:00:00" (sometimes with " UTC"). */
function timeText(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const iso = `${raw.replace(/\s*UTC$/i, '').trim().replace(' ', 'T')}Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function reachName(props: Props): string {
    const name = typeof props.name === 'string' ? props.name.trim() : '';
    return !name || /^unnamed stream$/i.test(name) ? 'Unnamed stream' : name;
}

function reachHtml(id: HighFlowId, props: Props): string {
    const h = HORIZONS[id];
    const grade = gradeOf(props[h.catField]);
    const rows: Array<[string, string | null]> = [
        ['How high', gradeDetail(grade)],
        [h.flowLabel, flowText(props[h.flowField])],
        ['High-water mark', flowText(props.high_water_threshold)],
        ...RETURN_FLOWS.map(([key, label]) => [label, flowText(props[key])] as [string, string | null]),
        ['Stream size', props.strm_order != null ? `order ${props.strm_order} (1 is the smallest headwater)` : null],
        ['Valid', h.validField ? timeText(props[h.validField]) : null],
        ['Model run', timeText(props.reference_time)],
        ['State', typeof props.state === 'string' ? props.state : null],
        ['Stream ID', props.feature_id != null ? String(props.feature_id) : null],
        ['Source', 'NWS National Water Model (experimental). A computed flow, not a gauge reading.'],
    ];
    const dl = rows
        .filter((r): r is [string, string] => Boolean(r[1]))
        .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
        .join('');
    return [
        '<div class="livewx-alert-card">',
        `<div class="livewx-alert-eyebrow">${escapeHtml(h.label)}</div>`,
        `<div class="livewx-alert-title">${escapeHtml(`${reachName(props)} (${grade.short})`)}</div>`,
        `<dl class="livewx-alert-dl">${dl}</dl>`,
        '</div>',
    ].join('');
}

/** Ground meters per screen pixel at a latitude (MapLibre uses 512 px tiles). */
function metersPerPixel(map: LiveWxMap, lat: number): number {
    const zoom = map.getZoom?.() ?? 8;
    return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Distance in meters from a point to a (Multi)LineString, equirectangular. */
function distanceTo(geom: ReachFeature['geometry'], lng: number, lat: number): number {
    if (!geom) return Infinity;
    const lines = (geom.type === 'MultiLineString'
        ? geom.coordinates
        : [geom.coordinates]) as number[][][];
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110540;
    let best = Infinity;
    for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
            const ax = (line[i - 1][0] - lng) * kx;
            const ay = (line[i - 1][1] - lat) * ky;
            const bx = (line[i][0] - lng) * kx;
            const by = (line[i][1] - lat) * ky;
            const dx = bx - ax;
            const dy = by - ay;
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
            best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
        }
    }
    return best;
}

async function nearestReach(
    id: HighFlowId,
    lng: number,
    lat: number,
    radiusM: number,
): Promise<{ props: Props; dist: number } | null> {
    // Values stay unencoded — viaProxy encodes the whole URL once.
    const url = `${layerUrl(id)}?${[
        `geometry=${lng},${lat}`,
        'geometryType=esriGeometryPoint',
        'inSR=4326',
        `distance=${Math.round(radiusM)}`,
        'units=esriSRUnit_Meter',
        'spatialRel=esriSpatialRelIntersects',
        'outFields=*',
        'returnGeometry=true',
        'geometryPrecision=5',
        'outSR=4326',
        'f=geojson',
    ].join('&')}`;
    const fc = await fetchJson<{ features?: ReachFeature[] }>(url);
    let best: { props: Props; dist: number } | null = null;
    for (const f of fc.features ?? []) {
        const dist = distanceTo(f.geometry, lng, lat);
        if (!best || dist < best.dist) best = { props: f.properties ?? {}, dist };
    }
    return best;
}

function onClick(e: { lngLat?: { lng: number; lat: number }; point?: unknown }): void {
    if (pointUi.picking || !active.size || !e.lngLat) return;
    const map = mapOf();
    if (!map) return;
    // A LiveWX feature (gauge, METAR, …) under the tap gets its own popup.
    if (e.point != null && hitsFeaturePopupLayers(map, e.point)) return;
    const { lng, lat } = e.lngLat;
    const radius = Math.max(5, TAP_TOLERANCE_PX * metersPerPixel(map, lat));
    const ids = (['high_flow_now', 'high_flow_5day'] as const).filter((id) => active.has(id));
    void (async () => {
        let hit: { id: HighFlowId; props: Props; dist: number } | null = null;
        for (const id of ids) {
            try {
                const r = await nearestReach(id, lng, lat, radius);
                if (r && (!hit || r.dist < hit.dist)) hit = { id, ...r };
            } catch {
                /* no card on a failed lookup */
            }
        }
        if (hit) await showFeatureHtml(map, { lng, lat }, reachHtml(hit.id, hit.props));
    })();
}

async function updateSummary(id: HighFlowId): Promise<void> {
    const env = mapEnvelope();
    if (!env) return;
    const gen = (summaryGen.get(id) ?? 0) + 1;
    summaryGen.set(id, gen);
    const h = HORIZONS[id];
    const where = [
        `geometry=${env}`,
        'geometryType=esriGeometryEnvelope',
        'inSR=4326',
        'spatialRel=esriSpatialRelIntersects',
    ];
    try {
        const stats = await fetchJson<{ features?: Array<{ attributes?: Props }> }>(`${layerUrl(id)}?${[
            ...where,
            'where=1=1',
            'outStatistics=[{"statisticType":"count","onStatisticField":"oid","outStatisticFieldName":"n"}]',
            `groupByFieldsForStatistics=${h.catField}`,
            'f=json',
        ].join('&')}`);
        const counts = new Map<string, number>();
        let total = 0;
        for (const f of stats.features ?? []) {
            const n = Number(f.attributes?.n) || 0;
            const g = gradeOf(f.attributes?.[h.catField]);
            counts.set(g.value, (counts.get(g.value) ?? 0) + n);
            total += n;
        }
        let text: string;
        if (!total) {
            text = `No streams running high in view ${h.when}`;
        } else {
            const worst = HIGH_FLOW_GRADES.find((g) => counts.has(g.value)) ?? HIGH_FLOW_GRADES[0];
            // The biggest stream at the worst grade names the summary.
            const catWhere = worst.value
                ? `${h.catField}='${worst.value}'`
                : `${h.catField} NOT IN (${HIGH_FLOW_GRADES.filter((g) => g.value).map((g) => `'${g.value}'`).join(',')})`;
            // Most reaches are "Unnamed Stream"; name a real stream when one qualifies.
            const top = await fetchJson<{ features?: Array<{ attributes?: Props }> }>(`${layerUrl(id)}?${[
                ...where,
                `where=${catWhere} AND name <> 'Unnamed Stream'`,
                'outFields=name,strm_order',
                'orderByFields=strm_order DESC',
                'resultRecordCount=1',
                'returnGeometry=false',
                'f=json',
            ].join('&')}`);
            const name = reachName(top.features?.[0]?.attributes ?? {});
            const noun = total === 1 ? 'stream' : 'streams';
            text = `${total.toLocaleString()} ${noun} running high in view ${h.when}; worst: ${name}, ${worst.short}`;
        }
        if (summaryGen.get(id) !== gen || !active.has(id)) return;
        summaries.set(id, text);
    } catch {
        if (summaryGen.get(id) !== gen || !active.has(id)) return;
        summaries.set(id, 'In-view summary unavailable');
    }
    refreshStatus(id);
}

function onMoveEnd(): void {
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
        summaryTimer = null;
        for (const id of active) void updateSummary(id);
    }, SUMMARY_DEBOUNCE_MS);
}

function bind(map: LiveWxMap): void {
    if (boundMap === map) return;
    unbind();
    map.on('click', onClick);
    map.on('moveend', onMoveEnd);
    boundMap = map;
}

function unbind(): void {
    if (boundMap) {
        try { boundMap.off('click', onClick); } catch { /* ignore */ }
        try { boundMap.off('moveend', onMoveEnd); } catch { /* ignore */ }
    }
    boundMap = null;
    if (summaryTimer) {
        clearTimeout(summaryTimer);
        summaryTimer = null;
    }
}

/** Tap details and summary on; safe to call again after a map restore. */
export function startHighFlowExtras(id: HighFlowId): void {
    const map = mapOf();
    if (!map) return;
    const fresh = !active.has(id);
    active.add(id);
    bind(map);
    if (fresh) void updateSummary(id);
}

export function stopHighFlowExtras(id: HighFlowId): void {
    active.delete(id);
    summaries.delete(id);
    summaryGen.set(id, (summaryGen.get(id) ?? 0) + 1);
    if (!active.size) unbind();
}

export function highFlowStatus(id: HighFlowId): string {
    return summaries.get(id) ?? 'Finding streams running high in view…';
}
