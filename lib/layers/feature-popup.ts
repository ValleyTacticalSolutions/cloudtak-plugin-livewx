/**
 * Shared MapLibre popup for LiveWX feature clicks (alerts + geo layers).
 */
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { pointUi } from '../core/point.ts';
import { SURFACE_BG, SURFACE_BORDER, SURFACE_FG, SURFACE_MUTED } from '../core/theme.ts';

const POPUP_STYLE_ID = 'livewx-alert-popup-style';
const LINK_CLASS = 'livewx-popup-link';
const LINK_WINDOW_NAME = 'livewx-link';
const SKIP_KEYS = new Set([
    'objectid', 'fid', 'globalid', 'shape', 'shape_length', 'shape_area',
    'st_area(shape)', 'st_length(shape)', 'geometry', 'geom',
]);

type LayerMeta = {
    /** Section label shown above the title (e.g. "Buoys"). */
    label: string;
    /** Preferred property keys for the title, in order. */
    titleKeys?: string[];
    /** Custom detail card; when set, replaces the default property table. */
    detailHtml?: (props: Record<string, unknown>) => string | Promise<string>;
};

const registry = new Map<string, LayerMeta>();
let popup: { remove: () => void } | null = null;
let clickBound = false;
let hoverBound = false;
let linkBound = false;

function ensurePopupStyle(): void {
    let el = document.getElementById(POPUP_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement('style');
        el.id = POPUP_STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = `
/* Above livewx wind canvas (z-index: 1); MapLibre controls sit at 2. */
.livewx-alert-popup {
    z-index: 3;
}
.livewx-alert-popup .maplibregl-popup-content {
    color: ${SURFACE_FG};
    background: ${SURFACE_BG};
    border: 1px solid ${SURFACE_BORDER};
    padding: 12px 32px 12px 12px;
    border-radius: 8px;
    box-shadow: var(--tblr-box-shadow-lg, 0 4px 18px rgba(0, 0, 0, 0.35));
    font: 13px/1.45 var(--tblr-font-sans-serif, system-ui, Segoe UI, sans-serif);
}
.livewx-alert-popup .maplibregl-popup-close-button {
    color: ${SURFACE_MUTED};
    font-size: 18px;
    padding: 4px 8px;
}
.livewx-alert-popup .maplibregl-popup-close-button:hover {
    color: ${SURFACE_FG};
    background: transparent;
}
.livewx-alert-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip {
    border-top-color: ${SURFACE_BG};
}
.livewx-alert-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip {
    border-bottom-color: ${SURFACE_BG};
}
.livewx-alert-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip {
    border-right-color: ${SURFACE_BG};
}
.livewx-alert-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip {
    border-left-color: ${SURFACE_BG};
}
.livewx-alert-card {
    max-width: 400px;
    /* Cap height so tall cards (e.g. METAR + raw) stay on the map pane. */
    max-height: min(420px, 50vh);
    overflow: auto;
}
.livewx-alert-eyebrow {
    color: ${SURFACE_MUTED};
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 4px;
}
.livewx-alert-title {
    color: ${SURFACE_FG};
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 8px;
}
.livewx-alert-body {
    color: ${SURFACE_FG};
}
.livewx-alert-body p {
    margin: 0 0 0.7em;
}
.livewx-alert-body p:last-child,
.livewx-alert-list:last-child {
    margin-bottom: 0;
}
.livewx-alert-list {
    margin: 0 0 0.7em;
    padding-left: 1.15em;
}
.livewx-alert-list li {
    margin: 0 0 0.35em;
}
.livewx-alert-dl {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(5rem, 38%) 1fr;
    gap: 0.35rem 0.65rem;
}
.livewx-alert-dl dt {
    color: ${SURFACE_MUTED};
    font-weight: 600;
    margin: 0;
}
.livewx-alert-dl dd {
    margin: 0;
    overflow-wrap: anywhere;
}
.livewx-popup-link {
    color: var(--tblr-link-color, var(--tblr-primary, #4dabf7));
    text-decoration: underline;
    cursor: pointer;
}
.livewx-popup-link:hover {
    text-decoration: none;
}
.livewx-metar-raw {
    margin: 0.85em 0 0;
    padding-top: 0.7em;
    border-top: 1px solid ${SURFACE_BORDER};
}
.livewx-metar-raw-label {
    color: ${SURFACE_MUTED};
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 0.35em;
}
.livewx-metar-raw-text {
    margin: 0;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
`;
}

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function closeFeaturePopup(): void {
    popup?.remove();
    popup = null;
}

/** Prefer an anchor that keeps the popup inside the map container. */
function popupAnchor(
    map: LiveWxMap,
    lngLat: { lng: number; lat: number },
): string {
    try {
        const project = map.project?.bind(map);
        const host = map.getContainer?.();
        if (!project || !host) return 'bottom';
        const pt = project(lngLat) as { x: number; y: number };
        const w = host.clientWidth || 0;
        const h = host.clientHeight || 0;
        if (w < 1 || h < 1) return 'bottom';
        const top = pt.y < h * 0.38;
        const bottom = pt.y > h * 0.62;
        const left = pt.x < w * 0.28;
        const right = pt.x > w * 0.72;
        if (top && left) return 'top-left';
        if (top && right) return 'top-right';
        if (top) return 'top';
        if (bottom && left) return 'bottom-left';
        if (bottom && right) return 'bottom-right';
        if (bottom) return 'bottom';
        if (left) return 'left';
        if (right) return 'right';
        return 'bottom';
    } catch {
        return 'bottom';
    }
}

/** Show arbitrary HTML in the shared LiveWX detail popup. */
export async function showFeatureHtml(
    map: LiveWxMap,
    lngLat: { lng: number; lat: number },
    html: string,
): Promise<void> {
    ensurePopupStyle();
    ensureLinkHandler();
    closeFeaturePopup();
    try {
        const ml = await import('maplibre-gl') as {
            Popup?: new (opts: object) => {
                setLngLat: (ll: object) => { setHTML: (h: string) => { addTo: (m: unknown) => { remove: () => void } } };
                remove: () => void;
            };
            default?: { Popup?: new (opts: object) => {
                setLngLat: (ll: object) => { setHTML: (h: string) => { addTo: (m: unknown) => { remove: () => void } } };
                remove: () => void;
            } };
        };
        const Popup = ml.Popup ?? ml.default?.Popup;
        if (!Popup) return;
        popup = new Popup({
            closeButton: true,
            maxWidth: '420px',
            className: 'livewx-alert-popup',
            anchor: popupAnchor(map, lngLat),
            offset: 12,
        })
            .setLngLat(lngLat)
            .setHTML(html)
            .addTo(map);
    } catch {
        /* popup optional */
    }
}

function humanizeKey(key: string): string {
    return key
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(raw: unknown): string | null {
    if (raw == null) return null;
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t || t === 'null' || t === 'undefined') return null;
        // Epoch ms
        if (/^\d{13}$/.test(t)) {
            const d = new Date(Number(t));
            if (!Number.isNaN(d.getTime())) return d.toLocaleString();
        }
        if (/^\d{10}$/.test(t)) {
            const d = new Date(Number(t) * 1000);
            if (!Number.isNaN(d.getTime())) return d.toLocaleString();
        }
        return t.length > 800 ? `${t.slice(0, 800)}…` : t;
    }
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return null;
        if (raw > 1e12 && raw < 2e13) return new Date(raw).toLocaleString();
        if (raw > 1e9 && raw < 2e10) return new Date(raw * 1000).toLocaleString();
        return String(raw);
    }
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    if (typeof raw === 'object') {
        try {
            const s = JSON.stringify(raw);
            return s.length > 200 ? `${s.slice(0, 200)}…` : s;
        } catch {
            return null;
        }
    }
    return String(raw);
}

/** The value as an http(s) URL when the whole property is one, else undefined. */
function linkUrl(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const t = raw.trim();
    if (!/^https?:\/\/\S+$/i.test(t)) return undefined;
    try {
        const u = new URL(t);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
    } catch {
        return undefined;
    }
}

/** Anchor for a popup value; clicks are routed to openLinkWindow. */
export function linkHtml(url: string, text = url): string {
    return `<a class="${LINK_CLASS}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

export type LinkWindowOpts = {
    /** Window name; links sharing a name reuse one window. */
    name?: string;
    maxWidth?: number;
    maxHeight?: number;
};

/** Open a URL in a small, centered, reused browser window (new tab where popups are unsupported). */
export function openLinkWindow(url: string, opts: LinkWindowOpts = {}): void {
    const sw = window.screen?.availWidth || window.innerWidth;
    const sh = window.screen?.availHeight || window.innerHeight;
    const width = Math.min(opts.maxWidth ?? 900, Math.round(sw * 0.8));
    const height = Math.min(opts.maxHeight ?? 700, Math.round(sh * 0.8));
    const left = Math.max(0, Math.round((sw - width) / 2));
    const top = Math.max(0, Math.round((sh - height) / 2));
    const win = window.open(
        url,
        opts.name ?? LINK_WINDOW_NAME,
        `popup,width=${width},height=${height},left=${left},top=${top}`,
    );
    if (!win) {
        // Popup blocked — fall back to a normal new tab.
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }
    try { win.opener = null; } catch { /* ignore */ }
    win.focus();
}

/**
 * Popup HTML goes through setHTML, and CloudTAK's CSP blocks inline onclick,
 * so link clicks are caught with one delegated document listener.
 */
function onLinkClick(e: MouseEvent): void {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as Element | null;
    const a = target?.closest?.(`a.${LINK_CLASS}`) as HTMLAnchorElement | null;
    if (!a?.href) return;
    e.preventDefault();
    openLinkWindow(a.href);
}

function ensureLinkHandler(): void {
    if (linkBound) return;
    document.addEventListener('click', onLinkClick);
    linkBound = true;
}

function propGet(props: Record<string, unknown>, key: string): unknown {
    if (key in props) return props[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(props)) {
        if (k.toLowerCase() === lower) return v;
    }
    return undefined;
}

/** Build detail-card HTML from a feature's properties. */
export function propertiesHtml(
    label: string,
    props: Record<string, unknown>,
    titleKeys: string[] = [],
): string {
    const defaults = [
        'name', 'NAME', 'title', 'TITLE', 'place', 'location', 'LOCATION',
        'station', 'id', 'ID', 'gaugelid', 'nws_lid', 'nws_name', 'ZONE',
        'zone', 'event', 'EVENT', 'product', 'mag',
    ];
    let title = '';
    for (const key of [...titleKeys, ...defaults]) {
        const v = formatValue(propGet(props, key));
        if (v) {
            title = key.toLowerCase() === 'mag' ? `M${v}` : v;
            // Prefer mag + place for quakes
            if (key.toLowerCase() === 'mag') {
                const place = formatValue(propGet(props, 'place'));
                if (place) title = `${title} — ${place}`;
            }
            break;
        }
    }
    if (!title) title = label;

    const rows: Array<{ k: string; v: string; url?: string }> = [];
    const used = new Set<string>();
    for (const [key, raw] of Object.entries(props)) {
        const lk = key.toLowerCase();
        if (SKIP_KEYS.has(lk)) continue;
        if (lk.startsWith('shape_') || lk.startsWith('st_')) continue;
        const v = formatValue(raw);
        if (!v) continue;
        // Skip title duplicate
        if (v === title || (title.startsWith('M') && lk === 'mag')) {
            used.add(lk);
            continue;
        }
        if (lk === 'place' && title.includes(v)) continue;
        rows.push({ k: humanizeKey(key), v, url: linkUrl(raw) });
        if (rows.length >= 24) break;
    }

    const parts = [
        `<div class="livewx-alert-eyebrow">${escapeHtml(label)}</div>`,
        `<div class="livewx-alert-title">${escapeHtml(title)}</div>`,
    ];
    if (rows.length) {
        parts.push(
            `<dl class="livewx-alert-dl">${rows.map((r) =>
                `<dt>${escapeHtml(r.k)}</dt><dd>${r.url ? linkHtml(r.url, r.v) : escapeHtml(r.v)}</dd>`,
            ).join('')}</dl>`,
        );
    }
    return `<div class="livewx-alert-card">${parts.join('')}</div>`;
}

export function registerFeatureLayers(layerIds: string[], meta: LayerMeta): void {
    for (const id of layerIds) {
        if (!id) continue;
        registry.set(id, meta);
    }
    ensureHandlers();
}

/** True when a registered LiveWX feature layer is under the pointer. */
export function hitsFeaturePopupLayers(map: LiveWxMap, point: unknown): boolean {
    const layers = presentIds(map);
    if (!layers.length || !map.queryRenderedFeatures) return false;
    try {
        return map.queryRenderedFeatures(point, { layers }).length > 0;
    } catch {
        return false;
    }
}

export function unregisterFeatureLayers(layerIds: string[]): void {
    for (const id of layerIds) registry.delete(id);
    if (!registry.size) {
        teardownHandlers();
        closeFeaturePopup();
    }
}

function presentIds(map: LiveWxMap): string[] {
    return [...registry.keys()].filter((id) => Boolean(map.getLayer(id)));
}

function onMapClick(e: {
    lngLat?: { lng: number; lat: number };
    point?: unknown;
}): void {
    if (pointUi.picking) return;
    const map = mapOf();
    if (!map || !e.lngLat || e.point == null || !map.queryRenderedFeatures) return;
    const layers = presentIds(map);
    if (!layers.length) return;
    let feats: Array<{ layer?: { id?: string }; properties?: Record<string, unknown> }>;
    try {
        feats = map.queryRenderedFeatures(e.point, { layers }) as typeof feats;
    } catch {
        return;
    }
    const hit = feats[0];
    if (!hit?.layer?.id) return;
    const meta = registry.get(hit.layer.id);
    if (!meta) return;
    const props = (hit.properties || {}) as Record<string, unknown>;
    // Narrowing of e.lngLat does not carry into the async closure.
    const lngLat = e.lngLat;
    // MapLibre may stringify nested props; keep primitives.
    void (async () => {
        const html = meta.detailHtml
            ? await meta.detailHtml(props)
            : propertiesHtml(meta.label, props, meta.titleKeys);
        await showFeatureHtml(map, lngLat, html);
    })();
}

function onMouseMove(e: { point?: unknown }): void {
    const map = mapOf();
    if (!map?.getCanvas || e.point == null || !map.queryRenderedFeatures) return;
    const layers = presentIds(map);
    if (!layers.length) {
        map.getCanvas().style.cursor = '';
        return;
    }
    try {
        const hits = map.queryRenderedFeatures(e.point, { layers });
        map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
    } catch {
        map.getCanvas().style.cursor = '';
    }
}

function ensureHandlers(): void {
    const map = mapOf();
    if (!map) return;
    if (!clickBound) {
        map.on('click', onMapClick);
        clickBound = true;
    }
    if (!hoverBound) {
        map.on('mousemove', onMouseMove);
        hoverBound = true;
    }
}

function teardownHandlers(): void {
    const map = mapOf();
    if (map) {
        if (clickBound) {
            try { map.off('click', onMapClick); } catch { /* ignore */ }
        }
        if (hoverBound) {
            try { map.off('mousemove', onMouseMove); } catch { /* ignore */ }
            try {
                const c = map.getCanvas?.();
                if (c) c.style.cursor = '';
            } catch { /* ignore */ }
        }
    }
    if (linkBound) {
        // Re-added by the next showFeatureHtml (alerts still use the popup).
        document.removeEventListener('click', onLinkClick);
    }
    clickBound = false;
    hoverBound = false;
    linkBound = false;
}
