import type { LiveWxMap } from './map-types.ts';
import { SURFACE_BG, SURFACE_BORDER, SURFACE_FG } from './theme.ts';
import { radarUpdatedLabel } from '../radar/tiles.ts';
import { watch } from 'vue';
import { state } from './state.ts';

const STYLE_ID = 'livewx-age-control-style';
const TICK_MS = 15_000;

let mapRef: LiveWxMap | null = null;
let el: HTMLDivElement | null = null;
let control: { onAdd: () => HTMLElement; onRemove: () => void } | null = null;
let tick: ReturnType<typeof setInterval> | null = null;
let stamp: number | null = null;
let visible = false;
let usedAddControl = false;

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.livewx-age-control {
    margin: 0 10px 10px 0;
    padding: 4px 8px;
    pointer-events: none;
    user-select: none;
    font: 12px/1.3 var(--tblr-font-sans-serif, system-ui, Segoe UI, sans-serif);
    color: ${SURFACE_FG};
    background: ${SURFACE_BG};
    border: 1px solid ${SURFACE_BORDER};
    border-radius: 4px;
    box-shadow: var(--tblr-box-shadow, 0 1px 4px rgba(0, 0, 0, 0.2));
    white-space: nowrap;
}
.livewx-age-control[hidden] {
    display: none !important;
}
`;
    document.head.appendChild(style);
}

function paint(): void {
    if (!el) return;
    if (!visible || !state.radarAgeVisible) {
        el.hidden = true;
        return;
    }
    el.hidden = false;
    el.textContent = radarUpdatedLabel(stamp);
}

watch(() => state.radarAgeVisible, () => paint());

function startTick(): void {
    if (tick) return;
    tick = setInterval(paint, TICK_MS);
}

function stopTick(): void {
    if (!tick) return;
    clearInterval(tick);
    tick = null;
}

export function setRadarAge(at: number | null, show: boolean): void {
    stamp = at;
    visible = show;
    if (show) startTick();
    else stopTick();
    paint();
}

function placeUnderScale(): void {
    const node = el;
    if (!node) return;
    const group = node.parentElement;
    if (!group) return;
    if (group.lastElementChild !== node) group.appendChild(node);
}

export function attachRadarAgeControl(map: LiveWxMap): void {
    if (mapRef === map && el) {
        paint();
        placeUnderScale();
        return;
    }
    detachRadarAgeControl();
    ensureStyle();
    mapRef = map;
    el = document.createElement('div');
    el.className = 'maplibregl-ctrl livewx-age-control';
    paint();

    control = {
        onAdd: () => el as HTMLDivElement,
        onRemove: () => {
            el?.remove();
        },
    };

    usedAddControl = false;
    try {
        map.addControl?.(control, 'bottom-right');
        usedAddControl = Boolean(map.addControl);
    } catch {
        usedAddControl = false;
    }
    if (!usedAddControl) {
        const host = map.getContainer?.();
        if (host) {
            el.style.position = 'absolute';
            el.style.right = '10px';
            el.style.bottom = '8px';
            el.style.zIndex = '10';
            host.appendChild(el);
        }
    } else {
        // MapLibre prepends bottom-right controls, which would sit above the scale.
        placeUnderScale();
        requestAnimationFrame(placeUnderScale);
    }
    if (visible) startTick();
}

export function detachRadarAgeControl(): void {
    stopTick();
    if (mapRef && control && usedAddControl) {
        try { mapRef.removeControl?.(control); } catch { /* ignore */ }
    } else {
        el?.remove();
    }
    mapRef = null;
    el = null;
    control = null;
    usedAddControl = false;
}
