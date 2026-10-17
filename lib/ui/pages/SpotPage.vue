<template>
    <div class='spot'>
        <section class='sp-block'>
            <button
                class='btn btn-sm btn-outline-primary w-100'
                type='button'
                @click='onRequest'
            >
                Request a Spot Forecast
            </button>
            <p class='sp-hint'>
                Opens the official NWS request form in its own window. Requests are filled out and submitted there.
            </p>
            <div
                v-if='copyText'
                class='sp-copy'
            >
                <code
                    ref='copyEl'
                    class='sp-copy-text'
                >{{ copyText }}</code>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    @click='onCopy'
                >
                    {{ copyLabel }}
                </button>
            </div>
        </section>

        <section class='sp-block'>
            <div class='sp-loc-actions'>
                <button
                    class='btn btn-sm'
                    :class='pointUi.picking ? "btn-primary" : "btn-outline-primary"'
                    type='button'
                    @click='onSelectLocation'
                >
                    {{ pointUi.picking ? 'Click map…' : 'Select location' }}
                </button>
                <button
                    v-if='pointUi.picking'
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    @click='cancelLocationPick'
                >
                    Cancel
                </button>
            </div>
            <p
                v-if='pointUi.picking'
                class='sp-hint'
            >
                Click the map to set the location.
            </p>
            <p class='sp-place'>
                {{ placeLine }}
            </p>

            <div class='sp-fields'>
                <div class='sp-field'>
                    <label
                        class='sp-label'
                        for='livewx-spot-office'
                    >Office</label>
                    <select
                        id='livewx-spot-office'
                        class='form-select form-select-sm'
                        :value='state.spotOffice'
                        @change='onOffice'
                    >
                        <option value=''>
                            {{ spot.autoOffice ? `Auto (${spot.autoOffice})` : 'Auto' }}
                        </option>
                        <option
                            v-for='o in offices'
                            :key='o'
                            :value='o'
                        >
                            {{ o }}
                        </option>
                    </select>
                </div>
                <div class='sp-field'>
                    <label
                        class='sp-label'
                        for='livewx-spot-scope'
                    >Show</label>
                    <select
                        id='livewx-spot-scope'
                        class='form-select form-select-sm'
                        :value='state.spotScope'
                        @change='onScope'
                    >
                        <option value='office'>
                            This office
                        </option>
                        <option value='radius'>
                            Within radius
                        </option>
                        <option value='all'>
                            All offices
                        </option>
                    </select>
                </div>
                <div
                    v-if='state.spotScope === "radius"'
                    class='sp-field'
                >
                    <label
                        class='sp-label'
                        for='livewx-spot-radius'
                    >Radius</label>
                    <select
                        id='livewx-spot-radius'
                        class='form-select form-select-sm'
                        :value='state.spotRadiusMi'
                        @change='onRadius'
                    >
                        <option
                            v-for='r in radii'
                            :key='r'
                            :value='r'
                        >
                            {{ r }} mi
                        </option>
                    </select>
                </div>
                <div class='sp-field'>
                    <label
                        class='sp-label'
                        for='livewx-spot-category'
                    >Incident</label>
                    <select
                        id='livewx-spot-category'
                        class='form-select form-select-sm'
                        :value='state.spotCategory'
                        @change='onCategory'
                    >
                        <option value=''>
                            All
                        </option>
                        <option
                            v-for='c in categories'
                            :key='c'
                            :value='c'
                        >
                            {{ c }}
                        </option>
                    </select>
                </div>
            </div>

            <div class='form-check mt-2 mb-0'>
                <input
                    id='livewx-spot-hide-complete'
                    class='form-check-input'
                    type='checkbox'
                    :checked='state.spotHideComplete'
                    @change='onHideComplete'
                >
                <label
                    class='form-check-label'
                    for='livewx-spot-hide-complete'
                >Hide complete</label>
            </div>

            <div class='sp-refresh'>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    :disabled='spot.loading'
                    @click='reload'
                >
                    Refresh
                </button>
                <span class='sp-age'>{{ ageLine }}</span>
            </div>
            <p
                v-if='errorLine'
                class='text-danger small mb-0 mt-2'
            >
                {{ errorLine }}
            </p>
        </section>

        <section class='sp-list'>
            <p
                v-if='scopeHint'
                class='sp-hint mt-0'
            >
                {{ scopeHint }}
            </p>
            <template v-else>
                <p class='sp-count'>
                    {{ countLine }}
                </p>
                <p
                    v-if='rows.length'
                    class='sp-hint mt-0 mb-2'
                >
                    Zoom shows a temporary marker only you see. Add to Map creates a CloudTAK marker linking to the
                    forecast: into the active DataSync if one is active, otherwise My Features until you share it.
                </p>
                <div
                    v-if='spotMarker.id'
                    class='sp-temp'
                >
                    <span class='sp-temp-text'>Zoom marker: {{ spotMarker.name }}</span>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        type='button'
                        @click='clearSpotMarker'
                    >
                        Clear
                    </button>
                </div>
                <div
                    v-for='row in visibleRows'
                    :key='row.id'
                    class='sp-row'
                >
                    <div class='sp-row-head'>
                        <div class='sp-title'>
                            {{ row.projectName }}
                        </div>
                        <span
                            class='sp-badge'
                            :class='`sp-badge-${row.status}`'
                        >{{ statusLabel(row.status) }}</span>
                    </div>
                    <div class='sp-sub'>
                        {{ subLine(row) }}
                    </div>
                    <div class='sp-sub'>
                        {{ timeLine(row) }}
                    </div>
                    <div class='sp-actions'>
                        <button
                            class='btn btn-sm btn-outline-primary'
                            type='button'
                            @click='openForecast(row)'
                        >
                            Open forecast
                        </button>
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            type='button'
                            @click='zoomTo(row)'
                        >
                            Zoom
                        </button>
                        <button
                            class='btn btn-sm btn-outline-secondary'
                            type='button'
                            :disabled='addedSpots.busy[row.id]'
                            @click='addToMap(row)'
                        >
                            {{ addedSpots.result[row.id] ? 'Update on Map' : 'Add to Map' }}
                        </button>
                    </div>
                    <div
                        v-if='addedSpots.result[row.id]'
                        class='sp-added'
                    >
                        <span>{{ addedLine(row) }}</span>
                        <button
                            class='btn btn-sm btn-link p-0'
                            type='button'
                            @click='openCot(addedSpots.result[row.id].cotId)'
                        >
                            Open marker
                        </button>
                    </div>
                    <p
                        v-if='addedSpots.error[row.id]'
                        class='text-danger small mb-0 mt-1'
                    >
                        {{ addedSpots.error[row.id] }}
                    </p>
                </div>
                <p
                    v-if='rows.length > visibleRows.length'
                    class='sp-hint'
                >
                    Showing the first {{ visibleRows.length }}. Narrow the filters to see the rest.
                </p>
                <p
                    v-if='spot.fetchedAt != null && !rows.length'
                    class='sp-hint'
                >
                    No active spot forecasts match.
                    <a
                        v-if='activeOffice'
                        :href='officeUrl(activeOffice)'
                        target='_blank'
                        rel='noopener noreferrer'
                        @click.prevent='openOffice'
                    >View the {{ activeOffice }} monitor</a>
                </p>
            </template>
        </section>

        <p class='sp-attr'>
            Data from the NWS Spot Forecast Monitor via NOAA map services (updated about every 15 minutes). Read-only; request forecasts through the official form.
        </p>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ageLabelMs } from '../../core/egress.ts';
import { mapOf } from '../../core/map-host.ts';
import {
    beginLocationPick,
    cancelLocationPick,
    pointUi,
} from '../../core/point.ts';
import { setSpotFilter, state, type SpotScope } from '../../core/state.ts';
import { formatInTimeZone } from '../../core/timezone.ts';
import { convertLength } from '../../core/units.ts';
import { openLinkWindow } from '../../layers/feature-popup.ts';
import { addSpotToMap, addedSpots, openCot } from '../../spot/spot-cot.ts';
import { clearSpotMarker, showSpotMarker, spotMarker } from '../../spot/spot-marker.ts';
import {
    NEW_REQUEST_URL,
    SPOT_CATEGORIES,
    SPOT_RADII_MI,
    filterSpotRequests,
    forecastUrl,
    listOffices,
    loadSpotRequests,
    officeUrl,
    refreshAutoOffice,
    spot,
    statusLabel,
    type SpotRow,
} from '../../spot/spot.ts';

/** Rows rendered at once; the national list can be several hundred. */
const MAX_ROWS = 200;
const TICK_MS = 30_000;

const radii = SPOT_RADII_MI;

const categories = SPOT_CATEGORIES;

/** Ticks so age labels stay current; also re-checks the 5-minute cache. */
const now = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

const copyEl = ref<HTMLElement | null>(null);
const copyLabel = ref('Copy');

onMounted(() => {
    void loadSpotRequests();
    void refreshAutoOffice(state.queryLat, state.queryLon);
    tickTimer = setInterval(() => {
        now.value = Date.now();
        void loadSpotRequests();
    }, TICK_MS);
});

onUnmounted(() => {
    if (tickTimer != null) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
    if (pointUi.picking) cancelLocationPick();
});

watch(() => [state.queryLat, state.queryLon], () => {
    void refreshAutoOffice(state.queryLat, state.queryLon);
});

const activeOffice = computed(() => state.spotOffice || spot.autoOffice);

const offices = computed(() => {
    const list = listOffices(spot.requests);
    for (const id of [state.spotOffice, spot.autoOffice]) {
        if (id && !list.includes(id)) list.push(id);
    }
    return list.sort((a, b) => a.localeCompare(b));
});

const placeLine = computed(() => {
    if (state.queryLat == null || state.queryLon == null) return 'No location set';
    const place = state.placeName || `${state.queryLat}, ${state.queryLon}`;
    return spot.autoOffice ? `${place} · NWS ${spot.autoOffice}` : place;
});

const copyText = computed(() => {
    if (state.queryLat == null || state.queryLon == null) return '';
    const office = activeOffice.value;
    return `Lat/Lon: ${state.queryLat}, ${state.queryLon}${office ? ` · NWS office: ${office}` : ''}`;
});

const rows = computed<SpotRow[]>(() => filterSpotRequests(spot.requests, {
    scope: state.spotScope,
    office: activeOffice.value,
    radiusMi: state.spotRadiusMi,
    lat: state.queryLat,
    lon: state.queryLon,
    category: state.spotCategory,
    hideComplete: state.spotHideComplete,
}));

const visibleRows = computed(() => rows.value.slice(0, MAX_ROWS));

/** Why the list is empty before filtering even applies. */
const scopeHint = computed(() => {
    if (state.spotScope === 'office' && !activeOffice.value) {
        return 'Select a location or choose an office to list its spot forecasts.';
    }
    if (state.spotScope === 'radius' && state.queryLat == null) {
        return 'Select a location to list spot forecasts within the radius.';
    }
    return '';
});

const countLine = computed(() => {
    const n = rows.value.length;
    const what = `${n} active spot forecast${n === 1 ? '' : 's'}`;
    if (state.spotScope === 'office') return `${what} · ${activeOffice.value}`;
    if (state.spotScope === 'radius') return `${what} within ${state.spotRadiusMi} mi`;
    return `${what} · all offices`;
});

const ageLine = computed(() => {
    void now.value;
    if (spot.loading) return 'Loading…';
    if (spot.fetchedAt == null) return 'Not loaded';
    return `Updated ${ageLabelMs(spot.fetchedAt)}`;
});

const errorLine = computed(() => {
    void now.value;
    if (!spot.error) return '';
    if (spot.fetchedAt == null) return spot.error;
    return `Refresh failed (${spot.error}) — showing data from ${ageLabelMs(spot.fetchedAt)}.`;
});

function subLine(row: SpotRow): string {
    const parts = [row.requestType, row.office].filter(Boolean);
    if (row.distanceMi != null) {
        const d = convertLength(row.distanceMi * 1609.34, state.units);
        parts.push(`${d.value} ${d.unit}`);
    }
    return parts.join(' · ');
}

function formatWhen(ms: number, tz: string): string {
    const opts: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    };
    return tz ? formatInTimeZone(ms, tz, opts) : new Date(ms).toLocaleString(undefined, opts);
}

function timeLine(row: SpotRow): string {
    void now.value;
    const parts: string[] = [];
    if (row.deliverAt != null) parts.push(`Deliver ${formatWhen(row.deliverAt, row.timeZone)}`);
    if (row.status === 'pending') {
        parts.push('Awaiting forecast');
    } else {
        parts.push(row.filledAt != null ? `Forecast issued ${ageLabelMs(row.filledAt)}` : 'Forecast issued');
    }
    return parts.join(' · ');
}

function onRequest(): void {
    openLinkWindow(NEW_REQUEST_URL, {
        name: 'livewx-spot-request',
        maxWidth: 1200,
        maxHeight: 900,
    });
}

async function onCopy(): Promise<void> {
    try {
        await navigator.clipboard.writeText(copyText.value);
        copyLabel.value = 'Copied';
    } catch {
        // Clipboard API unavailable (e.g. non-secure context): select for manual copy.
        const el = copyEl.value;
        const sel = window.getSelection();
        if (el && sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
        }
        copyLabel.value = 'Press Ctrl/Cmd+C';
    }
    setTimeout(() => { copyLabel.value = 'Copy'; }, 2500);
}

function onSelectLocation(): void {
    if (pointUi.picking) {
        cancelLocationPick();
        return;
    }
    beginLocationPick(() => {
        void refreshAutoOffice(state.queryLat, state.queryLon);
    });
}

function onOffice(e: Event): void {
    setSpotFilter({ spotOffice: (e.target as HTMLSelectElement).value });
}

function onScope(e: Event): void {
    setSpotFilter({ spotScope: (e.target as HTMLSelectElement).value as SpotScope });
}

function onRadius(e: Event): void {
    setSpotFilter({ spotRadiusMi: Number((e.target as HTMLSelectElement).value) });
}

function onCategory(e: Event): void {
    setSpotFilter({ spotCategory: (e.target as HTMLSelectElement).value });
}

function onHideComplete(e: Event): void {
    setSpotFilter({ spotHideComplete: (e.target as HTMLInputElement).checked });
}

function reload(): void {
    void loadSpotRequests(true);
}

function openForecast(row: SpotRow): void {
    openLinkWindow(forecastUrl(row.id));
}

function openOffice(): void {
    if (activeOffice.value) openLinkWindow(officeUrl(activeOffice.value));
}

function addedLine(row: SpotRow): string {
    const r = addedSpots.result[row.id];
    if (!r) return '';
    return r.inMission
        ? 'On the map in the active DataSync.'
        : 'On the map in My Features — use Share to send it.';
}

async function addToMap(row: SpotRow): Promise<void> {
    addedSpots.busy[row.id] = true;
    delete addedSpots.error[row.id];
    try {
        addedSpots.result[row.id] = await addSpotToMap(row);
        // The real marker replaces the temporary one for this request.
        if (spotMarker.id === row.id) clearSpotMarker();
    } catch (e) {
        addedSpots.error[row.id] = e instanceof Error ? e.message : 'Could not add the marker';
    } finally {
        addedSpots.busy[row.id] = false;
    }
}

function zoomTo(row: SpotRow): void {
    const map = mapOf();
    if (!map?.flyTo) return;
    showSpotMarker(row);
    map.flyTo({
        center: [row.lon, row.lat],
        zoom: Math.max(map.getZoom?.() ?? 0, 10),
    });
}
</script>

<style scoped>
.spot {
    display: flex;
    flex-direction: column;
}
.sp-block {
    padding: 0 0 0.85rem;
    margin-bottom: 0.85rem;
    border-bottom: 1px solid var(--livewx-border, var(--tblr-border-color, #333));
}
.sp-hint {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: var(--tblr-secondary, inherit);
}
.sp-copy {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
}
.sp-copy-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    user-select: all;
}
.sp-loc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
}
.sp-place {
    margin: 0.4rem 0 0.65rem;
    font-size: 0.85rem;
    color: var(--tblr-secondary, inherit);
}
.sp-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem 0.75rem;
}
.sp-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
}
.sp-label {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.85;
}
.sp-refresh {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.65rem;
}
.sp-age {
    font-size: 0.8rem;
    color: var(--tblr-secondary, inherit);
}
.sp-count {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    font-weight: 600;
}
.sp-row {
    padding: 0.55rem 0;
    border-top: 1px solid var(--livewx-border, var(--tblr-border-color, #333));
}
.sp-row-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
}
.sp-title {
    font-weight: 700;
    min-width: 0;
    overflow-wrap: anywhere;
}
.sp-sub {
    font-size: 0.8rem;
    color: var(--tblr-secondary, inherit);
}
.sp-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.4rem;
}
.sp-temp {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
}
.sp-temp-text {
    min-width: 0;
    overflow-wrap: anywhere;
}
.sp-added {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.35rem;
    font-size: 0.8rem;
    color: var(--tblr-secondary, inherit);
}
.sp-badge {
    flex-shrink: 0;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid currentColor;
    white-space: nowrap;
}
.sp-badge-complete {
    color: #2fb344;
}
.sp-badge-pending {
    color: #f59f00;
}
.sp-attr {
    margin: 0.85rem 0 0;
    font-size: 0.75rem;
    color: var(--tblr-secondary, inherit);
}
</style>
