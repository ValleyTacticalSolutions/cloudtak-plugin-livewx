import { reactive } from 'vue';
import {
    CONUS_SITE_ID,
    DEFAULT_FILTER,
    DEFAULT_LIGHTNING_STALE_SEC,
    DEFAULT_OPACITY,
    STORAGE_KEY,
    type AppPageId,
} from './constants.ts';
import type { UnitSystem } from './units.ts';
import {
    MOSAIC_DEFAULT_PRODUCT_ID,
    SITE_DEFAULT_PRODUCT_ID,
    getProduct,
} from '../radar/products.ts';
import { isMosaic } from '../radar/sites.ts';

export type PointMode = 'self' | 'center' | 'pick' | 'favorite';

export type SpotScope = 'office' | 'radius' | 'all';

export interface FavoritePoint {
    id: string;
    name: string;
    lat: number;
    lon: number;
}

export interface LayerPersist {
    enabled: boolean;
    consent: boolean;
    /** Raster overlay opacity 0–1 when supported. */
    opacity?: number;
}

export interface PersistedSettings {
    siteId: string;
    productId: string;
    tilt: number;
    opacity: number;
    filter: number;
    alertsEnabled: boolean;
    lightningEnabled: boolean;
    lightningStaleSec: number;
    overlayEnabled: boolean;
    sitesOnMap: boolean;
    /** Atmosphere-rich additions */
    page: AppPageId;
    units: UnitSystem;
    pointMode: PointMode;
    pickLat: number | null;
    pickLon: number | null;
    favoriteId: string | null;
    favorites: FavoritePoint[];
    forecastSourceId: string;
    layers: Record<string, LayerPersist>;
    densityLightningEnabled: boolean;
    /**
     * Radar mosaic source:
     * - iem — US NEXRAD via Iowa Environmental Mesonet
     * - canada — Environment Canada GeoMet
     * - rainviewer — RainViewer global composite
     * - auto — pick by map center (US → IEM, Canada → GeoMet, else RainViewer)
     */
    radarProvider: 'iem' | 'canada' | 'rainviewer' | 'auto';
    consentedSources: string[];
    /** Bottom map legend strips. */
    legendsVisible: boolean;
    /** Observed rain totals window: 1h | 6h | 24h | 72h | 7d */
    rainTotalsWindow: string;
    /** Spot Forecasts page filters. */
    spotScope: SpotScope;
    spotRadiusMi: number;
    /** Office override; '' = office for the query point. */
    spotOffice: string;
    /** Incident category; '' = all. */
    spotCategory: string;
    spotHideComplete: boolean;
}

export interface LiveWxState extends PersistedSettings {
    playing: boolean;
    replayIndex: number;
    status: string;
    error: string;
    alertCount: number;
    /** Live query point (updated by point controller). */
    queryLat: number | null;
    queryLon: number | null;
    placeName: string;
}

function load(): PersistedSettings {
    const defaults: PersistedSettings = {
        siteId: CONUS_SITE_ID,
        productId: MOSAIC_DEFAULT_PRODUCT_ID,
        tilt: 0,
        opacity: DEFAULT_OPACITY,
        filter: DEFAULT_FILTER,
        alertsEnabled: false,
        lightningEnabled: false,
        lightningStaleSec: DEFAULT_LIGHTNING_STALE_SEC,
        overlayEnabled: false,
        sitesOnMap: false,
        page: 'home',
        units: 'us',
        pointMode: 'pick',
        pickLat: null,
        pickLon: null,
        favoriteId: null,
        favorites: [],
        forecastSourceId: 'nws',
        layers: {},
        densityLightningEnabled: false,
        radarProvider: 'iem',
        consentedSources: [],
        legendsVisible: true,
        rainTotalsWindow: '24h',
        spotScope: 'office',
        spotRadiusMi: 50,
        spotOffice: '',
        spotCategory: '',
        spotHideComplete: false,
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
        const pageRaw = parsed.page as string | undefined;
        const page: AppPageId = pageRaw === 'forecast' || pageRaw === 'radar' || pageRaw === 'spot'
            || pageRaw === 'home'
            ? pageRaw
            : 'home';
        return {
            siteId: typeof parsed.siteId === 'string' ? parsed.siteId : defaults.siteId,
            productId: typeof parsed.productId === 'string' ? parsed.productId : defaults.productId,
            tilt: clamp(Number(parsed.tilt), 0, 9, defaults.tilt),
            opacity: clamp(Number(parsed.opacity), 0, 1, defaults.opacity),
            filter: clamp(Number(parsed.filter), 0, 75, defaults.filter),
            alertsEnabled: Boolean(parsed.alertsEnabled),
            lightningEnabled: Boolean(parsed.lightningEnabled),
            lightningStaleSec: clamp(
                Number(parsed.lightningStaleSec),
                15,
                600,
                defaults.lightningStaleSec,
            ),
            overlayEnabled: Boolean(parsed.overlayEnabled),
            sitesOnMap: Boolean(parsed.sitesOnMap),
            page,
            units: (parsed.units as UnitSystem) || defaults.units,
            // Location is last-used pick only; legacy modes (self/center/favorite) map to pick.
            pointMode: 'pick',
            pickLat: typeof parsed.pickLat === 'number' ? parsed.pickLat : null,
            pickLon: typeof parsed.pickLon === 'number' ? parsed.pickLon : null,
            favoriteId: typeof parsed.favoriteId === 'string' ? parsed.favoriteId : null,
            favorites: Array.isArray(parsed.favorites) ? parsed.favorites as FavoritePoint[] : [],
            forecastSourceId: typeof parsed.forecastSourceId === 'string'
                ? parsed.forecastSourceId
                : defaults.forecastSourceId,
            layers: normalizeLayers(parsed.layers),
            densityLightningEnabled: Boolean(parsed.densityLightningEnabled),
            radarProvider: parseRadarProvider(parsed.radarProvider),
            consentedSources: Array.isArray(parsed.consentedSources)
                ? parsed.consentedSources as string[]
                : [],
            // Default on when key missing (first load after this feature).
            legendsVisible: parsed.legendsVisible === undefined ? true : Boolean(parsed.legendsVisible),
            rainTotalsWindow: normalizeRainWindow(parsed.rainTotalsWindow),
            spotScope: normalizeSpotScope(parsed.spotScope),
            spotRadiusMi: clamp(Number(parsed.spotRadiusMi), 1, 500, defaults.spotRadiusMi),
            spotOffice: typeof parsed.spotOffice === 'string' ? parsed.spotOffice.toUpperCase() : '',
            spotCategory: typeof parsed.spotCategory === 'string' ? parsed.spotCategory : '',
            spotHideComplete: Boolean(parsed.spotHideComplete),
        };
    } catch {
        return defaults;
    }
}

export type RadarProvider = PersistedSettings['radarProvider'];

const RADAR_PROVIDERS = new Set<RadarProvider>(['iem', 'canada', 'rainviewer', 'auto']);

function parseRadarProvider(raw: unknown): RadarProvider {
    return typeof raw === 'string' && RADAR_PROVIDERS.has(raw as RadarProvider)
        ? raw as RadarProvider
        : 'iem';
}

function normalizeRainWindow(raw: unknown): string {
    const allowed = new Set(['1h', '6h', '24h', '72h', '7d']);
    return typeof raw === 'string' && allowed.has(raw) ? raw : '24h';
}

function normalizeSpotScope(raw: unknown): SpotScope {
    return raw === 'radius' || raw === 'all' ? raw : 'office';
}

function clamp(n: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function normalizeLayers(raw: unknown): Record<string, LayerPersist> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, LayerPersist> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue;
        const row = v as Partial<LayerPersist>;
        const entry: LayerPersist = {
            enabled: Boolean(row.enabled),
            consent: Boolean(row.consent),
        };
        if (typeof row.opacity === 'number' && Number.isFinite(row.opacity)) {
            entry.opacity = clamp(row.opacity, 0, 1, DEFAULT_OPACITY);
        }
        out[id] = entry;
    }
    return out;
}

const persisted = load();

export const state = reactive<LiveWxState>({
    ...persisted,
    playing: false,
    replayIndex: -1,
    status: 'Overlay Off',
    error: '',
    alertCount: 0,
    queryLat: null,
    queryLon: null,
    placeName: '',
});

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function payload(): PersistedSettings {
    return {
        siteId: state.siteId,
        productId: state.productId,
        tilt: state.tilt,
        opacity: state.opacity,
        filter: state.filter,
        alertsEnabled: state.alertsEnabled,
        lightningEnabled: state.lightningEnabled,
        lightningStaleSec: state.lightningStaleSec,
        overlayEnabled: state.overlayEnabled,
        sitesOnMap: state.sitesOnMap,
        page: state.page,
        units: state.units,
        pointMode: state.pointMode,
        pickLat: state.pickLat,
        pickLon: state.pickLon,
        favoriteId: state.favoriteId,
        favorites: state.favorites,
        forecastSourceId: state.forecastSourceId,
        layers: state.layers,
        densityLightningEnabled: state.densityLightningEnabled,
        radarProvider: state.radarProvider,
        consentedSources: state.consentedSources,
        legendsVisible: state.legendsVisible,
        rainTotalsWindow: state.rainTotalsWindow,
        spotScope: state.spotScope,
        spotRadiusMi: state.spotRadiusMi,
        spotOffice: state.spotOffice,
        spotCategory: state.spotCategory,
        spotHideComplete: state.spotHideComplete,
    };
}

export function setRainTotalsWindow(id: string): void {
    state.rainTotalsWindow = normalizeRainWindow(id);
    persist();
}

export function setLegendsVisible(visible: boolean): void {
    state.legendsVisible = visible;
    persist();
}

export function toggleLegendsVisible(): void {
    setLegendsVisible(!state.legendsVisible);
}

export function persist(): void {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload()));
    } catch {
        /* ignore quota */
    }
}

export function persistLayers(): void {
    persist();
}

/** Debounced persist for slider drags / wheel so the overlay can update immediately. */
export function persistSoon(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        persist();
    }, 300);
}

export function setSite(siteId: string): void {
    const wasMosaic = isMosaic(state.siteId);
    const nowMosaic = isMosaic(siteId);
    state.siteId = siteId;
    if (wasMosaic !== nowMosaic) {
        state.productId = nowMosaic ? MOSAIC_DEFAULT_PRODUCT_ID : SITE_DEFAULT_PRODUCT_ID;
    } else if (nowMosaic && !getProduct(state.productId)?.mosaicLayer) {
        state.productId = MOSAIC_DEFAULT_PRODUCT_ID;
    }
    state.replayIndex = -1;
    state.playing = false;
    persist();
}

export function setProduct(productId: string): void {
    state.productId = productId;
    persist();
}

export function setTilt(tilt: number): void {
    state.tilt = clamp(tilt, 0, 9, 0);
    persist();
}

export function setOpacity(opacity: number): void {
    state.opacity = clamp(opacity, 0, 1, DEFAULT_OPACITY);
    persistSoon();
}

export function setFilter(filter: number): void {
    state.filter = clamp(filter, 0, 75, DEFAULT_FILTER);
    persistSoon();
}

export function setAlertsEnabled(enabled: boolean): void {
    state.alertsEnabled = enabled;
    persist();
}

export function setLightningEnabled(enabled: boolean): void {
    state.lightningEnabled = enabled;
    persist();
}

export function setLightningStaleSec(sec: number): void {
    state.lightningStaleSec = clamp(sec, 15, 600, DEFAULT_LIGHTNING_STALE_SEC);
    persistSoon();
}

export function setSitesOnMap(enabled: boolean): void {
    state.sitesOnMap = enabled;
    persist();
}

export function setPage(page: AppPageId): void {
    state.page = page;
    persist();
}

export function setUnits(units: UnitSystem): void {
    state.units = units;
    persist();
}

export function setPointMode(mode: PointMode): void {
    state.pointMode = mode;
    persist();
}

export function setPickPoint(lat: number, lon: number): void {
    state.pickLat = lat;
    state.pickLon = lon;
    state.pointMode = 'pick';
    persist();
}

export function addFavorite(name: string, lat: number, lon: number): void {
    const id = `fav-${Date.now()}`;
    state.favorites.push({ id, name, lat, lon });
    state.favoriteId = id;
    state.pointMode = 'favorite';
    persist();
}

export function removeFavorite(id: string): void {
    state.favorites = state.favorites.filter((f) => f.id !== id);
    if (state.favoriteId === id) state.favoriteId = null;
    persist();
}

export function selectFavorite(id: string): void {
    state.favoriteId = id;
    state.pointMode = 'favorite';
    persist();
}

export function setSpotFilter(patch: Partial<Pick<
    PersistedSettings,
    'spotScope' | 'spotRadiusMi' | 'spotOffice' | 'spotCategory' | 'spotHideComplete'
>>): void {
    if (patch.spotScope !== undefined) state.spotScope = normalizeSpotScope(patch.spotScope);
    if (patch.spotRadiusMi !== undefined) state.spotRadiusMi = clamp(patch.spotRadiusMi, 1, 500, 50);
    if (patch.spotOffice !== undefined) state.spotOffice = patch.spotOffice.toUpperCase();
    if (patch.spotCategory !== undefined) state.spotCategory = patch.spotCategory;
    if (patch.spotHideComplete !== undefined) state.spotHideComplete = patch.spotHideComplete;
    persist();
}
