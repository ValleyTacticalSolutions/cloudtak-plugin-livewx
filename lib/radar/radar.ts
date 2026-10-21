import { ref } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { stackAlertLayers, startAlerts, stopAlerts } from '../alerts/alerts.ts';
import { attachRadarAgeControl, detachRadarAgeControl, setRadarAge } from '../core/age-control.ts';
import {
    ALERT_LINE_ID,
    CANADA_MAXZOOM,
    MOSAIC_MAXZOOM,
    RADAR_LAYER_ID,
    RADAR_SOURCE_ID,
    RAINVIEWER_MAXZOOM,
    REFRESH_MS,
    RIDGE_MAXZOOM,
} from '../core/constants.ts';
import {
    applyLightning,
    destroyLightning,
    initLightning,
    raiseLightningLayer,
    refreshLightningView,
    restoreLightningLayers,
} from '../lightning/lightning.ts';
import type { LiveWxMap, StyleLayer } from '../core/map-types.ts';
import { mapOf as hostMapOf, registerModule, unregisterModule } from '../core/map-host.ts';
import {
    FALLBACK_SITE_CODES,
    availableTilts,
    getProduct,
    mosaicProducts,
    productsForSite,
    siteCode,
} from './products.ts';
import type { RadarProduct } from './products.ts';
import { refreshSiteMarkers, startSiteMarkers, stopSiteMarkers } from './site-markers.ts';
import { findSite, isMosaic, toIemId } from './sites.ts';
import { persist, setSite, state } from '../core/state.ts';
import {
    ensureFilterProtocol,
    fetchAvailableProducts,
    fetchMosaicValidAt,
    fetchSiteScans,
    mosaicFrameLabel,
    mosaicLoopStamps,
    removeFilterProtocol,
    tileUrl,
    ageLabel,
    type ScanFrame,
} from './tiles.ts';
import { canadaTileUrl, inCanadaSees } from './canada.ts';
import { rainviewerTileUrl, fetchRainviewerHost, clearRainviewerCache } from './rainviewer.ts';

type RasterSource = { setTiles?: (tiles: string[]) => void };

/** Active mosaic: US NEXRAD (IEM), Canada GeoMet, or RainViewer world composite. */
export type RadarSourceKind = 'iem' | 'canada' | 'rainviewer';

let apiRef: PluginAPI | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let cacheBust = 0;
let protocolOn = false;
export const availableCodes = ref<string[] | null>(null);
let frames: ScanFrame[] = [];
export const replayFramesRef = ref<ScanFrame[]>([]);
export const liveValidAt = ref<number | null>(null);
let lastSourceSig = '';
let filterRaf = 0;
let raiseRaf = 0;
let rainviewerHost: string | null = null;
/** Resolved mosaic for the current provider + map center. */
export const activeSource = ref<RadarSourceKind>('iem');
let moveEndBound: (() => void) | null = null;
let moveEndTimer: ReturnType<typeof setTimeout> | null = null;

/** Opaque layer types a basemap can stack on top of the radar. */
const COVERING_TYPES = new Set(['background', 'raster', 'hillshade', 'color-relief', 'fill-extrusion']);

export function currentProduct(): RadarProduct | undefined {
    return getProduct(state.productId);
}

export function visibleProducts(): RadarProduct[] {
    if (isMosaic(state.siteId)) return mosaicProducts();
    const site = findSite(state.siteId);
    return productsForSite(availableCodes.value, site?.type ?? 'wsr88d');
}

export function replayFrames(): ScanFrame[] {
    return replayFramesRef.value;
}

function mapOf(): LiveWxMap | null {
    return hostMapOf() ?? (() => {
        try {
            return (apiRef?.map as unknown as LiveWxMap) ?? null;
        } catch {
            return null;
        }
    })();
}

/** Atmosphere-style coverage: US agency mosaics (incl. AK/HI/PR), then Canada, else world. */
function inUsRadarSees(lat: number, lng: number): boolean {
    const inConus = lat > 24 && lat < 50 && lng > -125 && lng < -66;
    const inAk = lat > 51 && lat < 72 && lng > -170 && lng < -130;
    const inHi = lat > 18 && lat < 23 && lng > -161 && lng < -154;
    const inPr = lat > 17 && lat < 19 && lng > -68 && lng < -65;
    return inConus || inAk || inHi || inPr;
}

/**
 * Resolve which mosaic to draw.
 * Explicit provider wins; Auto follows Atmosphere: US → IEM, Canada → GeoMet, else RainViewer.
 */
export function resolveRadarSource(): RadarSourceKind {
    if (state.radarProvider === 'iem') return 'iem';
    if (state.radarProvider === 'canada') return 'canada';
    if (state.radarProvider === 'rainviewer') return 'rainviewer';
    // auto
    const map = mapOf();
    const c = map?.getCenter?.();
    if (!c) return 'iem';
    const { lat, lng } = c;
    if (inUsRadarSees(lat, lng)) return 'iem';
    if (inCanadaSees(lat, lng)) return 'canada';
    return 'rainviewer';
}

function useIemControls(): boolean {
    return activeSource.value === 'iem';
}

function firstSymbolLayer(map: LiveWxMap): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
}

function currentStamp(): string {
    if (state.replayIndex < 0 || !frames[state.replayIndex]) return '0';
    return frames[state.replayIndex].stamp;
}

function currentImageAt(): number | null {
    if (state.replayIndex >= 0 && frames[state.replayIndex]) {
        return frames[state.replayIndex].at;
    }
    return liveValidAt.value;
}

function statusText(): string {
    if (!state.overlayEnabled) {
        setRadarAge(null, false);
        return 'Overlay Off';
    }
    setRadarAge(currentImageAt(), true);
    const frame = state.replayIndex >= 0 && frames[state.replayIndex]
        ? ageLabel(frames[state.replayIndex].at)
        : (liveValidAt.value != null ? `Live · ${ageLabel(liveValidAt.value)}` : 'Live');
    const src = activeSource.value;
    if (src === 'canada') return `Canada · GeoMet · ${frame}`;
    if (src === 'rainviewer') return `Global · RainViewer · ${frame}`;
    const product = currentProduct();
    const site = findSite(state.siteId);
    const where = site ? (isMosaic(site.id) ? 'CONUS mosaic' : site.id) : state.siteId;
    return `${where} · ${product?.label ?? state.productId} · ${frame}`;
}

function displaySite(): { siteId: string; siteType: string; maxzoom: number } {
    if (!isMosaic(state.siteId)) {
        const site = findSite(state.siteId);
        return {
            siteId: state.siteId,
            siteType: site?.type ?? 'wsr88d',
            maxzoom: RIDGE_MAXZOOM,
        };
    }
    return { siteId: state.siteId, siteType: 'mosaic', maxzoom: MOSAIC_MAXZOOM };
}

function applyTiles(map: LiveWxMap): void {
    const src = activeSource.value;
    let url: string;
    let maxzoom: number;
    let sigBase: string;

    if (src === 'rainviewer' && rainviewerHost) {
        // Replay uses frame stamp as RainViewer path; live uses cached host URL.
        if (state.replayIndex >= 0 && frames[state.replayIndex]) {
            const path = frames[state.replayIndex].stamp;
            const host = 'https://tilecache.rainviewer.com';
            url = rainviewerTileUrl(host, path);
        } else {
            url = rainviewerHost;
        }
        maxzoom = RAINVIEWER_MAXZOOM;
        sigBase = `rainviewer|${maxzoom}`;
    } else if (src === 'canada') {
        url = canadaTileUrl({ cacheBust });
        maxzoom = CANADA_MAXZOOM;
        sigBase = `canada|${maxzoom}`;
    } else {
        const product = currentProduct();
        if (!product) return;
        const display = displaySite();
        const useProtocol = protocolOn && product.filterKind !== 'other';
        url = tileUrl({
            siteId: display.siteId,
            product,
            siteType: display.siteType,
            stamp: currentStamp(),
            filter: state.filter,
            tilt: state.tilt,
            cacheBust,
        }, useProtocol);
        maxzoom = display.maxzoom;
        sigBase = `${display.siteId}|${display.maxzoom}`;
    }

    const sig = sigBase;
    const source = map.getSource(RADAR_SOURCE_ID) as RasterSource | undefined;
    if (source?.setTiles && lastSourceSig === sig && map.getLayer(RADAR_LAYER_ID)) {
        source.setTiles([url]);
        map.setPaintProperty?.(RADAR_LAYER_ID, 'raster-opacity', state.opacity);
        return;
    }
    lastSourceSig = sig;
    if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID);
    if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID);
    map.addSource(RADAR_SOURCE_ID, {
        type: 'raster',
        tiles: [url],
        tileSize: 256,
        minzoom: 0,
        maxzoom,
    });
    map.addLayer({
        id: RADAR_LAYER_ID,
        type: 'raster',
        source: RADAR_SOURCE_ID,
        paint: {
            'raster-opacity': state.opacity,
            'raster-fade-duration': 0,
            'raster-resampling': 'linear',
        },
    }, map.getLayer(ALERT_LINE_ID) ? ALERT_LINE_ID : firstSymbolLayer(map));
    stackAlertLayers(map);
    raiseLightningLayer();
}

function coversRadar(layer: StyleLayer): boolean {
    if (layer.id.startsWith('livewx-')) return false;
    if (COVERING_TYPES.has(layer.type)) return true;
    // Vector basemap land/water fills; CoT and GeoJSON fills have no source-layer
    return layer.type === 'fill' && Boolean(layer['source-layer']);
}

/**
 * CloudTAK swaps basemaps by removing and re-adding the overlay's layers
 * (no style.load), which can land them above the radar. Lift the radar
 * back over the highest covering layer.
 */
function keepRadarAboveBasemap(): void {
    raiseRaf = 0;
    if (!state.overlayEnabled) return;
    const map = mapOf();
    const layers = map?.getStyle?.()?.layers;
    if (!map || !layers) return;
    const radarIdx = layers.findIndex((l) => l.id === RADAR_LAYER_ID);
    if (radarIdx < 0) return;
    let top = -1;
    for (let i = layers.length - 1; i > radarIdx; i--) {
        if (coversRadar(layers[i])) {
            top = i;
            break;
        }
    }
    if (top < 0) return;
    try {
        map.moveLayer?.(RADAR_LAYER_ID, layers[top + 1]?.id);
        stackAlertLayers(map);
        raiseLightningLayer();
    } catch {
        /* style not ready */
    }
}

function onStyleData(): void {
    if (!raiseRaf) raiseRaf = requestAnimationFrame(keepRadarAboveBasemap);
}

function ensureRadarLayer(map: LiveWxMap): void {
    if (!map.getSource(RADAR_SOURCE_ID) || !map.getLayer(RADAR_LAYER_ID)) {
        applyTiles(map);
        return;
    }
    applyTiles(map);
    map.setPaintProperty?.(RADAR_LAYER_ID, 'raster-opacity', state.opacity);
}

function removeRadarLayer(map: LiveWxMap): void {
    lastSourceSig = '';
    try { if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID); } catch { /* ignore */ }
    try { if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID); } catch { /* ignore */ }
}

async function loadAvailable(): Promise<void> {
    if (!useIemControls()) {
        availableCodes.value = null;
        return;
    }
    if (isMosaic(state.siteId)) {
        availableCodes.value = null;
        return;
    }
    const codes = await fetchAvailableProducts(toIemId(state.siteId));
    availableCodes.value = codes && codes.length ? codes : FALLBACK_SITE_CODES;
    const visible = visibleProducts();
    let changed = false;
    if (!visible.some((p) => p.id === state.productId)) {
        const fallback = visible.find((p) => p.category === 'REF') ?? visible[0];
        if (fallback) {
            state.productId = fallback.id;
            changed = true;
        }
    }
    const product = currentProduct();
    const site = findSite(state.siteId);
    const tilts = availableTilts(product, site?.type ?? 'wsr88d', availableCodes.value);
    if (tilts.length && !tilts.includes(state.tilt)) {
        state.tilt = tilts[0];
        changed = true;
    }
    if (changed) persist();
}

async function loadFrames(): Promise<void> {
    stopPlayTimer();
    const src = activeSource.value;
    if (src === 'canada') {
        frames = [];
        replayFramesRef.value = frames;
        liveValidAt.value = Date.now();
        return;
    }
    if (src === 'rainviewer') {
        const rv = await fetchRainviewerHost();
        if (rv) {
            rainviewerHost = rainviewerTileUrl(rv.host, rv.path);
            frames = rv.frames;
            replayFramesRef.value = frames;
            liveValidAt.value = frames.length ? frames[frames.length - 1].at : Date.now();
        } else {
            rainviewerHost = null;
            frames = [];
            replayFramesRef.value = frames;
            liveValidAt.value = null;
        }
        return;
    }
    if (isMosaic(state.siteId)) {
        const product = currentProduct();
        const loopable = product?.mosaicLayer === 'nexrad-n0q' || product?.mosaicLayer === 'nexrad-eet';
        const now = Date.now();
        frames = loopable
            ? mosaicLoopStamps().map((stamp) => {
                const mins = Number(/^m(\d{2})m$/.exec(stamp)?.[1] ?? 0);
                return {
                    stamp,
                    label: mosaicFrameLabel(stamp),
                    at: now - mins * 60_000,
                };
            })
            : [];
        replayFramesRef.value = frames;
        liveValidAt.value = await fetchMosaicValidAt();
        return;
    }
    const product = currentProduct();
    const site = findSite(state.siteId);
    if (!product || !site) {
        frames = [];
        replayFramesRef.value = frames;
        liveValidAt.value = null;
        return;
    }
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    frames = await fetchSiteScans(
        toIemId(site.id),
        siteCode(product, site.type, state.tilt),
        start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    );
    replayFramesRef.value = frames;
    liveValidAt.value = frames.length ? frames[frames.length - 1].at : null;
}

/** Fetch RainViewer host path when needed; clear when switching away. */
async function prepareExternalSource(src: RadarSourceKind): Promise<void> {
    if (src === 'rainviewer') {
        clearRainviewerCache();
        const rv = await fetchRainviewerHost();
        rainviewerHost = rv ? rainviewerTileUrl(rv.host, rv.path) : null;
    } else {
        rainviewerHost = null;
    }
}

function stopPlayTimer(): void {
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
    }
    state.playing = false;
}

function startRefresh(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (!state.overlayEnabled || state.replayIndex >= 0) return;
        void refreshLive();
    }, REFRESH_MS);
}

async function refreshLive(): Promise<void> {
    if (!state.overlayEnabled || state.replayIndex >= 0) return;
    const prev = activeSource.value;
    activeSource.value = resolveRadarSource();
    cacheBust = Date.now();
    if (activeSource.value !== prev) {
        await prepareExternalSource(activeSource.value);
        await loadAvailable();
        await loadFrames();
    } else if (activeSource.value === 'rainviewer') {
        clearRainviewerCache();
        await loadFrames();
    } else if (activeSource.value === 'canada') {
        liveValidAt.value = Date.now();
    } else if (isMosaic(state.siteId)) {
        const at = await fetchMosaicValidAt();
        if (at) liveValidAt.value = at;
    } else if (frames.length) {
        liveValidAt.value = frames[frames.length - 1].at;
    }
    const map = mapOf();
    if (map) applyTiles(map);
    state.status = statusText();
}

function attachMoveEnd(map: LiveWxMap): void {
    detachMoveEnd(map);
    moveEndBound = () => {
        if (state.radarProvider !== 'auto' || !state.overlayEnabled) return;
        if (moveEndTimer) clearTimeout(moveEndTimer);
        moveEndTimer = setTimeout(() => {
            moveEndTimer = null;
            const next = resolveRadarSource();
            if (next !== activeSource.value) void refreshLive();
        }, 400);
    };
    map.on('moveend', moveEndBound);
}

function detachMoveEnd(map?: LiveWxMap | null): void {
    if (moveEndTimer) {
        clearTimeout(moveEndTimer);
        moveEndTimer = null;
    }
    const m = map ?? mapOf();
    if (m && moveEndBound) {
        try { m.off('moveend', moveEndBound); } catch { /* ignore */ }
    }
    moveEndBound = null;
}

function onStyle(map: LiveWxMap): void {
    lastSourceSig = '';
    if (state.overlayEnabled) {
        ensureRadarLayer(map);
        attachMoveEnd(map);
    }
    attachRadarAgeControl(map);
    if (state.alertsEnabled && apiRef) startAlerts(apiRef);
    if (state.sitesOnMap && apiRef) startSiteMarkers(apiRef, onSitePicked);
    restoreLightningLayers();
}

function onSitePicked(id: string): void {
    setSite(id);
    void applyRadarSettings();
    refreshSiteMarkers();
}

export function applySiteMarkers(): void {
    persist();
    if (!apiRef) return;
    if (state.sitesOnMap) {
        startSiteMarkers(apiRef, onSitePicked);
        refreshSiteMarkers();
    } else {
        stopSiteMarkers();
    }
}

export async function init(api: PluginAPI): Promise<void> {
    apiRef = api;
    protocolOn = await ensureFilterProtocol();
    initLightning(api);
    registerModule({
        id: 'radar-core',
        restore: (map) => onStyle(map),
    });
    const map = mapOf();
    if (map) {
        attachRadarAgeControl(map);
        map.on('styledata', onStyleData);
    }
    if (state.alertsEnabled) startAlerts(api);
    if (state.sitesOnMap) startSiteMarkers(api, onSitePicked);
    if (state.lightningEnabled) applyLightning();
    if (state.overlayEnabled) void setOverlayEnabled(true);
}

export function destroy(): void {
    stopPlayTimer();
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    if (filterRaf) {
        cancelAnimationFrame(filterRaf);
        filterRaf = 0;
    }
    if (raiseRaf) {
        cancelAnimationFrame(raiseRaf);
        raiseRaf = 0;
    }
    stopAlerts();
    stopSiteMarkers();
    destroyLightning();
    unregisterModule('radar-core');
    const map = mapOf();
    detachMoveEnd(map);
    if (map) {
        try { map.off('styledata', onStyleData); } catch { /* ignore */ }
        removeRadarLayer(map);
    }
    detachRadarAgeControl();
    apiRef = null;
    void removeFilterProtocol();
}

export async function setOverlayEnabled(enabled: boolean): Promise<void> {
    state.overlayEnabled = enabled;
    persist();
    const map = mapOf();
    if (!enabled) {
        stopPlayTimer();
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        detachMoveEnd(map);
        if (map) removeRadarLayer(map);
        setRadarAge(null, false);
        state.status = 'Overlay Off';
        return;
    }
    cacheBust = Date.now();
    activeSource.value = resolveRadarSource();
    await prepareExternalSource(activeSource.value);
    await loadAvailable();
    await loadFrames();
    if (map) {
        ensureRadarLayer(map);
        attachRadarAgeControl(map);
        attachMoveEnd(map);
    }
    startRefresh();
    state.status = statusText();
}

export async function applyRadarSettings(): Promise<void> {
    persist();
    refreshSiteMarkers();
    refreshLightningView();
    if (!state.overlayEnabled) {
        state.status = statusText();
        return;
    }
    state.replayIndex = -1;
    stopPlayTimer();
    cacheBust = Date.now();
    activeSource.value = resolveRadarSource();
    await prepareExternalSource(activeSource.value);
    await loadAvailable();
    await loadFrames();
    const map = mapOf();
    if (map) ensureRadarLayer(map);
    state.status = statusText();
}

export function applyOpacity(): void {
    const map = mapOf();
    map?.setPaintProperty?.(RADAR_LAYER_ID, 'raster-opacity', state.opacity);
}

export function applyFilter(): void {
    if (!state.overlayEnabled) return;
    if (filterRaf) return;
    filterRaf = requestAnimationFrame(() => {
        filterRaf = 0;
        const map = mapOf();
        if (map) applyTiles(map);
    });
}

export function applyAlerts(): void {
    persist();
    if (!apiRef) return;
    if (state.alertsEnabled) startAlerts(apiRef);
    else stopAlerts();
}

export function applyLightningToggle(): void {
    persist();
    applyLightning();
}

export async function setReplayIndex(index: number): Promise<void> {
    if (!frames.length || index < 0 || index >= frames.length) {
        state.replayIndex = -1;
        cacheBust = Date.now();
        const map = mapOf();
        if (map && state.overlayEnabled) applyTiles(map);
        state.status = statusText();
        return;
    }
    state.replayIndex = index;
    const map = mapOf();
    if (map && state.overlayEnabled) applyTiles(map);
    state.status = statusText();
}

export function togglePlay(): void {
    if (state.playing) {
        stopPlayTimer();
        state.status = statusText();
        return;
    }
    if (!frames.length) return;
    if (state.replayIndex < 0) state.replayIndex = 0;
    state.playing = true;
    playTimer = setInterval(() => {
        if (!frames.length) return;
        const next = state.replayIndex + 1;
        if (next >= frames.length) {
            state.replayIndex = 0;
        } else {
            state.replayIndex = next;
        }
        const map = mapOf();
        if (map && state.overlayEnabled) applyTiles(map);
        state.status = statusText();
    }, 400);
}

export function goLive(): void {
    stopPlayTimer();
    state.replayIndex = -1;
    cacheBust = Date.now();
    const map = mapOf();
    if (map && state.overlayEnabled) applyTiles(map);
    state.status = statusText();
}
