/**
 * NWS Spot Forecast Monitor — read-only.
 *
 * The spot.weather.gov API needs a key, so the national list of current
 * requests comes from NOAA's public "SPOT Forecast Monitor" map service
 * (refreshed upstream every ~15 minutes). Filtering is done here; forecasts
 * and the request form open on the official site.
 */
import { markRaw, reactive } from 'vue';
import { fetchJson, roundCoord, TtlCache } from '../core/egress.ts';

export const SPOT_SERVICE = 'https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/nws_fire_weather_spot/MapServer/0';
const SPOT_FIELDS = 'snumunum,name,type,tid,lat,lon,rmade,rfill,stat,wfo,deliverdtg';
export const SPOT_SITE = 'https://spot.weather.gov';
export const NEW_REQUEST_URL = `${SPOT_SITE}/new-request`;
/** Reuse the national list for this long before refetching (~230 KB). */
export const SPOT_CACHE_MS = 5 * 60_000;

export const SPOT_RADII_MI = [25, 50, 100, 250] as const;
export const SPOT_CATEGORIES = [
    'Fire',
    'Search and Rescue',
    'Hazardous Materials',
    'Marine',
    'Other',
] as const;

export type SpotScope = 'office' | 'radius' | 'all';
export type SpotStatus = 'complete' | 'pending';

/** Subset of a SPOT Forecast Monitor feature's properties (all strings upstream). */
type SpotFeatureProps = {
    snumunum?: string | null;
    name?: string | null;
    /** Category then delivery time, e.g. "Fire 2026-10-17 07:00:00 AM MDT". */
    type?: string | null;
    tid?: string | null;
    lat?: string | number | null;
    lon?: string | number | null;
    rmade?: string | null;
    /** Time filled, or "Incomplete". */
    rfill?: string | null;
    /** C = complete, P = pending (initial forecast or an update). */
    stat?: string | null;
    wfo?: string | null;
    deliverdtg?: string | null;
};

type SpotFeatureRaw = {
    properties?: SpotFeatureProps | null;
    geometry?: { type?: string; coordinates?: unknown } | null;
};

export type SpotRequest = {
    /** Spot request number, as used by spot.weather.gov/forecasts/{id}. */
    id: string;
    projectName: string;
    /** Wildfire / Prescribed, else the category. */
    requestType: string;
    lat: number;
    lon: number;
    incidentCategory: string;
    office: string;
    status: SpotStatus;
    submittedAt: number | null;
    deliverAt: number | null;
    filledAt: number | null;
    timeZone: string;
};

export type SpotFilter = {
    scope: SpotScope;
    office: string;
    radiusMi: number;
    lat: number | null;
    lon: number | null;
    /** '' = all categories. */
    category: string;
    hideComplete: boolean;
};

export type SpotRow = SpotRequest & { distanceMi: number | null };

export const spot = reactive({
    requests: [] as SpotRequest[],
    fetchedAt: null as number | null,
    loading: false,
    error: '',
    /** Office (CWA) for the shared query point, from api.weather.gov/points. */
    autoOffice: '',
});

let inflight: Promise<void> | null = null;
const officeCache = new TtlCache<string>(24 * 60 * 60_000);

/** Zone abbreviations on the service's timestamps: UTC offset (hours) and a zone for display. */
const ZONES: Record<string, { offset: number; iana: string }> = {
    EDT: { offset: -4, iana: 'America/New_York' },
    EST: { offset: -5, iana: 'America/New_York' },
    CDT: { offset: -5, iana: 'America/Chicago' },
    CST: { offset: -6, iana: 'America/Chicago' },
    MDT: { offset: -6, iana: 'America/Denver' },
    MST: { offset: -7, iana: 'America/Phoenix' },
    PDT: { offset: -7, iana: 'America/Los_Angeles' },
    PST: { offset: -8, iana: 'America/Los_Angeles' },
    AKDT: { offset: -8, iana: 'America/Anchorage' },
    AKST: { offset: -9, iana: 'America/Anchorage' },
    HST: { offset: -10, iana: 'Pacific/Honolulu' },
    AST: { offset: -4, iana: 'America/Puerto_Rico' },
    SST: { offset: -11, iana: 'Pacific/Pago_Pago' },
    CHST: { offset: 10, iana: 'Pacific/Guam' },
};

/** Request types by `tid`; other codes fall back to the category. */
const REQUEST_TYPES: Record<string, string> = {
    0: 'Wildfire',
    1: 'Prescribed',
};

const STAMP_RE = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?: [AP]M)? ([A-Za-z]+)$/;

/** "2026-10-17 13:00:03 PM MDT" → epoch ms. The hour is already 24-hour; AM/PM is redundant. */
function parseStamp(raw: unknown): number | null {
    const m = typeof raw === 'string' ? STAMP_RE.exec(raw.trim()) : null;
    const zone = m ? ZONES[m[7].toUpperCase()] : undefined;
    if (!m || !zone) return null;
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
    const t = Date.UTC(y, mo - 1, d, h - zone.offset, mi, s);
    return Number.isFinite(t) ? t : null;
}

function zoneOf(raw: unknown): string {
    const m = typeof raw === 'string' ? STAMP_RE.exec(raw.trim()) : null;
    return (m && ZONES[m[7].toUpperCase()]?.iana) || '';
}

function normalize(f: SpotFeatureRaw): SpotRequest | null {
    const p = f.properties;
    if (!p) return null;
    const coords = f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)
        ? f.geometry.coordinates as unknown[]
        : [];
    const lon = Number(coords[0] ?? p.lon);
    const lat = Number(coords[1] ?? p.lat);
    const id = String(p.snumunum ?? '').trim();
    const office = String(p.wfo || '').trim().toUpperCase();
    if (!/^\d+$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || !office) return null;
    const type = String(p.type || '').trim();
    // The category is whatever precedes the delivery time.
    const category = type.replace(/\s*\d{4}-\d{2}-\d{2}.*$/, '').trim();
    const deliver = p.deliverdtg || type;
    return {
        id,
        projectName: String(p.name || 'Unnamed request').trim(),
        requestType: REQUEST_TYPES[String(p.tid ?? '')] || category,
        lat,
        lon,
        incidentCategory: category,
        office,
        status: String(p.stat || '').toUpperCase() === 'C' ? 'complete' : 'pending',
        submittedAt: parseStamp(p.rmade),
        deliverAt: parseStamp(deliver),
        filledAt: parseStamp(p.rfill),
        timeZone: zoneOf(deliver) || zoneOf(p.rmade),
    };
}

/**
 * Load the national list of current requests. Reuses the cached list while it
 * is fresh unless `force`; concurrent callers share one request. On failure
 * the previous list is kept and `spot.error` is set.
 */
export function loadSpotRequests(force = false): Promise<void> {
    if (!force && spot.fetchedAt != null && Date.now() - spot.fetchedAt < SPOT_CACHE_MS) {
        return Promise.resolve();
    }
    if (inflight) return inflight;
    spot.loading = true;
    inflight = (async () => {
        try {
            // Query values stay unencoded: the LiveWX proxy encodes them upstream.
            const raw = await fetchJson<{ features?: unknown; error?: { message?: string } }>(
                `${SPOT_SERVICE}/query?where=1=1&outFields=${SPOT_FIELDS}&returnGeometry=true&outSR=4326&f=geojson`,
            );
            if (raw?.error) throw new Error(raw.error.message || 'Spot Monitor service error');
            if (!Array.isArray(raw?.features)) throw new Error('Unexpected Spot Monitor response');
            const list: SpotRequest[] = [];
            for (const item of raw.features as SpotFeatureRaw[]) {
                const n = normalize(item);
                if (n) list.push(n);
            }
            // The list is replaced wholesale; no need for deep reactivity.
            spot.requests = markRaw(list);
            spot.fetchedAt = Date.now();
            spot.error = '';
        } catch (e) {
            spot.error = e instanceof Error ? e.message : 'Spot Monitor request failed';
        } finally {
            spot.loading = false;
            inflight = null;
        }
    })();
    return inflight;
}

/** NWS office (CWA) responsible for a point, or '' if unknown. */
export async function officeForPoint(lat: number, lon: number): Promise<string> {
    const key = `${roundCoord(lat)},${roundCoord(lon)}`;
    const hit = officeCache.get(key);
    if (hit != null) return hit;
    const body = await fetchJson<{ properties?: { cwa?: string } }>(
        `https://api.weather.gov/points/${key}`,
    );
    const cwa = String(body.properties?.cwa || '').toUpperCase();
    officeCache.set(key, cwa);
    return cwa;
}

/** Resolve `spot.autoOffice` for the given point; clears it when there is none. */
export async function refreshAutoOffice(lat: number | null, lon: number | null): Promise<void> {
    if (lat == null || lon == null) {
        spot.autoOffice = '';
        return;
    }
    try {
        spot.autoOffice = await officeForPoint(lat, lon);
    } catch {
        // Keep the previous value; the office select still works.
    }
}

export function isComplete(r: SpotRequest): boolean {
    return r.status === 'complete';
}

export function statusLabel(status: SpotStatus): string {
    return status === 'complete' ? 'Complete' : 'Pending';
}

export function forecastUrl(id: string): string {
    return `${SPOT_SITE}/forecasts/${encodeURIComponent(id)}`;
}

export function officeUrl(office: string): string {
    return `${SPOT_SITE}/${encodeURIComponent(office.toUpperCase())}`;
}

/** Great-circle distance in statute miles. */
export function distanceMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3958.8;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Requests matching the category / hide-complete filters (no location scope). */
export function matchesContent(r: SpotRequest, category: string, hideComplete: boolean): boolean {
    if (hideComplete && isComplete(r)) return false;
    if (category && r.incidentCategory !== category) return false;
    return true;
}

/** Apply the Spot page filters; sorted by distance for radius scope, else newest delivery first. */
export function filterSpotRequests(list: SpotRequest[], f: SpotFilter): SpotRow[] {
    const hasPoint = f.lat != null && f.lon != null;
    const office = f.office.toUpperCase();
    const rows: SpotRow[] = [];
    for (const r of list) {
        if (!matchesContent(r, f.category, f.hideComplete)) continue;
        const d = hasPoint ? distanceMi(f.lat as number, f.lon as number, r.lat, r.lon) : null;
        if (f.scope === 'office' && r.office !== office) continue;
        if (f.scope === 'radius' && (d == null || d > f.radiusMi)) continue;
        rows.push({ ...r, distanceMi: d });
    }
    if (f.scope === 'radius') {
        rows.sort((a, b) => (a.distanceMi ?? 0) - (b.distanceMi ?? 0));
    } else {
        rows.sort((a, b) => (b.deliverAt ?? 0) - (a.deliverAt ?? 0));
    }
    return rows;
}

/** Offices present in the list, sorted. */
export function listOffices(list: SpotRequest[]): string[] {
    return [...new Set(list.map((r) => r.office))].sort((a, b) => a.localeCompare(b));
}
