/**
 * CloudTAK session token and server base URL for /api/* calls.
 * Works in the web build (page origin is the server) and in the iOS/Android apps
 * (page origin is the app, so API paths must be made absolute).
 * Auth requires Authorization: Bearer or ?token= (see api/common/auth.ts).
 */
import { serverUrl, token } from './host.ts';

let cached: string | undefined;
let base = '';
let lastRefresh = 0;
const REFRESH_MS = 30_000;

/** Refresh the cached token and server URL (call on plugin init and before layer starts). */
export async function refreshAuthToken(): Promise<string | undefined> {
    cached = await token();
    base = await serverUrl();
    lastRefresh = Date.now();
    return cached;
}

/** Sync accessor for MapLibre tile URL builders. */
export function authToken(): string | undefined {
    if (!cached || Date.now() - lastRefresh > REFRESH_MS) {
        // Kick a background refresh; return last known value for this paint.
        void refreshAuthToken();
    }
    return cached;
}

/** Attach Bearer header when we have a token. */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const t = authToken();
    const out: Record<string, string> = { ...extra };
    if (t && !out.Authorization) out.Authorization = `Bearer ${t}`;
    return out;
}

/** Make a server-relative path absolute against the CloudTAK server (needs a prior refreshAuthToken). */
export function absoluteUrl(url: string): string {
    if (!url.startsWith('/')) return url;
    return `${base || location.origin}${url}`;
}

/**
 * Absolute URL with ?token= / &token= for MapLibre tile requests (CloudTAK fonts use the same pattern).
 * Prefer Authorization headers for fetch(); use this when the browser cannot set headers.
 */
export function withAuthQuery(url: string): string {
    const abs = absoluteUrl(url);
    const t = authToken();
    if (!t) return abs;
    if (/[?&]token=/.test(abs)) return abs;
    return `${abs}${abs.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`;
}
