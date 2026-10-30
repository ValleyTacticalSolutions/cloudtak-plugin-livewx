/**
 * Bottom-center stacked legend strips for enabled color-mapped layers.
 */
import { watch, type WatchStopHandle } from 'vue';
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf, registerModule } from '../core/map-host.ts';
import { state } from '../core/state.ts';
import { SURFACE_BG, SURFACE_BORDER, SURFACE_FG } from '../core/theme.ts';
import type { UnitSystem } from '../core/units.ts';
import { HIGH_FLOW_GRADES } from '../layers/high-flow.ts';
import { getProduct } from '../radar/products.ts';
import { activeSource } from '../radar/radar.ts';

type LabelFn = string | ((units: UnitSystem) => string);

export type LegendStrip = {
    id: string;
    label: LabelFn;
    unit?: LabelFn;
    /** CSS colors left → right for the gradient strip. */
    colors: string[];
    min: LabelFn;
    max: LabelFn;
    mid?: LabelFn;
    /** Discrete classes; when set, swatches replace the gradient and ticks. */
    items?: Array<{ color: string; label: string }>;
};

/** Menu order from MasterPane (only ids with a legend appear). */
const MENU_ORDER = [
    'radar_overlay',
    'satellite',
    'rain_totals',
    'wind_field',
    'surface_wind',
    'lightning_density',
    'fire_outlook',
    'fuel_moisture',
    'smoke',
    'air_quality',
    'flash_flood',
    'flood_now',
    'flood_5day',
    'high_flow_now',
    'high_flow_5day',
    'rain_gauges',
    'snow_depth',
] as const;

const RAIN_COLORS = [
    '#0018ff', '#00a0ff', '#00ffc8', '#00e000', '#ffff00', '#ff9000', '#ff0000', '#ff00ff', '#ffffff',
];

/** NWM flooded-ground fill, as drawn by the service. */
const FLOOD_EXTENT_COLORS = ['#006ec8', '#006ec8'];

/** Short swatch labels for the high-flow grades (same order as HIGH_FLOW_GRADES). */
const HIGH_FLOW_SHORT: Record<string, string> = {
    '2': '1-in-50 yr+',
    '4': '1-in-25 yr',
    '10': '1-in-10 yr',
    '20': '1-in-5 yr',
    '50': '1-in-2 yr',
    '>50': 'High-water mark',
    '': 'Size unknown',
};

/** One strip for both horizons, so turning on Now and 5 Days shows it once. */
const HIGH_FLOW_LEGEND: LegendStrip = {
    id: 'high_flow',
    label: 'Streams Running High',
    unit: 'flow rarity',
    colors: [],
    min: '',
    max: '',
    items: HIGH_FLOW_GRADES.map((g) => ({ color: g.color, label: HIGH_FLOW_SHORT[g.value] ?? g.label })),
};

const FLOOD_EXTENT_LEGEND: LegendStrip = {
    id: 'flood_extent',
    label: 'Flooded Ground',
    colors: FLOOD_EXTENT_COLORS,
    min: 'Modeled',
    max: 'water over banks',
};

const LEGENDS: Record<string, LegendStrip> = {
    radar_overlay: {
        id: 'radar_overlay',
        label: 'Radar',
        unit: 'dBZ',
        colors: [
            '#00ecec', '#01a0f6', '#0000f6', '#00ff00', '#00c800', '#009000',
            '#ffff00', '#e7c000', '#ff9000', '#ff0000', '#d60000', '#c00000',
            '#ff00ff', '#9955c9', '#ffffff',
        ],
        min: '5',
        mid: '40',
        max: '75',
    },
    radar_velocity: {
        id: 'radar_velocity',
        label: 'Radar',
        unit: 'kt',
        colors: [
            '#02c802', '#008c00', '#015a01', '#969696', '#fdb4b4', '#fd6464', '#fd0000', '#780000',
        ],
        min: '−50',
        mid: '0',
        max: '+50',
    },
    satellite: {
        id: 'satellite',
        label: 'Infrared Cloud Tops',
        unit: '°C',
        colors: [
            '#202020', '#505050', '#808080', '#b0b0b0', '#e0e0e0',
            '#ffff80', '#ff8000', '#ff0000', '#8000ff', '#ffffff',
        ],
        min: 'warm',
        max: 'cold',
    },
    rain_totals: {
        id: 'rain_totals',
        label: () => {
            const w = state.rainTotalsWindow;
            const labels: Record<string, string> = {
                '1h': 'Rain Totals (1 h)',
                '6h': 'Rain Totals (6 h)',
                '24h': 'Rain Totals (24 h)',
                '72h': 'Rain Totals (3 days)',
                '7d': 'Rain Totals (7 days)',
            };
            return labels[w] || 'Rain Totals';
        },
        unit: (u) => (u === 'us' ? 'in' : 'mm'),
        colors: RAIN_COLORS,
        min: (u) => (u === 'us' ? '0.01' : '0.2'),
        mid: (u) => (u === 'us' ? '1' : '25'),
        max: (u) => (u === 'us' ? '5+' : '125+'),
    },
    fuel_moisture: {
        id: 'fuel_moisture',
        label: 'Fuel Moisture',
        unit: '%',
        colors: ['#e53935', '#ff9800', '#ffeb3b', '#43a047'],
        min: 'Critical',
        mid: 'Moderate',
        max: 'Low',
    },
    rain_gauges: {
        id: 'rain_gauges',
        label: 'Rain Gauges',
        unit: 'in',
        colors: ['#adb5bd', '#74c0fc', '#1c7ed6', '#2b8a3e', '#f08c00', '#e03131'],
        min: '0',
        mid: '0.5',
        max: '2+',
    },
    wind_field: {
        id: 'wind_field',
        label: 'Water Vapor',
        colors: [
            '#1a0033', '#003366', '#0066aa', '#00aa88', '#88cc44', '#ffee66', '#ffffff',
        ],
        min: 'dry',
        max: 'moist',
    },
    surface_wind: {
        id: 'surface_wind',
        label: 'Surface Wind',
        unit: (u) => (u === 'metric' ? 'm/s' : u === 'aviation' ? 'kt' : 'mph'),
        colors: [
            '#b8dcff', '#58b4ff', '#58e890', '#ffe850', '#ff9a30', '#ff4040',
        ],
        min: '0',
        mid: (u) => (u === 'metric' ? '12' : u === 'aviation' ? '25' : '25'),
        max: (u) => (u === 'metric' ? '18+' : u === 'aviation' ? '40+' : '40+'),
    },
    /** nowCOAST LDN strike density (approx. yellow→red ramp used over sat imagery). */
    lightning_density: {
        id: 'lightning_density',
        label: 'Lightning Density',
        unit: 'strikes',
        colors: [
            '#2b1055', '#4b2bb5', '#1e90ff', '#00e5c8', '#ffff33', '#ff9900', '#ff2200', '#ffffff',
        ],
        min: 'low',
        mid: 'mod',
        max: 'high',
    },
    fire_outlook: {
        id: 'fire_outlook',
        label: 'Fire Outlook',
        colors: ['#ffff00', '#ff9900', '#ff0000', '#ff00ff'],
        min: 'Elevated',
        mid: 'Critical',
        max: 'Extreme',
    },
    smoke: {
        id: 'smoke',
        label: 'Smoke',
        unit: 'µg/m³',
        colors: [
            '#f5f5dc', '#d2b48c', '#a0522d', '#69401a', '#3d2410', '#1a0f08',
        ],
        min: 'light',
        max: 'dense',
    },
    air_quality: {
        id: 'air_quality',
        label: 'Air Quality',
        unit: 'AQI',
        colors: [
            '#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023',
        ],
        min: 'Good',
        mid: 'Unhealthy',
        max: 'Hazardous',
    },
    flash_flood: {
        id: 'flash_flood',
        label: 'Flash Flood',
        colors: ['#2f9e44', '#ffff00', '#ff9900', '#ff0000'],
        min: 'Slight',
        mid: 'Moderate',
        max: 'High',
    },
    flood_now: FLOOD_EXTENT_LEGEND,
    flood_5day: FLOOD_EXTENT_LEGEND,
    high_flow_now: HIGH_FLOW_LEGEND,
    high_flow_5day: HIGH_FLOW_LEGEND,
    snow_depth: {
        id: 'snow_depth',
        label: 'Snow Depth',
        unit: (u) => (u === 'us' ? 'in' : 'cm'),
        colors: [
            '#e8f4ff', '#a8d4ff', '#5aa8ff', '#2060c8', '#102060', '#ffffff',
        ],
        min: (u) => (u === 'us' ? '0.1' : '0.5'),
        mid: (u) => (u === 'us' ? '12' : '30'),
        max: (u) => (u === 'us' ? '36+' : '90+'),
    },
};

const STYLE_ID = 'livewx-legend-bar-style-v3';

let mapRef: LiveWxMap | null = null;
let root: HTMLDivElement | null = null;
let stopWatch: WatchStopHandle | null = null;

function resolve(v: LabelFn | undefined, units: UnitSystem): string {
    if (v == null) return '';
    return typeof v === 'function' ? v(units) : v;
}

function layerOn(id: string): boolean {
    if (id === 'radar_overlay') {
        return state.overlayEnabled || Boolean(state.layers.radar_overlay?.enabled);
    }
    if (id === 'lightning_density') {
        return state.densityLightningEnabled || Boolean(state.layers.lightning_density?.enabled);
    }
    return Boolean(state.layers[id]?.enabled);
}

function activeStrips(): LegendStrip[] {
    const out: LegendStrip[] = [];
    for (const id of MENU_ORDER) {
        if (!layerOn(id)) continue;
        if (id === 'radar_overlay') {
            // Velocity legend only for US single-site products; Canada/Global are rain composites.
            const prod = activeSource.value === 'iem' ? getProduct(state.productId) : undefined;
            out.push(prod?.filterKind === 'velocity' ? LEGENDS.radar_velocity : LEGENDS.radar_overlay);
            continue;
        }
        const strip = LEGENDS[id];
        if (strip && !out.includes(strip)) out.push(strip);
    }
    return out;
}

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.livewx-legend-bar {
    position: absolute;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    z-index: 12;
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: stretch;
    width: min(210px, calc(100% - 100px));
    pointer-events: none;
    user-select: none;
}
.livewx-legend-bar[hidden] {
    display: none !important;
}
.livewx-legend-strip {
    padding: 3px 6px 4px;
    border-radius: 4px;
    color: ${SURFACE_FG};
    background: ${SURFACE_BG};
    border: 1px solid ${SURFACE_BORDER};
    box-shadow: var(--tblr-box-shadow, 0 1px 3px rgba(0, 0, 0, 0.25));
    font: 9px/1.2 var(--tblr-font-sans-serif, system-ui, Segoe UI, sans-serif);
}
.livewx-legend-head {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 2px;
    font-weight: 600;
    letter-spacing: 0.01em;
}
.livewx-legend-unit {
    font-weight: 500;
    opacity: 0.75;
}
.livewx-legend-ramp {
    height: 5px;
    border-radius: 1px;
    border: 1px solid rgba(0, 0, 0, 0.2);
}
.livewx-legend-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 1px;
    opacity: 0.8;
    font-size: 8px;
}
.livewx-legend-items {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px 6px;
    font-size: 8px;
}
.livewx-legend-item {
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
}
.livewx-legend-swatch {
    flex: none;
    width: 9px;
    height: 6px;
    border-radius: 1px;
    border: 1px solid rgba(0, 0, 0, 0.2);
}
`;
    document.head.appendChild(style);
}

function paint(): void {
    if (!root) return;
    const strips = state.legendsVisible ? activeStrips() : [];
    if (!strips.length) {
        root.hidden = true;
        root.replaceChildren();
        return;
    }
    root.hidden = false;
    const units = state.units;
    const frag = document.createDocumentFragment();
    for (const strip of strips) {
        const card = document.createElement('div');
        card.className = 'livewx-legend-strip';
        card.dataset.layer = strip.id;

        const head = document.createElement('div');
        head.className = 'livewx-legend-head';
        const title = document.createElement('span');
        title.textContent = resolve(strip.label, units);
        head.appendChild(title);
        const unit = resolve(strip.unit, units);
        if (unit) {
            const u = document.createElement('span');
            u.className = 'livewx-legend-unit';
            u.textContent = unit;
            head.appendChild(u);
        }
        card.appendChild(head);

        if (strip.items) {
            const grid = document.createElement('div');
            grid.className = 'livewx-legend-items';
            for (const item of strip.items) {
                const row = document.createElement('span');
                row.className = 'livewx-legend-item';
                const sw = document.createElement('span');
                sw.className = 'livewx-legend-swatch';
                sw.style.background = item.color;
                row.append(sw, item.label);
                grid.appendChild(row);
            }
            card.appendChild(grid);
            frag.appendChild(card);
            continue;
        }

        const ramp = document.createElement('div');
        ramp.className = 'livewx-legend-ramp';
        ramp.style.background = `linear-gradient(90deg, ${strip.colors.join(', ')})`;
        card.appendChild(ramp);

        const ticks = document.createElement('div');
        ticks.className = 'livewx-legend-ticks';
        const min = document.createElement('span');
        min.textContent = resolve(strip.min, units);
        ticks.appendChild(min);
        const mid = resolve(strip.mid, units);
        if (mid) {
            const m = document.createElement('span');
            m.textContent = mid;
            ticks.appendChild(m);
        }
        const max = document.createElement('span');
        max.textContent = resolve(strip.max, units);
        ticks.appendChild(max);
        card.appendChild(ticks);

        frag.appendChild(card);
    }
    root.replaceChildren(frag);
}

function ensureRoot(map: LiveWxMap): void {
    if (root?.parentElement) return;
    const host = map.getContainer?.();
    if (!host) return;
    ensureStyle();
    root = document.createElement('div');
    root.className = 'livewx-legend-bar';
    root.setAttribute('aria-label', 'Layer legends');
    host.appendChild(root);
}

let moduleRegistered = false;

export function attachLegendBar(map?: LiveWxMap | null): void {
    const m = map ?? mapOf();
    if (!m) return;
    if (mapRef === m && root?.parentElement) {
        paint();
        return;
    }
    detachLegendBar();
    mapRef = m;
    ensureRoot(m);
    paint();
    if (!stopWatch) {
        stopWatch = watch(
            () => [
                state.legendsVisible,
                state.overlayEnabled,
                state.densityLightningEnabled,
                state.productId,
                state.units,
                state.rainTotalsWindow,
                state.layers,
            ],
            () => paint(),
            { deep: true },
        );
    }
    if (!moduleRegistered) {
        registerModule({
            id: 'legend-bar',
            restore: (map) => {
                mapRef = map;
                ensureRoot(map);
                paint();
            },
            destroy: () => detachLegendBar(),
        });
        moduleRegistered = true;
    }
}

export function detachLegendBar(): void {
    stopWatch?.();
    stopWatch = null;
    root?.remove();
    root = null;
    mapRef = null;
    moduleRegistered = false;
}

export function refreshLegendBar(): void {
    if (!mapRef) {
        attachLegendBar();
        return;
    }
    ensureRoot(mapRef);
    paint();
}
