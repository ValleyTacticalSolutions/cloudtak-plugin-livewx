/* eslint-disable */
/**
 * CloudTAK server routes for LiveWX:
 *  - Blitzortung relay (clients never connect to Blitzortung directly)
 *  - Optional allowlisted HTTPS proxy for CORS-blocked weather hosts
 *
 * Copy to CloudTAK api/stateless/routes/ via install.sh.
 *
 * Export signature must match other plugin routes (e.g. plugin-qpd.ts):
 *   export default async function router(schema, config)
 */
import { gunzipSync } from 'node:zlib';
import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';

type Strike = { lat: number; lon: number; timeMs: number };

type WsLike = {
    readyState: number;
    send: (data: string) => void;
    close: () => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
};

const WS_SERVERS = [
    'wss://ws1.blitzortung.org',
    'wss://ws7.blitzortung.org',
    'wss://ws8.blitzortung.org',
];

const PROXY_ALLOW = new Set([
    'api.weather.gov',
    'api.open-meteo.com',
    'mapservices.weather.noaa.gov',
    'nowcoast.noaa.gov',
    'services.arcgis.com',
    'services3.arcgis.com',
    'api.water.noaa.gov',
    'www.ndbc.noaa.gov',
    'earthquake.usgs.gov',
    'api.avalanche.org',
    'services.dat.noaa.gov',
    'api.rainviewer.com',
    'tilecache.rainviewer.com',
    'mesonet.agron.iastate.edu',
    'opengeo.ncep.noaa.gov',
    'geo.weather.gc.ca',
    'fsapps.nwcg.gov',
    'www.nfmdb.org',
    'gacc.nifc.gov',
    'maps.water.noaa.gov',
    'www.nhc.noaa.gov',
    'api.tidesandcurrents.noaa.gov',
    'wcc.sc.egov.usda.gov',
    'data.cocorahs.org',
    'waterservices.usgs.gov',
    'waterdata.usgs.gov',
    'geocoding.geo.census.gov',
    'nomads.ncep.noaa.gov',
    'radar.weather.gov',
    'aviationweather.gov',
]);

const MAX_STRIKES = 4000;
const STALE_MS = 10 * 60_000;
const WS_CLOSED = 3;

let strikes: Strike[] = [];
let upstream: WsLike | null = null;
let upstreamIdx = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let connected = false;
let wsCtor: (new (url: string) => WsLike) | null | undefined;
let wsLoadAttempted = false;

function lzwDecode(input: string): string {
    const dict: Record<number, string> = {};
    const data = input.split('');
    let currChar = data[0];
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    let phrase: string;
    for (let i = 1; i < data.length; i++) {
        const currCode = data[i].charCodeAt(0);
        if (currCode < 256) phrase = data[i];
        else phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join('');
}

function prune(): void {
    const cutoff = Date.now() - STALE_MS;
    strikes = strikes.filter((s) => s.timeMs >= cutoff);
}

async function loadWsCtor(): Promise<(new (url: string) => WsLike) | null> {
    if (wsLoadAttempted) return wsCtor ?? null;
    wsLoadAttempted = true;
    // Prefer Node built-in WebSocket (Node 22+) so we do not hard-depend on `ws`.
    const g = globalThis as unknown as { WebSocket?: new (url: string) => WsLike };
    if (typeof g.WebSocket === 'function') {
        wsCtor = g.WebSocket;
        return wsCtor;
    }
    try {
        const mod = await import('ws');
        wsCtor = (mod.default || mod) as new (url: string) => WsLike;
        return wsCtor;
    } catch (err) {
        console.error('[livewx] WebSocket client unavailable — lightning relay disabled', err);
        wsCtor = null;
        return null;
    }
}

function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectUpstream();
    }, 4000);
}

async function connectUpstream(): Promise<void> {
    const Ctor = await loadWsCtor();
    if (!Ctor) {
        connected = false;
        return;
    }
    if (upstream) {
        try { upstream.close(); } catch { /* ignore */ }
        upstream = null;
    }
    const url = WS_SERVERS[upstreamIdx % WS_SERVERS.length];
    upstreamIdx++;
    try {
        upstream = new Ctor(url);
    } catch (err) {
        console.error('[livewx] upstream connect failed', err);
        connected = false;
        scheduleReconnect();
        return;
    }

    // Support both EventTarget (built-in) and EventEmitter (`ws`) styles.
    const sock = upstream as WsLike & {
        addEventListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };

    const onOpen = () => {
        connected = true;
        try { upstream?.send(JSON.stringify({ a: 111 })); } catch { /* ignore */ }
    };
    const onMessage = (...args: unknown[]) => {
        try {
            const data = args[0];
            const raw = typeof data === 'string'
                ? data
                : (data && typeof data === 'object' && 'data' in (data as object)
                    ? String((data as { data: unknown }).data)
                    : String(data));
            const decoded = lzwDecode(raw);
            const rec = JSON.parse(decoded) as { lat?: number; lon?: number; time?: number };
            if (typeof rec.lat !== 'number' || typeof rec.lon !== 'number') return;
            strikes.push({
                lat: rec.lat,
                lon: rec.lon,
                timeMs: rec.time ? Math.round(rec.time / 1e6) : Date.now(),
            });
            if (strikes.length > MAX_STRIKES) strikes = strikes.slice(-MAX_STRIKES + 500);
        } catch {
            /* ignore */
        }
    };
    const onClose = () => {
        connected = false;
        scheduleReconnect();
    };
    const onError = () => {
        connected = false;
        try { upstream?.close(); } catch { /* ignore */ }
    };

    if (typeof sock.on === 'function') {
        sock.on('open', onOpen);
        sock.on('message', onMessage);
        sock.on('close', onClose);
        sock.on('error', onError);
    } else if (typeof sock.addEventListener === 'function') {
        sock.addEventListener('open', onOpen);
        sock.addEventListener('message', onMessage);
        sock.addEventListener('close', onClose);
        sock.addEventListener('error', onError);
    }
}

async function ensureUpstream(): Promise<void> {
    if (!pruneTimer) {
        pruneTimer = setInterval(prune, 5000);
    }
    if (!upstream || upstream.readyState === WS_CLOSED) {
        await connectUpstream();
    }
}

export default async function router(schema: Schema, config: ConfigStateless) {
    // Do NOT connect upstream at boot — lazy on first lightning request.
    // A bad import/connect must never prevent the API from starting.

    await schema.get('/livewx/lightning', {
        name: 'LiveWX Lightning Relay',
        group: 'LiveWX',
        description: 'Recent Blitzortung strikes via CloudTAK relay (CC BY-SA 4.0). Not for warnings.',
        query: Type.Object({
            since: Type.Optional(Type.Integer()),
            // Same pattern as /api/fonts — MapLibre / simple fetch may pass token in query.
            token: Type.Optional(Type.String()),
        }),
        res: Type.Object({
            connected: Type.Boolean(),
            attribution: Type.String(),
            disclaimer: Type.String(),
            strikes: Type.Array(Type.Object({
                lat: Type.Number(),
                lon: Type.Number(),
                timeMs: Type.Integer(),
            })),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req, { token: true });
            await ensureUpstream();
            prune();
            const since = Number(req.query.since) || 0;
            const out = strikes.filter((s) => s.timeMs > since);
            res.json({
                connected,
                attribution: 'Lightning data © Blitzortung.org & contributors (CC BY-SA 4.0)',
                disclaimer: 'Entertainment / situational awareness only — not for life safety or official warning.',
                strikes: out.slice(-1000),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/livewx/proxy', {
        name: 'LiveWX Proxy',
        group: 'LiveWX',
        description: 'Allowlisted HTTPS proxy for weather hosts blocked by browser CORS.',
        query: Type.Object({
            url: Type.String(),
            // Required for MapLibre raster tiles (cannot set Authorization headers).
            token: Type.Optional(Type.String()),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req, { token: true });
            const raw = String(req.query.url || '');
            let host: string;
            try {
                host = new URL(raw.split('?')[0]).hostname;
            } catch {
                throw new Err(400, null, 'Invalid url');
            }
            if (!raw.startsWith('https:') || !PROXY_ALLOW.has(host)) {
                throw new Err(403, null, 'Host not allowlisted');
            }
            // Re-encode query values. Express decodes the url= param, which turns
            // ArcGIS renderingRule JSON into bare {"} and upstream then 400s.
            const upstreamHref = encodeUpstreamUrl(raw);
            const upstreamRes = await fetch(upstreamHref, {
                headers: {
                    Accept: 'application/geo+json, application/json, image/*, */*',
                    // Ask for an uncompressed body: on some CloudTAK API runtimes
                    // fetch() hands back gzip bytes undecoded and without the
                    // upstream content-type, which breaks JSON parsing in the client.
                    'Accept-Encoding': 'identity',
                    'User-Agent': 'CloudTAK-LiveWX-Relay/2.0',
                },
            });
            const upstreamCt = upstreamRes.headers.get('content-type');
            const upstreamBody = Buffer.from(await upstreamRes.arrayBuffer());
            // Never unpack a file that is gzip by design (e.g. the AWC METAR
            // cache .csv.gz) — the client decompresses those itself.
            const buf = isGzipFile(upstreamHref, upstreamCt) ? upstreamBody : decodeBody(upstreamBody);
            const ct = upstreamCt || sniffContentType(buf);
            // MapLibre raster tiles must be real images — WMS often returns XML
            // ServiceExceptions with HTTP 200; ArcGIS may return HTML error pages.
            const wantsImage = /(?:GetMap|exportImage|\/export\b|format=png)/i.test(upstreamHref);
            const looksPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
            const looksGif = buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
            const looksJpeg = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
            if (wantsImage && upstreamRes.ok && !looksPng && !looksGif && !looksJpeg) {
                throw new Err(502, null, `Upstream did not return an image (${ct})`);
            }
            res.header('Content-Type', ct);
            // Avoid caching authenticated proxy responses in shared caches / SW.
            res.header('Cache-Control', 'private, no-store');
            res.status(upstreamRes.status);
            res.send(buf);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}

/** True for resources that are gzip files themselves rather than gzip-encoded responses. */
function isGzipFile(href: string, contentType: string | null): boolean {
    if (contentType && /gzip/i.test(contentType)) return true;
    try {
        return /\.gz$/i.test(new URL(href).pathname);
    } catch {
        return false;
    }
}

/** Gunzip a body that still carries the gzip magic bytes (left undecoded upstream). */
function decodeBody(buf: Buffer): Buffer {
    if (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
    try {
        return gunzipSync(buf);
    } catch {
        return buf;
    }
}

/** Content type for a body whose upstream header was missing. */
function sniffContentType(buf: Buffer): string {
    const head = buf.subarray(0, 64).toString('utf8').trimStart();
    if (head.startsWith('{') || head.startsWith('[')) return 'application/json';
    return 'application/octet-stream';
}

/** Rebuild an absolute HTTPS URL with properly encoded query values. */
function encodeUpstreamUrl(raw: string): string {
    const q = raw.indexOf('?');
    if (q < 0) return raw;
    const base = raw.slice(0, q);
    const query = raw.slice(q + 1);
    const parts = [];
    for (const part of query.split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        if (eq < 0) {
            parts.push(encodeURIComponent(part));
            continue;
        }
        const key = part.slice(0, eq);
        const val = part.slice(eq + 1);
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }
    return `${base}?${parts.join('&')}`;
}
