import { CONUS_SITE_ID, IEM_JSON_BASE, IEM_TMS_BASE, PROTOCOL_NAME } from '../core/constants.ts';
import { viaProxy } from '../core/egress.ts';
import { apiFetch } from '../core/host.ts';
import { filterImageData } from './palette.ts';
import { knownProductCodes, siteCode } from './products.ts';
import type { FilterKind, RadarProduct } from './products.ts';
import { isMosaic, toIemId } from './sites.ts';

export interface TileRequest {
    siteId: string;
    product: RadarProduct;
    siteType: string;
    stamp: string;
    filter: number;
    tilt: number;
    cacheBust: number;
}

let protocolReady = false;
let protocolFailed = false;

type ProtocolParams = {
    url?: string;
    type?: string;
};

type AddProtocol = (
    name: string,
    handler: (params: ProtocolParams, abort?: AbortController) => Promise<{ data: ArrayBuffer | ImageBitmap | ImageData }>,
) => void;

/** Set by vite.bundle.config.ts: the runtime bundle carries its own maplibre copy, whose protocol registry the host map never sees */
declare const __CLOUDTAK_BUNDLE__: boolean | undefined;

async function maplibreModule(): Promise<{ addProtocol?: AddProtocol; removeProtocol?: (name: string) => void } | null> {
    // Bundle build: no custom protocol, so the radar falls back to plain proxied tiles (no min-value filter)
    if (typeof __CLOUDTAK_BUNDLE__ !== 'undefined' && __CLOUDTAK_BUNDLE__) return null;
    try {
        const ml = await import('maplibre-gl') as {
            addProtocol?: AddProtocol;
            removeProtocol?: (name: string) => void;
            default?: { addProtocol?: AddProtocol; removeProtocol?: (name: string) => void };
        };
        return {
            addProtocol: ml.addProtocol ?? ml.default?.addProtocol,
            removeProtocol: ml.removeProtocol ?? ml.default?.removeProtocol,
        };
    } catch {
        return null;
    }
}

function httpsFromProtocol(url: string): string {
    return url.replace(`${PROTOCOL_NAME}://`, 'https://');
}

const TILE_CACHE_MAX = 96;
const originalTiles = new Map<string, Promise<Blob>>();

function cacheKey(parsed: URL): string {
    const u = new URL(parsed.toString());
    u.searchParams.delete('f');
    u.searchParams.delete('k');
    return u.toString();
}

function cachedBlob(key: string, load: () => Promise<Blob>): Promise<Blob> {
    const hit = originalTiles.get(key);
    if (hit) {
        originalTiles.delete(key);
        originalTiles.set(key, hit);
        return hit;
    }
    const pending = load().catch((err: unknown) => {
        originalTiles.delete(key);
        throw err;
    });
    originalTiles.set(key, pending);
    if (originalTiles.size > TILE_CACHE_MAX) {
        const oldest = originalTiles.keys().next().value;
        if (oldest) originalTiles.delete(oldest);
    }
    return pending;
}

type ProtocolResult = { data: ArrayBuffer | ImageBitmap | ImageData };

async function handleProtocol(
    params: ProtocolParams,
): Promise<ProtocolResult> {
    const raw = params.url ?? '';
    const parsed = new URL(httpsFromProtocol(raw));
    const threshold = Number(parsed.searchParams.get('f') ?? '0');
    const kind = (parsed.searchParams.get('k') ?? 'reflectivity') as FilterKind;
    parsed.searchParams.delete('f');
    parsed.searchParams.delete('k');

    const blob = await cachedBlob(cacheKey(parsed), async () => {
        const response = await apiFetch(viaProxy(parsed.toString()), { raw: true });
        if (!response.ok) {
            throw new Error(`Radar tile HTTP ${response.status}`);
        }
        return response.blob();
    });

    if (threshold <= 0) {
        return { data: await blob.arrayBuffer() };
    }

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        bitmap.close();
        return { data: await blob.arrayBuffer() };
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    filterImageData(image.data, kind, threshold);
    ctx.putImageData(image, 0, 0);
    return { data: await createImageBitmap(canvas) };
}

export async function ensureFilterProtocol(): Promise<boolean> {
    if (protocolReady) return true;
    if (protocolFailed) return false;
    const ml = await maplibreModule();
    if (!ml?.addProtocol) {
        protocolFailed = true;
        return false;
    }
    try {
        ml.addProtocol(PROTOCOL_NAME, handleProtocol);
        protocolReady = true;
        return true;
    } catch {
        protocolFailed = true;
        return false;
    }
}

export async function removeFilterProtocol(): Promise<void> {
    if (!protocolReady) return;
    const ml = await maplibreModule();
    try {
        ml?.removeProtocol?.(PROTOCOL_NAME);
    } catch {
        /* ignore */
    }
    protocolReady = false;
}

function mosaicLayerName(product: RadarProduct, stamp: string): string {
    const layer = product.mosaicLayer ?? 'nexrad-n0q';
    if (!stamp || stamp === '0' || stamp === 'live') return layer;
    // IEM loop layers: nexrad-n0q-m05m … nexrad-n0q-m55m
    if (/^m\d{2}m$/.test(stamp)) return `${layer}-${stamp}`;
    // RIDGE mosaic archive: ridge::USCOMP-N0Q-YYYYMMDDHHMI
    return `ridge::USCOMP-${product.iemCode === 'N0B' ? 'N0Q' : product.iemCode}-${stamp}`;
}

function ridgeLayerName(
    siteId: string,
    product: RadarProduct,
    siteType: string,
    stamp: string,
    tilt: number,
): string {
    const sector = toIemId(siteId);
    const prod = siteCode(product, siteType, tilt);
    const when = !stamp || stamp === 'live' ? '0' : stamp;
    return `ridge::${sector}-${prod}-${when}`;
}

export function iemLayerName(req: TileRequest): string {
    if (isMosaic(req.siteId) || req.siteId === CONUS_SITE_ID) {
        return mosaicLayerName(req.product, req.stamp);
    }
    return ridgeLayerName(req.siteId, req.product, req.siteType, req.stamp, req.tilt);
}

export function tileUrl(req: TileRequest, useProtocol: boolean): string {
    const layer = iemLayerName(req);
    const query = new URLSearchParams();
    if (req.cacheBust) query.set('t', String(req.cacheBust));
    if (useProtocol) {
        query.set('f', String(req.filter));
        query.set('k', req.product.filterKind);
    }
    const qs = query.toString();
    const path = `${IEM_TMS_BASE}/${layer}/{z}/{x}/{y}.png${qs ? `?${qs}` : ''}`;
    if (useProtocol) {
        return path.replace('https://', `${PROTOCOL_NAME}://`);
    }
    // Tiles go through the CloudTAK proxy (token in the query) so they load in the apps too
    return viaProxy(path);
}

export function mosaicLoopStamps(): string[] {
    const stamps: string[] = [];
    for (let m = 55; m >= 5; m -= 5) {
        stamps.push(`m${String(m).padStart(2, '0')}m`);
    }
    return stamps;
}

export async function fetchAvailableProducts(iemId: string): Promise<string[] | null> {
    try {
        const url = `${IEM_JSON_BASE}/radar.py?operation=available&radar=${encodeURIComponent(iemId)}`;
        const res = await apiFetch(viaProxy(url), { raw: true });
        if (!res.ok) return null;
        const body = await res.json() as unknown;
        return extractProductCodes(body);
    } catch {
        return null;
    }
}

function extractProductCodes(body: unknown): string[] {
    const found = new Set<string>();
    const visit = (value: unknown): void => {
        if (typeof value === 'string') {
            const v = value.toUpperCase();
            if (/^[A-Z][A-Z0-9]{2,3}$/.test(v)) found.add(v);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                if (/product/i.test(k) || k === 'id' || k === 'code') visit(v);
                else if (typeof v !== 'string' || v.length > 8) visit(v);
            }
        }
    };
    visit(body);
    const known = knownProductCodes();
    return [...found].filter((code) => known.has(code));
}

export interface ScanFrame {
    stamp: string;
    label: string;
    at: number;
}

export async function fetchSiteScans(
    iemId: string,
    productCode: string,
    startIso: string,
    endIso: string,
): Promise<ScanFrame[]> {
    try {
        const url = `${IEM_JSON_BASE}/radar.py?operation=list`
            + `&radar=${encodeURIComponent(iemId)}`
            + `&product=${encodeURIComponent(productCode)}`
            + `&start=${encodeURIComponent(startIso)}`
            + `&end=${encodeURIComponent(endIso)}`;
        const res = await apiFetch(viaProxy(url), { raw: true });
        if (!res.ok) return [];
        const body = await res.json() as unknown;
        return extractScans(body);
    } catch {
        return [];
    }
}

function extractScans(body: unknown): ScanFrame[] {
    const frames: ScanFrame[] = [];
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value && typeof value === 'object') {
            const rec = value as Record<string, unknown>;
            const ts = rec.ts ?? rec.valid ?? rec.datetime ?? rec.time ?? rec.utc;
            if (typeof ts === 'string') {
                const at = Date.parse(ts);
                if (!Number.isNaN(at)) {
                    frames.push({
                        stamp: toRidgeStamp(new Date(at)),
                        label: new Date(at).toISOString().replace('.000Z', 'Z'),
                        at,
                    });
                }
            }
            for (const v of Object.values(rec)) {
                if (v && typeof v === 'object') visit(v);
            }
        }
    };
    visit(body);
    frames.sort((a, b) => a.at - b.at);
    const uniq = new Map<string, ScanFrame>();
    for (const f of frames) uniq.set(f.stamp, f);
    return [...uniq.values()];
}

export function toRidgeStamp(date: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
        + `${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
}

export function mosaicFrameLabel(stamp: string): string {
    if (!stamp || stamp === '0' || stamp === 'live') return 'Live';
    const match = /^m(\d{2})m$/.exec(stamp);
    if (match) return `${Number(match[1])} Min Ago`;
    return stamp;
}

export function minutesAgo(at: number, now = Date.now()): number {
    if (!Number.isFinite(at) || at <= 0) return 0;
    return Math.max(0, Math.round((now - at) / 60_000));
}

export function ageLabel(at: number, now = Date.now()): string {
    const min = minutesAgo(at, now);
    if (min < 1) return 'Just Now';
    if (min === 1) return '1 Min Ago';
    return `${min} Min Ago`;
}

export function radarUpdatedLabel(at: number | null, now = Date.now()): string {
    if (at == null || !Number.isFinite(at) || at <= 0) return 'Radar Age Unknown';
    const min = minutesAgo(at, now);
    if (min < 1) return 'Radar Updated Just Now';
    if (min === 1) return 'Radar Updated 1 Min Ago';
    return `Radar Updated ${min} Min Ago`;
}

export function shortAgeLabel(at: number, now = Date.now()): string {
    const min = minutesAgo(at, now);
    if (min < 1) return 'now';
    return `${min}m`;
}

export async function fetchMosaicValidAt(): Promise<number | null> {
    try {
        const res = await apiFetch(viaProxy(`${IEM_JSON_BASE}/tms.py`), { raw: true });
        if (!res.ok) return null;
        const body = await res.json() as {
            services?: Array<{ id?: string; utc_valid?: string; layername?: string }>;
        };
        const services = body.services ?? [];
        const prefer = services.find((s) => /n0q/i.test(`${s.id ?? ''} ${s.layername ?? ''}`))
            ?? services[0];
        if (!prefer?.utc_valid) return null;
        const at = Date.parse(prefer.utc_valid);
        return Number.isNaN(at) ? null : at;
    } catch {
        return null;
    }
}
