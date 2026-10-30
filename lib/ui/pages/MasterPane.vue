<template>
    <div class='master'>
        <section class='sec'>
            <div class='sec-head'>
                <h3 class='sec-title'>
                    Forecast
                </h3>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    @click='go("forecast")'
                >
                    Open
                </button>
            </div>
            <p class='sec-meta mb-0'>
                {{ forecastLine }}
            </p>
        </section>

        <section class='sec'>
            <h3 class='sec-title mb-2'>
                Radar
            </h3>
            <div class='layer-row mb-2'>
                <div class='sec-head mb-0'>
                    <div class='form-check form-switch mb-0'>
                        <input
                            id='m-radar'
                            class='form-check-input'
                            type='checkbox'
                            :checked='enabled.radar_overlay'
                            @change='toggle("radar_overlay", $event)'
                        >
                        <label
                            class='form-check-label'
                            for='m-radar'
                        >Radar</label>
                    </div>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        type='button'
                        @click='go("radar")'
                    >
                        Details
                    </button>
                </div>
                <div
                    v-if='enabled.radar_overlay'
                    class='opacity-row'
                >
                    <label
                        class='form-label small mb-1'
                        for='m-op-radar_overlay'
                    >Opacity {{ pct('radar_overlay') }}%</label>
                    <input
                        id='m-op-radar_overlay'
                        class='form-range mb-0'
                        type='range'
                        min='0'
                        max='100'
                        step='1'
                        :value='pct("radar_overlay")'
                        @input='onOpacity("radar_overlay", $event)'
                        @wheel.prevent='onOpacityWheel("radar_overlay", $event)'
                    >
                </div>
            </div>
            <div
                v-for='row in radarRows'
                :key='row.id'
                class='layer-row mb-2'
            >
                <div class='form-check form-switch mb-0'>
                    <input
                        :id='`m-${row.id}`'
                        class='form-check-input'
                        type='checkbox'
                        :checked='enabled[row.id]'
                        @change='toggle(row.id, $event)'
                    >
                    <label
                        class='form-check-label'
                        :for='`m-${row.id}`'
                    >{{ row.label }}</label>
                </div>
                <div
                    v-if='enabled[row.id] && row.id === "rain_totals"'
                    class='opacity-row'
                >
                    <label
                        class='form-label small mb-1'
                        for='m-rain-window'
                    >Period</label>
                    <select
                        id='m-rain-window'
                        class='form-select form-select-sm mb-2'
                        :value='state.rainTotalsWindow'
                        @change='onRainWindow'
                    >
                        <option
                            v-for='w in rainWindows'
                            :key='w.id'
                            :value='w.id'
                        >
                            {{ w.label }}
                        </option>
                    </select>
                    <label
                        class='form-label small mb-1'
                        for='m-op-rain_totals'
                    >Opacity {{ pct('rain_totals') }}%</label>
                    <input
                        id='m-op-rain_totals'
                        class='form-range mb-0'
                        type='range'
                        min='0'
                        max='100'
                        step='1'
                        :value='pct("rain_totals")'
                        @input='onOpacity("rain_totals", $event)'
                        @wheel.prevent='onOpacityWheel("rain_totals", $event)'
                    >
                </div>
                <div
                    v-else-if='enabled[row.id]'
                    class='opacity-row'
                >
                    <label
                        class='form-label small mb-1'
                        :for='`m-op-${row.id}`'
                    >Opacity {{ pct(row.id) }}%</label>
                    <input
                        :id='`m-op-${row.id}`'
                        class='form-range mb-0'
                        type='range'
                        min='0'
                        max='100'
                        step='1'
                        :value='pct(row.id)'
                        @input='onOpacity(row.id, $event)'
                        @wheel.prevent='onOpacityWheel(row.id, $event)'
                    >
                </div>
            </div>
        </section>

        <section class='sec'>
            <h3 class='sec-title mb-2'>
                Wind
            </h3>
            <div
                v-for='row in windRows'
                :key='row.id'
                class='layer-row mb-2'
            >
                <div class='form-check form-switch mb-0'>
                    <input
                        :id='`m-${row.id}`'
                        class='form-check-input'
                        type='checkbox'
                        :checked='enabled[row.id]'
                        @change='toggle(row.id, $event)'
                    >
                    <label
                        class='form-check-label'
                        :for='`m-${row.id}`'
                    >{{ row.label }}</label>
                </div>
                <p
                    v-if='enabled[row.id] && layerUi.status[row.id]'
                    class='sec-meta mb-1'
                >
                    {{ layerUi.status[row.id] }}
                </p>
                <div
                    v-if='enabled[row.id]'
                    class='opacity-row'
                >
                    <label
                        class='form-label small mb-1'
                        :for='`m-op-${row.id}`'
                    >Opacity {{ pct(row.id) }}%</label>
                    <input
                        :id='`m-op-${row.id}`'
                        class='form-range mb-0'
                        type='range'
                        min='0'
                        max='100'
                        step='1'
                        :value='pct(row.id)'
                        @input='onOpacity(row.id, $event)'
                        @wheel.prevent='onOpacityWheel(row.id, $event)'
                    >
                </div>
            </div>
        </section>

        <section class='sec'>
            <h3 class='sec-title mb-2'>
                Watches &amp; Warnings
            </h3>
            <div class='form-check form-switch mb-1'>
                <input
                    id='m-wwa'
                    class='form-check-input'
                    type='checkbox'
                    :checked='enabled.nws_wwa'
                    @change='toggle("nws_wwa", $event)'
                >
                <label
                    class='form-check-label'
                    for='m-wwa'
                >WWA</label>
            </div>
            <p
                v-if='enabled.nws_wwa'
                class='sec-meta mb-0'
            >
                {{ state.alertCount }} active
            </p>
        </section>

        <section class='sec'>
            <h3 class='sec-title mb-2'>
                Lightning
            </h3>
            <div class='form-check form-switch mb-2'>
                <input
                    id='m-ltng'
                    class='form-check-input'
                    type='checkbox'
                    :checked='enabled.blitzortung'
                    @change='toggle("blitzortung", $event)'
                >
                <label
                    class='form-check-label'
                    for='m-ltng'
                >Lightning</label>
            </div>
            <template v-if='enabled.blitzortung'>
                <label
                    class='form-label small mb-1'
                    for='m-ltng-life'
                >Lifetime {{ state.lightningStaleSec }}s</label>
                <input
                    id='m-ltng-life'
                    class='form-range mb-2'
                    type='range'
                    min='15'
                    max='600'
                    step='15'
                    :value='state.lightningStaleSec'
                    @input='onLifetime'
                >
            </template>
            <div class='layer-row'>
                <div class='form-check form-switch mb-0'>
                    <input
                        id='m-density'
                        class='form-check-input'
                        type='checkbox'
                        :checked='enabled.lightning_density'
                        @change='toggle("lightning_density", $event)'
                    >
                    <label
                        class='form-check-label'
                        for='m-density'
                    >Density</label>
                </div>
                <div
                    v-if='enabled.lightning_density'
                    class='opacity-row'
                >
                    <label
                        class='form-label small mb-1'
                        for='m-op-lightning_density'
                    >Opacity {{ pct('lightning_density') }}%</label>
                    <input
                        id='m-op-lightning_density'
                        class='form-range mb-0'
                        type='range'
                        min='0'
                        max='100'
                        step='1'
                        :value='pct("lightning_density")'
                        @input='onOpacity("lightning_density", $event)'
                        @wheel.prevent='onOpacityWheel("lightning_density", $event)'
                    >
                </div>
            </div>
        </section>

        <section class='sec'>
            <h3 class='sec-title mb-2'>
                More
            </h3>
            <div
                v-for='row in moreRows'
                :key='row.id'
                class='layer-row mb-2'
            >
                <div class='form-check form-switch mb-0'>
                    <input
                        :id='`m-${row.id}`'
                        class='form-check-input'
                        type='checkbox'
                        :checked='enabled[row.id]'
                        @change='toggle(row.id, $event)'
                    >
                    <label
                        class='form-check-label'
                        :for='`m-${row.id}`'
                    >{{ row.label }}</label>
                </div>
                <p
                    v-if='enabled[row.id] && row.hint'
                    class='sec-meta mb-1'
                >
                    {{ row.hint }}
                </p>
                <p
                    v-if='enabled[row.id] && row.summary && layerUi.status[row.id]'
                    class='sec-meta mb-1'
                >
                    {{ layerUi.status[row.id] }}
                </p>
                <div
                    v-if='enabled[row.id] && row.opacity'
                    class='opacity-row'
                >
                    <label
                        class='form-label small mb-1'
                        :for='`m-op-${row.id}`'
                    >Opacity {{ pct(row.id) }}%</label>
                    <input
                        :id='`m-op-${row.id}`'
                        class='form-range mb-0'
                        type='range'
                        min='0'
                        max='100'
                        step='1'
                        :value='pct(row.id)'
                        @input='onOpacity(row.id, $event)'
                        @wheel.prevent='onOpacityWheel(row.id, $event)'
                    >
                </div>
            </div>
        </section>

        <section class='sec'>
            <div class='sec-head'>
                <h3 class='sec-title'>
                    Spot Forecasts
                </h3>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    @click='go("spot")'
                >
                    Open
                </button>
            </div>
            <p class='sec-meta mb-0'>
                {{ spotLine }}
            </p>
        </section>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted } from 'vue';
import { ageLabelMs } from '../../core/egress.ts';
import { setLightningStaleSec, setPage, state } from '../../core/state.ts';
import { forecast } from '../../forecast/engine.ts';
import { listSources } from '../../forecast/sources.ts';
import {
    RAIN_TOTAL_WINDOWS,
    setRainTotalsWindow,
    type RainTotalWindowId,
} from '../../layers/rain-totals.ts';
import {
    getLayerOpacity,
    layerUi,
    refreshAllStatuses,
    setLayerEnabled,
    setLayerOpacity,
} from '../../layers/registry.ts';
import { filterSpotRequests, spot } from '../../spot/spot.ts';

const rainWindows = RAIN_TOTAL_WINDOWS;

const radarRows = [
    { id: 'satellite', label: 'Infrared Cloud Tops' },
    { id: 'rain_totals', label: 'Rain Totals' },
    { id: 'wind_field', label: 'Water Vapor' },
];

const windRows = [
    { id: 'surface_wind', label: 'Surface Wind' },
];

const FLOOD_HINT = 'Experimental NWS model estimate, lower 48. Zoom in to county level to see it.';
const HIGH_FLOW_HINT = 'Experimental NWS model estimate, lower 48. Tap a line for its numbers.';

const moreRows: Array<{ id: string; label: string; opacity: boolean; hint?: string; summary?: boolean }> = [
    { id: 'fire_outlook', label: 'Fire Outlook', opacity: false },
    { id: 'fw_zones', label: 'Fire Zones', opacity: false },
    { id: 'fuel_moisture', label: 'Fuel Moisture', opacity: false },
    { id: 'smoke', label: 'Smoke', opacity: true },
    { id: 'air_quality', label: 'Air Quality', opacity: false },
    { id: 'metars', label: 'METAR', opacity: false },
    { id: 'flash_flood', label: 'Flash Flood', opacity: false },
    { id: 'river_gauges', label: 'River Gauges', opacity: false },
    { id: 'flood_now', label: 'Flooded Ground (Now)', opacity: true, hint: FLOOD_HINT },
    { id: 'flood_5day', label: 'Flooded Ground (5 Days)', opacity: true, hint: FLOOD_HINT },
    { id: 'high_flow_now', label: 'Streams Running High (Now)', opacity: true, hint: HIGH_FLOW_HINT, summary: true },
    { id: 'high_flow_5day', label: 'Streams Running High (5 Days)', opacity: true, hint: HIGH_FLOW_HINT, summary: true },
    { id: 'rain_gauges', label: 'Rain Gauges', opacity: false },
    { id: 'buoys', label: 'Buoys', opacity: false },
    { id: 'hurricanes', label: 'Hurricanes', opacity: false },
    { id: 'avalanche', label: 'Avalanche', opacity: false },
    { id: 'snow_depth', label: 'Snow Depth', opacity: true },
    { id: 'earthquakes', label: 'Earthquakes', opacity: false },
    { id: 'spot_requests', label: 'Spot Forecasts', opacity: false },
];

const allIds = [
    'radar_overlay',
    ...radarRows.map((r) => r.id),
    ...windRows.map((r) => r.id),
    'nws_wwa',
    'blitzortung',
    'lightning_density',
    ...moreRows.map((r) => r.id),
];

/** Reactive enabled map (layers + legacy bridge flags). */
const enabled = computed(() => {
    const out: Record<string, boolean> = {};
    for (const id of allIds) {
        out[id] = Boolean(state.layers[id]?.enabled);
    }
    if (state.overlayEnabled) out.radar_overlay = true;
    if (state.alertsEnabled) out.nws_wwa = true;
    if (state.lightningEnabled) out.blitzortung = true;
    if (state.densityLightningEnabled) out.lightning_density = true;
    return out;
});

/** Track opacity values reactively (radar + per-layer). */
const opacities = computed(() => {
    void state.opacity;
    void state.layers;
    const out: Record<string, number> = {};
    for (const id of allIds) {
        out[id] = getLayerOpacity(id);
    }
    return out;
});

const forecastLine = computed(() => {
    const src = listSources().find((s) => s.sourceId === state.forecastSourceId);
    const name = src?.displayName ?? state.forecastSourceId;
    const place = state.placeName
        || (state.queryLat != null ? `${state.queryLat}, ${state.queryLon}` : 'No location');
    if (forecast.error && state.queryLat != null) return `${name} · ${forecast.error}`;
    return `${name} · ${place}`;
});

/** Summary from the cached list only; the home pane never fetches it. */
const spotLine = computed(() => {
    if (spot.fetchedAt == null) return 'Not loaded';
    const office = state.spotOffice || spot.autoOffice;
    const n = filterSpotRequests(spot.requests, {
        scope: state.spotScope,
        office,
        radiusMi: state.spotRadiusMi,
        lat: state.queryLat,
        lon: state.queryLon,
        category: state.spotCategory,
        hideComplete: state.spotHideComplete,
    }).length;
    const where = state.spotScope === 'office'
        ? (office || 'No office')
        : state.spotScope === 'radius' ? `Within ${state.spotRadiusMi} mi` : 'All offices';
    return `${where} · ${n} active · updated ${ageLabelMs(spot.fetchedAt)}`;
});

onMounted(() => refreshAllStatuses());

function pct(id: string): number {
    return Math.round((opacities.value[id] ?? 0.7) * 100);
}

async function toggle(id: string, ev: Event): Promise<void> {
    const on = (ev.target as HTMLInputElement).checked;
    await setLayerEnabled(id, on);
}

function onOpacity(id: string, ev: Event): void {
    setLayerOpacity(id, Number((ev.target as HTMLInputElement).value) / 100);
}

function wheelStep(ev: WheelEvent): number {
    return ev.deltaY < 0 ? 1 : -1;
}

function onOpacityWheel(id: string, ev: WheelEvent): void {
    setLayerOpacity(id, (pct(id) + wheelStep(ev)) / 100);
}

function onRainWindow(ev: Event): void {
    setRainTotalsWindow((ev.target as HTMLSelectElement).value as RainTotalWindowId);
}

function go(page: 'forecast' | 'radar' | 'spot'): void {
    setPage(page);
}

function onLifetime(ev: Event): void {
    setLightningStaleSec(Number((ev.target as HTMLInputElement).value));
}
</script>

<style scoped>
.master {
    margin-top: 0;
}
.sec {
    border-bottom: 1px solid var(--cloudtak-surface-border, var(--tblr-border-color, rgba(128, 128, 128, 0.3)));
    padding: 0.75rem 0;
}
.sec:first-child {
    padding-top: 0;
}
.sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
}
.sec-title {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
    opacity: 0.85;
}
.sec-meta {
    font-size: 0.8rem;
    color: var(--tblr-secondary-color, var(--tblr-secondary, inherit));
}
.opacity-row {
    margin-top: 0.35rem;
    padding-left: 0.1rem;
}
.layer-row + .layer-row {
    margin-top: 0.15rem;
}
</style>
