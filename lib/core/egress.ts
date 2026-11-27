/**
 * Single HTTPS egress path through CloudTAK itself, no server route needed:
 * data requests use `POST /api/proxy`, map tiles use `GET /api/proxy/image`.
 * Requests carry the CloudTAK session (Bearer or ?token=).
 */
import { refreshAuthToken, withAuthQuery } from './auth-token.ts';
import { apiFetch } from './host.ts';

export const COORD_DECIMALS = 3;
/** CloudTAK image proxy, used for map tile URLs (no whitelist needed for public origins). */
export const PROXY_PATH = '/api/proxy/image';

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
 * Wrap an absolute HTTPS image/tile URL (optionally with MapLibre tokens) in CloudTAK's image proxy.
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
};

type ProxyReply = {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    encoding?: string;
};

/**
 * GET through CloudTAK's own `POST /api/proxy` (server-side request). The CloudTAK admin must
 * enable the proxy and whitelist the origin. Responses are capped at 1 MB by CloudTAK.
 */
async function proxyGet(url: string, opts: FetchJsonOpts): Promise<ProxyReply> {
    if (!hostAllowed(url)) throw new Error(`Host not allowlisted: ${url}`);
    await refreshAuthToken();
    const reply = await apiFetch('/api/proxy', {
        method: 'POST',
        signal: opts.signal,
        body: {
            url,
            method: 'GET',
            headers: {
                Accept: 'application/geo+json, application/json, text/*, */*',
                ...opts.headers,
            },
        },
    }) as ProxyReply;
    if (reply.status < 200 || reply.status >= 300) throw new Error(`HTTP ${reply.status}`);
    return reply;
}

function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOpts = {}): Promise<T> {
    const reply = await proxyGet(url, opts);
    if (reply.encoding === 'base64') {
        return JSON.parse(new TextDecoder().decode(decodeBase64(String(reply.body)))) as T;
    }
    return (typeof reply.body === 'string' ? JSON.parse(reply.body) : reply.body) as T;
}

export async function fetchText(url: string, opts: FetchJsonOpts = {}): Promise<string> {
    const reply = await proxyGet(url, opts);
    if (reply.encoding === 'base64') return new TextDecoder().decode(decodeBase64(String(reply.body)));
    return typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
}

/** Fetch raw bytes (e.g. gzipped AWC cache files) through the same proxy. */
export async function fetchBytes(url: string, opts: FetchJsonOpts = {}): Promise<ArrayBuffer> {
    const reply = await proxyGet(url, opts);
    const bytes = reply.encoding === 'base64'
        ? decodeBase64(String(reply.body))
        : new TextEncoder().encode(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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
