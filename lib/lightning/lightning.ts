/**
 * Live Blitzortung strikes in the current map view via CloudTAK server relay.
 * Clients never connect to Blitzortung hosts (usage guidelines).
 * Display protocol adapted from https://github.com/cmlaird/CloudTAK-Plugin-Lightning (MIT).
 * Data: Blitzortung.org & contributors (CC BY-SA 4.0) — entertainment / SA only.
 */
import { apiFetch } from '../core/host.ts';
import { reactive } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import {
    BLITZ_RELAY_PATH,
    LIGHTNING_ICON_ID,
    LIGHTNING_LAYER_ID,
    LIGHTNING_LEGACY_CIRCLE_ID,
    LIGHTNING_SOURCE_ID,
} from '../core/constants.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { coverageForSiteId, kmBetween } from '../radar/sites.ts';
import { state } from '../core/state.ts';

export interface Strike {
    id: string;
    lat: number;
    lon: number;
    timeMs: number;
}

export interface VisibleStrike extends Strike {
    distMi: number;
    compass: string;
}

export const BLITZ_ATTRIBUTION = 'Lightning data © Blitzortung.org & contributors (CC BY-SA 4.0)';
export const BLITZ_DISCLAIMER = 'Entertainment / situational awareness only — not for life safety or official warning.';

const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

const PAD = 0.08;

export const lightning = reactive({
    connected: false,
    error: '',
    totalSeen: 0,
    strikes: [] as Strike[],
    inView: [] as VisibleStrike[],
    attribution: BLITZ_ATTRIBUTION,
    disclaimer: BLITZ_DISCLAIMER,
});

type GeoSource = { setData?: (data: unknown) => void };

let apiRef: PluginAPI | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let viewHandler: (() => void) | null = null;
let running = false;
let sinceMs = 0;

function mapOf(): LiveWxMap | null {
    try {
        return (apiRef?.map as unknown as LiveWxMap) ?? null;
    } catch {
        return null;
    }
}

function toRad(d: number): number {
    return d * Math.PI / 180;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3958.7613;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingCompass(lat1: number, lon1: number, lat2: number, lon2: number): string {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
        - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return COMPASS[Math.round(brg / 22.5) % 16];
}

function paddedBounds(): { west: number; east: number; south: number; north: number } | null {
    const map = mapOf();
    const b = map?.getBounds?.();
    if (!b) return null;
    const west = b.getWest();
    const east = b.getEast();
    const south = b.getSouth();
    const north = b.getNorth();
    const lngPad = Math.max(0.01, Math.abs(east - west) * PAD);
    const latPad = Math.max(0.01, Math.abs(north - south) * PAD);
    return {
        west: west - lngPad,
        east: east + lngPad,
        south: Math.max(-90, south - latPad),
        north: Math.min(90, north + latPad),
    };
}

function inBounds(lat: number, lon: number, box: { west: number; east: number; south: number; north: number }): boolean {
    if (lat < box.south || lat > box.north) return false;
    if (box.west <= box.east) return lon >= box.west && lon <= box.east;
    return lon >= box.west || lon <= box.east;
}

const BOLT_SIZE = 64;
const BOLT_SPREAD = 8;
const ICON_SIZE: unknown[] = [
    'interpolate', ['linear'], ['get', 'ageFrac'],
    0.0, 1.75,
    1.0, 1.2,
];
const AGE_COLOR: unknown[] = [
    'interpolate', ['linear'], ['get', 'ageFrac'],
    0.0, '#ffffff',
    0.25, '#ffec99',
    0.5, '#ffa94d',
    1.0, '#c92a2a',
];

function makeBoltSdf(): ImageData | null {
    const canvas = document.createElement('canvas');
    canvas.width = BOLT_SIZE;
    canvas.height = BOLT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, BOLT_SIZE, BOLT_SIZE);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(34, 4);
    ctx.lineTo(18, 30);
    ctx.lineTo(30, 30);
    ctx.lineTo(20, 60);
    ctx.lineTo(48, 26);
    ctx.lineTo(34, 26);
    ctx.lineTo(42, 4);
    ctx.closePath();
    ctx.fill();
    const src = ctx.getImageData(0, 0, BOLT_SIZE, BOLT_SIZE);
    const n = BOLT_SIZE * BOLT_SIZE;
    const inside = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        inside[i] = src.data[i * 4 + 3] > 127 ? 1 : 0;
    }
    const out = ctx.createImageData(BOLT_SIZE, BOLT_SIZE);
    for (let y = 0; y < BOLT_SIZE; y++) {
        for (let x = 0; x < BOLT_SIZE; x++) {
            const i = y * BOLT_SIZE + x;
            const isIn = inside[i] === 1;
            let minD = BOLT_SPREAD;
            const x0 = Math.max(0, x - BOLT_SPREAD);
            const x1 = Math.min(BOLT_SIZE - 1, x + BOLT_SPREAD);
            const y0 = Math.max(0, y - BOLT_SPREAD);
            const y1 = Math.min(BOLT_SIZE - 1, y + BOLT_SPREAD);
            for (let yy = y0; yy <= y1; yy++) {
                for (let xx = x0; xx <= x1; xx++) {
                    if (inside[yy * BOLT_SIZE + xx] === (isIn ? 1 : 0)) continue;
                    const d = Math.hypot(xx - x, yy - y);
                    if (d < minD) minD = d;
                }
            }
            const signed = isIn ? minD : -minD;
            const v = Math.round(Math.min(1, Math.max(0, 0.5 + 0.5 * (signed / BOLT_SPREAD))) * 255);
            const o = i * 4;
            out.data[o] = 255;
            out.data[o + 1] = 255;
            out.data[o + 2] = 255;
            out.data[o + 3] = v;
        }
    }
    return out;
}

function ensureBoltImage(map: LiveWxMap): boolean {
    if (map.hasImage?.(LIGHTNING_ICON_ID)) return true;
    const image = makeBoltSdf();
    if (!image || !map.addImage) return false;
    map.addImage(LIGHTNING_ICON_ID, image, { sdf: true, pixelRatio: 2 });
    return Boolean(map.hasImage?.(LIGHTNING_ICON_ID) ?? true);
}

function emptyCollection(): { type: 'FeatureCollection'; features: [] } {
    return { type: 'FeatureCollection', features: [] };
}

function cutoffMs(): number {
    return Date.now() - state.lightningStaleSec * 1000;
}

function pruneStrikes(): void {
    const cutoff = cutoffMs();
    if (lightning.strikes.length && lightning.strikes[0].timeMs < cutoff) {
        lightning.strikes = lightning.strikes.filter((s) => s.timeMs >= cutoff);
    }
}

function inSelectedRange(lat: number, lon: number): boolean {
    const cov = coverageForSiteId(state.siteId);
    if (!cov) return true;
    return kmBetween(cov.lat, cov.lon, lat, lon) <= cov.km;
}

function visibleStrikes(): VisibleStrike[] {
    const box = paddedBounds();
    const center = mapOf()?.getCenter?.();
    const list = lightning.strikes.filter((s) => (
        inSelectedRange(s.lat, s.lon)
        && (!box || inBounds(s.lat, s.lon, box))
    ));
    if (!center) {
        return list.map((s) => ({ ...s, distMi: 0, compass: '' }));
    }
    return list.map((s) => ({
        ...s,
        distMi: haversineMiles(center.lat, center.lng, s.lat, s.lon),
        compass: bearingCompass(center.lat, center.lng, s.lat, s.lon),
    }));
}

function renderStrikes(): void {
    const map = mapOf();
    const src = map?.getSource(LIGHTNING_SOURCE_ID) as GeoSource | undefined;
    if (!src?.setData) return;
    const now = Date.now();
    const staleMs = Math.max(1, state.lightningStaleSec) * 1000;
    const shown = visibleStrikes();
    lightning.inView = shown;
    src.setData({
        type: 'FeatureCollection',
        features: shown.map((s) => ({
            type: 'Feature',
            properties: {
                ageFrac: Math.min(1, Math.max(0, (now - s.timeMs) / staleMs)),
            },
            geometry: {
                type: 'Point',
                coordinates: [s.lon, s.lat],
            },
        })),
    });
}

function ensureLayers(): void {
    const map = mapOf();
    if (!map) return;
    try {
        if (map.getLayer(LIGHTNING_LEGACY_CIRCLE_ID)) {
            map.removeLayer(LIGHTNING_LEGACY_CIRCLE_ID);
        }
        if (!map.getSource(LIGHTNING_SOURCE_ID)) {
            map.addSource(LIGHTNING_SOURCE_ID, {
                type: 'geojson',
                data: emptyCollection(),
            });
        }
        if (!map.getLayer(LIGHTNING_LAYER_ID)) {
            const useIcon = ensureBoltImage(map);
            if (useIcon) {
                map.addLayer({
                    id: LIGHTNING_LAYER_ID,
                    type: 'symbol',
                    source: LIGHTNING_SOURCE_ID,
                    layout: {
                        'icon-image': LIGHTNING_ICON_ID,
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true,
                        'icon-anchor': 'center',
                        'icon-padding': 0,
                        'icon-size': ICON_SIZE,
                    },
                    paint: {
                        'icon-color': AGE_COLOR,
                        'icon-opacity': [
                            'interpolate', ['linear'], ['get', 'ageFrac'],
                            0.0, 1.0,
                            1.0, 0.45,
                        ],
                        'icon-halo-color': '#000000',
                        'icon-halo-width': 1.25,
                    },
                });
            } else {
                map.addLayer({
                    id: LIGHTNING_LAYER_ID,
                    type: 'circle',
                    source: LIGHTNING_SOURCE_ID,
                    paint: {
                        'circle-color': AGE_COLOR,
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'ageFrac'],
                            0.0, 12,
                            1.0, 7,
                        ],
                        'circle-opacity': [
                            'interpolate', ['linear'], ['get', 'ageFrac'],
                            0.0, 1.0,
                            1.0, 0.4,
                        ],
                        'circle-stroke-color': '#000000',
                        'circle-stroke-width': 1,
                    },
                });
            }
        } else {
            try { map.setLayoutProperty?.(LIGHTNING_LAYER_ID, 'icon-size', ICON_SIZE); } catch { /* ignore */ }
        }
        raiseLightning(map);
    } catch {
        /* style not ready */
    }
}

function raiseLightning(map: LiveWxMap): void {
    if (!map.getLayer(LIGHTNING_LAYER_ID)) return;
    try { map.moveLayer?.(LIGHTNING_LAYER_ID); } catch { /* ignore */ }
}

export function raiseLightningLayer(): void {
    const map = mapOf();
    if (map) raiseLightning(map);
}

function onViewChange(): void {
    if (!state.lightningEnabled) return;
    renderStrikes();
}

function bindView(): void {
    const map = mapOf();
    if (!map || viewHandler) return;
    viewHandler = onViewChange;
    map.on('moveend', viewHandler);
    map.on('zoomend', viewHandler);
}

function unbindView(): void {
    const map = mapOf();
    if (map && viewHandler) {
        try { map.off('moveend', viewHandler); } catch { /* ignore */ }
        try { map.off('zoomend', viewHandler); } catch { /* ignore */ }
    }
    viewHandler = null;
}

function onStrike(lat: number, lon: number, timeMs: number): void {
    const id = `${timeMs}-${Math.round(lat * 1e4)}-${Math.round(lon * 1e4)}`;
    if (lightning.strikes.some((s) => s.id === id)) return;
    lightning.totalSeen++;
    lightning.strikes.push({ id, lat, lon, timeMs });
    if (lightning.strikes.length > 5000) {
        lightning.strikes = lightning.strikes.slice(-4000);
    }
}

async function pollRelay(): Promise<void> {
    if (!running) return;
    try {
        const { refreshAuthToken } = await import('../core/auth-token.ts');
        await refreshAuthToken();
        const res = await apiFetch(`${BLITZ_RELAY_PATH}?since=${sinceMs}`, {
            raw: true,
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
            lightning.connected = false;
            lightning.error = res.status === 404
                ? 'Lightning relay not installed (run install.sh for server route)'
                : res.status === 401
                    ? 'Lightning relay HTTP 401 — session token missing; re-login'
                    : `Lightning relay HTTP ${res.status}`;
            return;
        }
        const body = await res.json() as {
            connected?: boolean;
            attribution?: string;
            disclaimer?: string;
            strikes?: Array<{ lat: number; lon: number; timeMs: number }>;
        };
        lightning.connected = Boolean(body.connected);
        if (body.attribution) lightning.attribution = body.attribution;
        if (body.disclaimer) lightning.disclaimer = body.disclaimer;
        lightning.error = lightning.connected ? '' : 'Relay upstream reconnecting…';
        for (const s of body.strikes ?? []) {
            if (typeof s.lat === 'number' && typeof s.lon === 'number') {
                onStrike(s.lat, s.lon, s.timeMs || Date.now());
                if (s.timeMs > sinceMs) sinceMs = s.timeMs;
            }
        }
        renderStrikes();
    } catch {
        lightning.connected = false;
        lightning.error = 'Lightning relay unreachable';
    }
}

export function initLightning(api: PluginAPI): void {
    apiRef = api;
}

export function startLightning(): void {
    if (!apiRef) return;
    lightning.error = '';
    ensureLayers();
    unbindView();
    bindView();
    if (!running) {
        running = true;
        sinceMs = Date.now() - state.lightningStaleSec * 1000;
        void pollRelay();
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => { void pollRelay(); }, 2000);
        if (pruneTimer) clearInterval(pruneTimer);
        pruneTimer = setInterval(() => {
            pruneStrikes();
            renderStrikes();
        }, 1000);
    }
    renderStrikes();
}

export function stopLightning(): void {
    running = false;
    lightning.connected = false;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
    }
    unbindView();
}

export function restoreLightningLayers(): void {
    if (!state.lightningEnabled) return;
    ensureLayers();
    unbindView();
    bindView();
    renderStrikes();
}

function removeLayers(): void {
    const map = mapOf();
    if (!map) return;
    try { if (map.getLayer(LIGHTNING_LAYER_ID)) map.removeLayer(LIGHTNING_LAYER_ID); } catch { /* ignore */ }
    try { if (map.getLayer(LIGHTNING_LEGACY_CIRCLE_ID)) map.removeLayer(LIGHTNING_LEGACY_CIRCLE_ID); } catch { /* ignore */ }
    try { if (map.getSource(LIGHTNING_SOURCE_ID)) map.removeSource(LIGHTNING_SOURCE_ID); } catch { /* ignore */ }
    try { if (map.hasImage?.(LIGHTNING_ICON_ID)) map.removeImage?.(LIGHTNING_ICON_ID); } catch { /* ignore */ }
}

export function destroyLightning(): void {
    stopLightning();
    lightning.strikes = [];
    lightning.inView = [];
    lightning.totalSeen = 0;
    lightning.error = '';
    removeLayers();
    apiRef = null;
}

export function refreshLightningView(): void {
    renderStrikes();
}

export function applyLightning(): void {
    if (state.lightningEnabled) startLightning();
    else {
        stopLightning();
        lightning.strikes = [];
        lightning.inView = [];
        lightning.totalSeen = 0;
        lightning.error = '';
        const map = mapOf();
        const src = map?.getSource(LIGHTNING_SOURCE_ID) as GeoSource | undefined;
        src?.setData?.(emptyCollection());
    }
}
