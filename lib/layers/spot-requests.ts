/**
 * Current NWS Spot Forecast requests (NOAA SPOT Forecast Monitor service) as map points.
 * Uses the shared cached national list from spot/spot.ts; shows requests in
 * the current view and honors the Spot page's incident / hide-complete filters.
 */
import { watch, type WatchStopHandle } from 'vue';
import type { FeatureCollection } from '../core/geojson.ts';
import { firstSymbolLayer, mapOf } from '../core/map-host.ts';
import { CLOUD_STAR_ICON, ensureMapIcons, removeMapIcons } from '../core/map-icons.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { state } from '../core/state.ts';
import { formatInTimeZone } from '../core/timezone.ts';
import {
    forecastUrl,
    loadSpotRequests,
    matchesContent,
    spot,
    statusLabel,
    type SpotRequest,
    type SpotStatus,
} from '../spot/spot.ts';
import { escapeHtml, linkHtml, registerFeatureLayers, unregisterFeatureLayers } from './feature-popup.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
} from './registry.ts';

const LAYER_ID = 'spot_requests';
const SOURCE_ID = 'livewx-spot-src';
const CIRCLE_ID = 'livewx-spot-circle';
const ICON_ID = 'livewx-spot-icon';
/** Spot Forecasts markers: cloud-star icon on a circle filled with the status color (same as the page badges). */
const STATUS_COLORS: Record<SpotStatus, string> = {
    complete: '#2fb344',
    pending: '#f59f00',
};

let running = false;
let data: FeatureCollection = emptyFc();
let featureCount = 0;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let moveHandler: (() => void) | null = null;
let stopWatch: WatchStopHandle | null = null;

/** Popup card for a spot request feature (also used by the temporary Zoom marker). */
export function spotDetailHtml(props: Record<string, unknown>): string {
    const id = String(props.id || '');
    const tz = String(props.timeZone || '');
    const when = (raw: unknown): string => {
        const ms = Number(raw);
        if (!raw || !Number.isFinite(ms)) return '—';
        const opts: Intl.DateTimeFormatOptions = {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        };
        return tz ? formatInTimeZone(ms, tz, opts) : new Date(ms).toLocaleString(undefined, opts);
    };
    const status = props.status === 'complete' ? 'complete' : 'pending';
    const rows: Array<[string, string]> = [
        ['Type', String(props.requestType || '—')],
        ['Status', statusLabel(status)],
        ['Office', String(props.office || '—')],
        ['Requested', when(props.submittedAt)],
        ['Deliver', when(props.deliverAt)],
        ['Filled', when(props.filledAt)],
    ];
    const dl = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
    const link = id
        ? `<dt>Forecast</dt><dd>${linkHtml(forecastUrl(id), 'Open forecast')}</dd>`
        : '';
    return '<div class="livewx-alert-card">'
        + '<div class="livewx-alert-eyebrow">Spot Forecast</div>'
        + `<div class="livewx-alert-title">${escapeHtml(String(props.projectName || 'Spot request'))}</div>`
        + `<dl class="livewx-alert-dl">${dl}${link}</dl></div>`;
}

function inView(map: LiveWxMap, lat: number, lon: number): boolean {
    const b = map.getBounds?.();
    if (!b) return true;
    const west = b.getWest();
    const east = b.getEast();
    if (lat < b.getSouth() || lat > b.getNorth()) return false;
    // Bounds can extend past ±180 when the map wraps.
    for (const shift of [0, 360, -360]) {
        const x = lon + shift;
        if (x >= west && x <= east) return true;
    }
    return false;
}

/** GeoJSON properties for a spot request (map layer and temporary marker). */
export function spotFeatureProps(r: SpotRequest): Record<string, unknown> {
    return {
        id: r.id,
        projectName: r.projectName,
        requestType: r.requestType,
        status: r.status,
        office: r.office,
        timeZone: r.timeZone,
        submittedAt: r.submittedAt ?? '',
        deliverAt: r.deliverAt ?? '',
        filledAt: r.filledAt ?? '',
        color: STATUS_COLORS[r.status],
    };
}

function buildFeatures(map: LiveWxMap): FeatureCollection {
    const features: FeatureCollection['features'] = [];
    for (const r of spot.requests) {
        if (!matchesContent(r, state.spotCategory, state.spotHideComplete)) continue;
        if (!inView(map, r.lat, r.lon)) continue;
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
            properties: spotFeatureProps(r),
        });
    }
    return { type: 'FeatureCollection', features };
}

function paint(map: LiveWxMap): void {
    ensureGeoJsonSource(map, SOURCE_ID, data);
    if (!map.getLayer(CIRCLE_ID)) {
        map.addLayer({
            id: CIRCLE_ID,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': 11,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff',
            },
        }, firstSymbolLayer(map));
    }
    // Style swaps drop images, so (re-)add the icon on every paint.
    if (ensureMapIcons(map, [CLOUD_STAR_ICON]) && !map.getLayer(ICON_ID)) {
        map.addLayer({
            id: ICON_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'icon-image': CLOUD_STAR_ICON.id,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
        });
    }
}

/** Rebuild from the cached list (no fetch). */
function redraw(): void {
    const map = mapOf();
    if (!map || !running) return;
    data = buildFeatures(map);
    featureCount = data.features.length;
    paint(map);
    refreshStatus(LAYER_ID);
}

/** Refetch only if the shared cache is stale, then redraw. */
async function refresh(): Promise<void> {
    await loadSpotRequests();
    redraw();
}

function bindMove(): void {
    const map = mapOf();
    if (!map || moveHandler) return;
    moveHandler = () => {
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => { void refresh(); }, 400);
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

function registerPopup(): void {
    registerFeatureLayers([CIRCLE_ID, ICON_ID], {
        label: 'Spot Forecast',
        titleKeys: ['projectName'],
        detailHtml: spotDetailHtml,
    });
}

export function registerSpotRequestsLayer(): void {
    registerLayer({
        id: LAYER_ID,
        group: 'more',
        label: 'Spot Forecasts',
        description: 'Current NWS Spot Forecast requests (NOAA SPOT Forecast Monitor)',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Nothing (national list, filtered locally)',
        start: async () => {
            running = true;
            registerPopup();
            bindMove();
            // Repaint when the list reloads or the Spot page filters change.
            stopWatch = watch(
                () => [spot.fetchedAt, state.spotCategory, state.spotHideComplete],
                () => redraw(),
            );
            await refresh();
        },
        stop: () => {
            running = false;
            stopWatch?.();
            stopWatch = null;
            unbindMove();
            unregisterFeatureLayers([CIRCLE_ID, ICON_ID]);
            const map = mapOf();
            if (map) {
                removeLayerSafe(map, ICON_ID);
                removeLayerSafe(map, CIRCLE_ID);
                removeMapIcons(map, [CLOUD_STAR_ICON]);
                removeSourceSafe(map, SOURCE_ID);
            }
            data = emptyFc();
            featureCount = 0;
        },
        restore: (map) => {
            if (!running) return;
            registerPopup();
            bindMove();
            paint(map);
        },
        status: () => {
            if (!running) return 'Off';
            if (spot.error && spot.fetchedAt == null) return spot.error;
            if (spot.fetchedAt == null) return 'Loading…';
            return `${featureCount} in view`;
        },
    });
}
