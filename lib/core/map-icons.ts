/**
 * Map icons drawn into MapLibre images from Tabler Icons outline paths
 * (https://tabler.io/icons — MIT License, © Paweł Kuna; paths from v3.49).
 *
 * Each icon is a stroked glyph with a contrasting outline so it reads on any
 * basemap and on the colored circle the layer draws underneath it:
 *   light — white glyph, dark outline (for dark/saturated circles)
 *   dark  — dark glyph, light outline (for light circles such as yellow)
 */
import type { LiveWxMap } from './map-types.ts';

export type IconStyle = 'light' | 'dark';

export type MapIcon = {
    id: string;
    paths: string[];
    style?: IconStyle;
};

/** Tabler "cloud-star" — Spot Forecasts. */
export const CLOUD_STAR_ICON: MapIcon = {
    id: 'livewx-cloud-star',
    style: 'light',
    paths: [
        'M9.5 18.004h-2.843c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.209 .967 1.88 2.347 1.88 3.776',
        'M17.8 20.817l-2.172 1.138a.392 .392 0 0 1 -.568 -.41l.415 -2.411l-1.757 -1.707a.389 .389 0 0 1 .217 -.665l2.428 -.352l1.086 -2.193a.392 .392 0 0 1 .702 0l1.086 2.193l2.428 .352a.39 .39 0 0 1 .217 .665l-1.757 1.707l.414 2.41a.39 .39 0 0 1 -.567 .411l-2.172 -1.138',
    ],
};

/** Tabler "ripple" — River Gauges. */
export const RIPPLE_ICON: MapIcon = {
    id: 'livewx-ripple',
    style: 'light',
    paths: [
        'M3 7c3 -2 6 -2 9 0s6 2 9 0',
        'M3 17c3 -2 6 -2 9 0s6 2 9 0',
        'M3 12c3 -2 6 -2 9 0s6 2 9 0',
    ],
};

/** Tabler "droplet-search" — Rain Gauges. */
export const DROPLET_SEARCH_ICON: MapIcon = {
    id: 'livewx-droplet-search',
    style: 'light',
    paths: [
        'M18.064 10.877l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546a7.13 7.13 0 0 0 4.168 1.572',
        'M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
        'M20.2 20.2l1.8 1.8',
    ],
};

/** Tabler "plane-tilt" — METAR stations. */
export const PLANE_TILT_ICON: MapIcon = {
    id: 'livewx-plane-tilt',
    style: 'light',
    paths: [
        'M14.5 6.5l3 -2.9a2.05 2.05 0 0 1 2.9 2.9l-2.9 3l2.5 7.5l-2.5 2.55l-3.5 -6.55l-3 3v3l-2 2l-1.5 -4.5l-4.5 -1.5l2 -2h3l3 -3l-6.5 -3.5l2.5 -2.5l7.5 2.5',
    ],
};

/** Rendered size in device pixels (registered at pixelRatio 2 → 20 px on screen). */
const SIZE = 40;
/** Margin so the outline is not clipped. */
const PAD = 2;

const COLORS: Record<IconStyle, { glyph: string; outline: string }> = {
    light: { glyph: '#ffffff', outline: 'rgba(15, 23, 42, 0.9)' },
    dark: { glyph: '#1f2937', outline: 'rgba(255, 255, 255, 0.85)' },
};

function draw(icon: MapIcon): ImageData | null {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof Path2D === 'undefined') return null;
    const { glyph, outline } = COLORS[icon.style ?? 'light'];
    ctx.clearRect(0, 0, SIZE, SIZE);
    const scale = (SIZE - PAD * 2) / 24;
    ctx.translate(PAD, PAD);
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const shapes = icon.paths.map((d) => new Path2D(d));
    ctx.strokeStyle = outline;
    ctx.lineWidth = 4.2;
    for (const p of shapes) ctx.stroke(p);
    ctx.strokeStyle = glyph;
    ctx.lineWidth = 2;
    for (const p of shapes) ctx.stroke(p);
    return ctx.getImageData(0, 0, SIZE, SIZE);
}

/**
 * Add icons to the map style if missing (style swaps drop images, so call this
 * whenever the layer repaints). False if the browser cannot draw them.
 */
export function ensureMapIcons(map: LiveWxMap, icons: MapIcon[]): boolean {
    if (!map.addImage) return false;
    for (const icon of icons) {
        if (map.hasImage?.(icon.id)) continue;
        const image = draw(icon);
        if (!image) return false;
        map.addImage(icon.id, image, { pixelRatio: 2 });
    }
    return true;
}

export function removeMapIcons(map: LiveWxMap, icons: MapIcon[]): void {
    for (const icon of icons) {
        try { if (map.hasImage?.(icon.id)) map.removeImage?.(icon.id); } catch { /* ignore */ }
    }
}
