import type { PluginAPI } from '@tak-ps/cloudtak';
import {
    ALERT_FILL_ID,
    ALERT_LINE_ID,
    ALERT_POLL_MS,
    ALERT_SOURCE_ID,
    LIGHTNING_LAYER_ID,
    LIGHTNING_LEGACY_CIRCLE_ID,
    NWS_ALERTS_URL,
    RADAR_LAYER_ID,
    SITES_CIRCLE_ID,
    SITES_LABEL_ID,
} from '../core/constants.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { state } from '../core/state.ts';
import {
    closeFeaturePopup,
    escapeHtml,
    hitsFeaturePopupLayers,
    showFeatureHtml,
} from '../layers/feature-popup.ts';
import { pointUi } from '../core/point.ts';

interface AlertProps {
    event?: string;
    headline?: string;
    instruction?: string;
    description?: string;
    expires?: string;
    severity?: string;
    fill?: string;
}

interface AlertFeature {
    type: 'Feature';
    geometry: {
        type: string;
        coordinates: unknown;
    } | null;
    properties: AlertProps;
}

interface AlertCollection {
    type: 'FeatureCollection';
    features: AlertFeature[];
}

const WATCH_OR_WARNING = /(watch|warning)$/i;

const FILL: Record<string, string> = {
    'Tornado Warning': '#ff0000',
    'Tornado Watch': '#ffff00',
    'Severe Thunderstorm Warning': '#ffa500',
    'Severe Thunderstorm Watch': '#db7093',
    'Flash Flood Warning': '#008000',
    'Flash Flood Watch': '#2e8b57',
    'Flood Warning': '#00ff00',
    'Flood Watch': '#90ee90',
    'Special Marine Warning': '#ffa500',
    'Extreme Wind Warning': '#ff8c00',
    'Blizzard Warning': '#ff4500',
    'Winter Storm Warning': '#ff69b4',
    'Winter Storm Watch': '#ffb6c1',
    'Ice Storm Warning': '#8b008b',
    'Hurricane Warning': '#dc143c',
    'Hurricane Watch': '#ff00ff',
    'Tropical Storm Warning': '#b22222',
    'Tropical Storm Watch': '#f08080',
    'Storm Warning': '#8b0000',
    'Storm Watch': '#cd5c5c',
    'Red Flag Warning': '#ff1493',
    'Fire Weather Watch': '#ffdead',
};

function colorForEvent(event: string): string {
    if (FILL[event]) return FILL[event];
    if (/tornado/i.test(event)) return /watch/i.test(event) ? '#ffff00' : '#ff0000';
    if (/thunder/i.test(event)) return /watch/i.test(event) ? '#db7093' : '#ffa500';
    if (/flood/i.test(event)) return /watch/i.test(event) ? '#2e8b57' : '#008000';
    if (/watch/i.test(event)) return '#ffff99';
    return '#ff6347';
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let mapRef: LiveWxMap | null = null;

function isWatchOrWarning(event: string): boolean {
    return WATCH_OR_WARNING.test(event.trim());
}

function emptyCollection(): AlertCollection {
    return { type: 'FeatureCollection', features: [] };
}

/**
 * CloudTAK's proxy rejects responses over 1 MB, and the NWS national
 * "active alerts" feed is several MB. Request it in event-filtered groups so
 * each response stays small, then merge. Zone-only alerts (no polygon) were
 * already dropped below, so nothing visible is lost.
 */
const EVENT_GROUPS: string[][] = [
    ['Tornado Warning', 'Severe Thunderstorm Warning'],
    ['Flash Flood Warning', 'Special Marine Warning', 'Extreme Wind Warning'],
    ['Tornado Watch', 'Severe Thunderstorm Watch', 'Flash Flood Watch'],
    ['Flood Warning', 'Flood Watch', 'Blizzard Warning', 'Winter Storm Warning', 'Winter Storm Watch', 'Ice Storm Warning'],
    ['Hurricane Warning', 'Hurricane Watch', 'Tropical Storm Warning', 'Tropical Storm Watch',
        'Storm Warning', 'Storm Watch', 'Red Flag Warning', 'Fire Weather Watch'],
];

async function fetchAlerts(): Promise<AlertCollection> {
    const { fetchJson } = await import('../core/egress.ts');
    const results = await Promise.allSettled(EVENT_GROUPS.map((events) => {
        const url = `${NWS_ALERTS_URL}?status=actual&event=${events.map(encodeURIComponent).join(',')}`;
        return fetchJson<AlertCollection>(url, { headers: { Accept: 'application/geo+json' } });
    }));
    const ok = results.filter((r): r is PromiseFulfilledResult<AlertCollection> => r.status === 'fulfilled');
    if (!ok.length) {
        const first = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        throw first?.reason instanceof Error ? first.reason : new Error('Failed to load watches/warnings');
    }
    const seen = new Set<string>();
    const features = ok.flatMap((r) => r.value.features ?? []).filter((f) => {
        const event = f.properties?.event ?? '';
        if (!isWatchOrWarning(event)) return false;
        if (!f.geometry) return false;
        if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') return false;
        const id = String((f as { id?: unknown }).id ?? '');
        if (id) {
            if (seen.has(id)) return false;
            seen.add(id);
        }
        return true;
    }).map((f) => ({
        ...f,
        properties: {
            ...f.properties,
            fill: colorForEvent(f.properties?.event ?? ''),
        },
    }));
    return { type: 'FeatureCollection', features };
}

function firstSymbolLayer(map: LiveWxMap): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    const symbol = layers.find((l) => l.type === 'symbol');
    return symbol?.id;
}

function layerAfter(map: LiveWxMap, id: string): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    const i = layers.findIndex((l) => l.id === id);
    if (i < 0) return firstSymbolLayer(map);
    return layers[i + 1]?.id;
}

/** Fill under radar, outline immediately above radar. */
export function stackAlertLayers(map: LiveWxMap): void {
    if (map.getLayer(ALERT_FILL_ID) && map.getLayer(RADAR_LAYER_ID)) {
        try { map.moveLayer?.(ALERT_FILL_ID, RADAR_LAYER_ID); } catch { /* ignore */ }
    }
    if (map.getLayer(ALERT_LINE_ID) && map.getLayer(RADAR_LAYER_ID)) {
        const after = layerAfter(map, RADAR_LAYER_ID);
        if (after && after !== ALERT_LINE_ID) {
            try { map.moveLayer?.(ALERT_LINE_ID, after); } catch { /* ignore */ }
        } else if (!after) {
            try { map.moveLayer?.(ALERT_LINE_ID); } catch { /* ignore */ }
        }
    }
}

function ensureAlertLayers(map: LiveWxMap): void {
    if (!map.getSource(ALERT_SOURCE_ID)) {
        map.addSource(ALERT_SOURCE_ID, {
            type: 'geojson',
            data: emptyCollection(),
        });
    }
    const underRadar = map.getLayer(RADAR_LAYER_ID) ? RADAR_LAYER_ID : firstSymbolLayer(map);
    if (!map.getLayer(ALERT_FILL_ID)) {
        map.addLayer({
            id: ALERT_FILL_ID,
            type: 'fill',
            source: ALERT_SOURCE_ID,
            paint: {
                'fill-color': ['coalesce', ['get', 'fill'], '#ff0000'],
                'fill-opacity': 0.28,
            },
        }, underRadar);
    }
    if (!map.getLayer(ALERT_LINE_ID)) {
        const aboveRadar = map.getLayer(RADAR_LAYER_ID)
            ? layerAfter(map, RADAR_LAYER_ID)
            : firstSymbolLayer(map);
        map.addLayer({
            id: ALERT_LINE_ID,
            type: 'line',
            source: ALERT_SOURCE_ID,
            paint: {
                'line-color': ['coalesce', ['get', 'fill'], '#ff0000'],
                'line-width': 2,
                'line-opacity': 0.9,
            },
        }, aboveRadar);
    }
    stackAlertLayers(map);
}

function removeAlertLayers(map: LiveWxMap): void {
    try { if (map.getLayer(ALERT_LINE_ID)) map.removeLayer(ALERT_LINE_ID); } catch { /* ignore */ }
    try { if (map.getLayer(ALERT_FILL_ID)) map.removeLayer(ALERT_FILL_ID); } catch { /* ignore */ }
    try { if (map.getSource(ALERT_SOURCE_ID)) map.removeSource(ALERT_SOURCE_ID); } catch { /* ignore */ }
}

type GeoSource = { setData?: (data: unknown) => void };

async function refresh(map: LiveWxMap): Promise<void> {
    try {
        const data = await fetchAlerts();
        const source = map.getSource(ALERT_SOURCE_ID) as GeoSource | undefined;
        source?.setData?.(data);
        state.alertCount = data.features.length;
        state.error = '';
    } catch (err) {
        state.error = err instanceof Error ? err.message : 'Failed to load watches/warnings';
    }
}

function textOf(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

const SECTION_LINE = /^(HAZARD|SOURCE|IMPACT|LOCATIONS?|PRECAUTIONARY|AND\/OR|TIME\s+LINE|INSTRUCTIONS?)\b/i;

function unwrapNws(text: string): string[] {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/&&/g, '\n\n').split('\n');
    const paras: string[] = [];
    let buf = '';
    const flush = (): void => {
        const next = buf.replace(/\s+/g, ' ').trim();
        if (next) paras.push(next);
        buf = '';
    };
    for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed) {
            flush();
            continue;
        }
        if (trimmed.startsWith('*')) {
            flush();
            paras.push(trimmed.replace(/^\*+\s*/, '* '));
            continue;
        }
        if (SECTION_LINE.test(trimmed) || /^[A-Z][A-Z0-9 /.&-]{1,48}\.{2,}/.test(trimmed)) {
            flush();
            buf = trimmed;
            continue;
        }
        buf = buf ? `${buf} ${trimmed}` : trimmed;
    }
    flush();
    return paras;
}

function formatNwsText(text: string): string {
    const paras = unwrapNws(text);
    const chunks: string[] = [];
    let list: string[] = [];
    const flushList = (): void => {
        if (!list.length) return;
        chunks.push(`<ul class="livewx-alert-list">${list.map((item) => `<li>${item}</li>`).join('')}</ul>`);
        list = [];
    };
    for (const para of paras) {
        if (para.startsWith('* ')) {
            list.push(escapeHtml(para.slice(2)));
            continue;
        }
        flushList();
        chunks.push(`<p>${escapeHtml(para)}</p>`);
    }
    flushList();
    return chunks.join('');
}

function alertHtml(props: AlertProps): string {
    const headline = textOf(props.headline).replace(/\s+/g, ' ');
    const description = textOf(props.description);
    const instruction = textOf(props.instruction);
    const event = textOf(props.event);
    const parts: string[] = [];
    if (headline) parts.push(`<div class="livewx-alert-title">${escapeHtml(headline)}</div>`);
    else if (event) parts.push(`<div class="livewx-alert-title">${escapeHtml(event)}</div>`);
    if (description) parts.push(`<div class="livewx-alert-body">${formatNwsText(description)}</div>`);
    const descFlat = description.replace(/\s+/g, ' ');
    const instFlat = instruction.replace(/\s+/g, ' ');
    if (instruction && instFlat !== descFlat && !descFlat.includes(instFlat)) {
        parts.push(`<div class="livewx-alert-body">${formatNwsText(instruction)}</div>`);
    }
    return `<div class="livewx-alert-card">${parts.join('')}</div>`;
}

async function showPopup(
    map: LiveWxMap,
    lngLat: { lng: number; lat: number },
    props: AlertProps,
): Promise<void> {
    await showFeatureHtml(map, lngLat, alertHtml(props));
}

const OVERLAY_HIT_LAYERS = [
    LIGHTNING_LAYER_ID,
    LIGHTNING_LEGACY_CIRCLE_ID,
    SITES_CIRCLE_ID,
    SITES_LABEL_ID,
];

function presentLayers(map: LiveWxMap, ids: string[]): string[] {
    return ids.filter((id) => Boolean(map.getLayer(id)));
}

function hitsAt(map: LiveWxMap, point: unknown, ids: string[]): Array<{ properties?: AlertProps }> {
    const layers = presentLayers(map, ids);
    if (!layers.length || !map.queryRenderedFeatures) return [];
    try {
        return map.queryRenderedFeatures(point, { layers }) as Array<{ properties?: AlertProps }>;
    } catch {
        return [];
    }
}

type StackedFeature = {
    layer?: { id?: string; type?: string };
    geometry?: { type?: string } | null;
    properties?: AlertProps;
};

/** CloudTAK point CoTs: `{overlayId}`, `{overlayId}-icon|-course|-group|-text-point`. */
const COT_POINT_LAYER = /^-?\d+(?:-icon|-course|-group|-text-point)?$/;

function isCotPoint(feat: StackedFeature): boolean {
    const layerId = feat.layer?.id ?? '';
    if (!COT_POINT_LAYER.test(layerId)) return false;
    if (/(?:-icon|-course|-group|-text-point)$/.test(layerId)) return true;
    // A bare overlay id is also used for raster layers. Only a point marker counts.
    return feat.geometry?.type === 'Point'
        && (feat.layer?.type === 'circle' || feat.layer?.type === 'symbol');
}

function featuresAt(map: LiveWxMap, point: unknown): StackedFeature[] {
    if (!map.queryRenderedFeatures) return [];
    try {
        return map.queryRenderedFeatures(point) as StackedFeature[];
    } catch {
        return [];
    }
}

function onAlertClick(e: {
    lngLat?: { lng: number; lat: number };
    point?: unknown;
}): void {
    if (pointUi.picking) return;
    const map = mapRef;
    if (!map || !e.lngLat || e.point == null) return;
    if (hitsAt(map, e.point, OVERLAY_HIT_LAYERS).length) return;
    // Buoys / quakes / zones / etc. own their clicks.
    if (hitsFeaturePopupLayers(map, e.point)) return;

    // Top-most feature first. A point CoT drawn above the polygon wins;
    // the watch/warning is ignored and the CoT selection proceeds.
    for (const feat of featuresAt(map, e.point)) {
        if (isCotPoint(feat)) return;
        if (feat.layer?.id !== ALERT_FILL_ID && feat.layer?.id !== ALERT_LINE_ID) continue;
        const props = feat.properties;
        if (!props) continue;
        void showPopup(map, e.lngLat, props);
        return;
    }
}

export function startAlerts(api: PluginAPI): void {
    const map = api.map as unknown as LiveWxMap;
    mapRef = map;
    ensureAlertLayers(map);
    map.off('click', onAlertClick);
    map.off('click', ALERT_FILL_ID, onAlertClick);
    map.off('click', ALERT_LINE_ID, onAlertClick);
    map.on('click', onAlertClick);
    void refresh(map);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        if (mapRef) void refresh(mapRef);
    }, ALERT_POLL_MS);
}

export function stopAlerts(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    closeFeaturePopup();
    state.alertCount = 0;
    if (mapRef) {
        try { mapRef.off('click', onAlertClick); } catch { /* ignore */ }
        try { mapRef.off('click', ALERT_FILL_ID, onAlertClick); } catch { /* ignore */ }
        try { mapRef.off('click', ALERT_LINE_ID, onAlertClick); } catch { /* ignore */ }
        removeAlertLayers(mapRef);
    }
    mapRef = null;
}
