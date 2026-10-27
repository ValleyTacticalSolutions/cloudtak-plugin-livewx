/**
 * Single HTTPS egress path: allowlisted hosts via CloudTAK /api/livewx/proxy.
 * Requests must carry the CloudTAK session (Bearer or ?token=).
 */
import { authHeaders, authToken, refreshAuthToken, withAuthQuery } from './auth-token.ts';

export const COORD_DECIMALS = 3;
export const PROXY_PATH = '/api/livewx/proxy';

/** Hosts the plugin may contact from the browser (or via proxy). */
export const ALLOWED_HOSTS = new Set([
    'api.weather.gov',
    'api.open-meteo.com',
    'mesonet.agron.iastate.edu',
    'mapservices.weather.noaa.gov',
    'opengeo.ncep.noaa.gov',
    'geo.weather.gc.ca',
    'api.rainviewer.com',
    'tilecache.rainviewer.com',
    'nowcoast.noaa.gov',
    'nomads.ncep.noaa.gov',
    'maps.water.noaa.gov',
    'api.water.noaa.gov',
    'www.ndbc.noaa.gov',
    'api.tidesandcurrents.noaa.gov',
    'www.nhc.noaa.gov',
    'api.avalanche.org',
    'wcc.sc.egov.usda.gov',
    'services.arcgis.com',
    'services3.arcgis.com',
    'geocoding.geo.census.gov',
    'fsapps.nwcg.gov',
    'www.nfmdb.org',
    'data.cocorahs.org',
    'waterservices.usgs.gov',
    'waterdata.usgs.gov',
    'earthquake.usgs.gov',
    'services.dat.noaa.gov',
    'gacc.nifc.gov',
    'radar.weather.gov',
    'aviationweather.gov',
]);

/** MapLibre template tokens that must stay literal inside a proxied URL. */
const TILE_TOKENS = [
    '{z}', '{x}', '{y}',
    '{bbox-epsg-3857}',
    '{bbox-epsg-4326}',
    '{quadkey}',
];

export function roundCoord(n: number, decimals = COORD_DECIMALS): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

export function hostAllowed(url: string): boolean {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:') return false;
        return ALLOWED_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
}

/**
 * Wrap an absolute HTTPS URL (optionally with MapLibre tokens) in the same-origin proxy.
 * Includes ?token= so MapLibre tile fetches authenticate (fonts use the same pattern).
 */
export function viaProxy(url: string): string {
    let encoded = encodeURIComponent(url);
    for (const tok of TILE_TOKENS) {
        encoded = encoded.replaceAll(encodeURIComponent(tok), tok);
    }
    return withAuthQuery(`${PROXY_PATH}?url=${encoded}`);
}

export type FetchJsonOpts = {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    /** When true, skip host allowlist (same-origin CloudTAK API only). */
    sameOrigin?: boolean;
    /** Skip proxy (for same-origin or already-proxied URLs). */
    noProxy?: boolean;
};

async function doFetch(url: string, opts: FetchJsonOpts): Promise<Response> {
    const sameOrigin = url.startsWith('/') || url.includes(PROXY_PATH) || Boolean(opts.sameOrigin);
    // Refresh token before authenticated API calls so a stale cache does not 401.
    if (sameOrigin) await refreshAuthToken();
    return fetch(url, {
        signal: opts.signal,
        credentials: sameOrigin ? 'same-origin' : 'omit',
        headers: authHeaders({
            Accept: 'application/geo+json, application/json, image/*, */*',
            ...opts.headers,
        }),
    });
}

function resolveFetchUrl(url: string, opts: FetchJsonOpts): string {
    if (opts.sameOrigin || opts.noProxy || url.startsWith('/') || url.includes(PROXY_PATH)) {
        return withAuthQuery(url);
    }
    if (!hostAllowed(url)) {
        throw new Error(`Host not allowlisted: ${url}`);
    }
    return viaProxy(url);
}

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOpts = {}): Promise<T> {
    const target = resolveFetchUrl(url, opts);
    if (target.includes(PROXY_PATH) && !authToken()) {
        await refreshAuthToken();
        if (!authToken()) {
            throw new Error('Not signed in — CloudTAK token required for weather proxy');
        }
    }
    const res = await doFetch(target, {
        ...opts,
        sameOrigin: target.startsWith('/') || Boolean(opts.sameOrigin),
    });
    if (!res.ok) {
        if (res.status === 401) {
            throw new Error('HTTP 401 — re-login or redeploy server route with token auth');
        }
        throw new Error(`HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export async function fetchText(url: string, opts: FetchJsonOpts = {}): Promise<string> {
    const target = resolveFetchUrl(url, opts);
    const res = await doFetch(target, {
        ...opts,
        sameOrigin: target.startsWith('/') || Boolean(opts.sameOrigin),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

/** Fetch raw bytes (e.g. gzipped AWC cache files) through the same proxy path. */
export async function fetchBytes(url: string, opts: FetchJsonOpts = {}): Promise<ArrayBuffer> {
    const target = resolveFetchUrl(url, opts);
    if (target.includes(PROXY_PATH) && !authToken()) {
        await refreshAuthToken();
        if (!authToken()) {
            throw new Error('Not signed in — CloudTAK token required for weather proxy');
        }
    }
    const res = await doFetch(target, {
        ...opts,
        sameOrigin: target.startsWith('/') || Boolean(opts.sameOrigin),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
}

export function ageLabelMs(at: number | null | undefined): string {
    if (at == null || !Number.isFinite(at)) return '—';
    const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    return `${hr}h ago`;
}

/** Cache entry with stale-while-revalidate semantics. */
export class TtlCache<T> {
    private store = new Map<string, { at: number; value: T }>();

    constructor(private ttlMs: number) {}

    get(key: string): T | undefined {
        const e = this.store.get(key);
        if (!e) return undefined;
        if (Date.now() - e.at > this.ttlMs) return undefined;
        return e.value;
    }

    peek(key: string): { value: T; at: number; stale: boolean } | undefined {
        const e = this.store.get(key);
        if (!e) return undefined;
        return { value: e.value, at: e.at, stale: Date.now() - e.at > this.ttlMs };
    }

    set(key: string, value: T): void {
        this.store.set(key, { at: Date.now(), value });
    }

    clear(): void {
        this.store.clear();
    }
}
