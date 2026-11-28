import { RAINVIEWER_API } from '../core/constants.ts';
import { PROXY_PATH, fetchJson, viaProxy } from '../core/egress.ts';
import { refreshAuthToken, withAuthQuery } from '../core/auth-token.ts';
import { apiFetch } from '../core/host.ts';
import type { ScanFrame } from './tiles.ts';

type RainviewerMaps = {
    host?: string;
    radar?: {
        past?: Array<{ path: string; time: number }>;
        nowcast?: Array<{ path: string; time: number }>;
    };
};

export type RainviewerSnapshot = {
    host: string;
    /** Latest observed (past) frame path. */
    path: string;
    /** Observed past frames oldest → newest (no nowcast). */
    frames: ScanFrame[];
    at: number;
};

let cached: RainviewerSnapshot | null = null;

/**
 * Read the RainViewer index. Prefer the data proxy; when the admin has not whitelisted
 * api.rainviewer.com (it answers 403), fall back to the image proxy, which needs no whitelist.
 */
async function fetchMaps(): Promise<RainviewerMaps> {
    try {
        return await fetchJson<RainviewerMaps>(RAINVIEWER_API);
    } catch {
        await refreshAuthToken();
        const path = withAuthQuery(`${PROXY_PATH}?url=${encodeURIComponent(RAINVIEWER_API)}`);
        const body = await apiFetch(path);
        return (typeof body === 'string' ? JSON.parse(body) : body) as RainviewerMaps;
    }
}

/**
 * RainViewer public weather-maps.json: past frames (~2 h, 10 min) for replay.
 * Matches Atmosphere: use observed past only, not nowcast forecast frames.
 * Style 6 = NEXRAD Level III palette so the picture matches US mosaics at the border.
 */
export async function fetchRainviewerHost(): Promise<RainviewerSnapshot | null> {
    if (cached && Date.now() - cached.at < 60_000) return cached;
    try {
        const body = await fetchMaps();
        // Always ask the consented tile host (Atmosphere does the same).
        const host = 'https://tilecache.rainviewer.com';
        const past = body.radar?.past ?? [];
        const frames: ScanFrame[] = [];
        for (const f of past) {
            if (!f?.path || !f.time) continue;
            const at = f.time * 1000;
            frames.push({
                stamp: f.path,
                label: new Date(at).toISOString().slice(11, 16) + 'Z',
                at,
            });
        }
        const last = frames[frames.length - 1];
        if (!last) return null;
        cached = { host, path: last.stamp, frames, at: Date.now() };
        return cached;
    } catch {
        return null;
    }
}

/**
 * MapLibre raster tile template for RainViewer universal composite.
 * size 256 / color scheme 6 (NEXRAD III) / smooth+snow.
 * Server plates above zoom 7 — keep maxzoom ≤ 7 on the source.
 * Routed through the same-origin proxy so CSP connect-src stays on 'self'.
 */
export function rainviewerTileUrl(host: string, path: string): string {
    return viaProxy(`${host}${path}/256/{z}/{x}/{y}/6/1_1.png`);
}

export function clearRainviewerCache(): void {
    cached = null;
}
