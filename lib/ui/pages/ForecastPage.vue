<template>
    <div class='forecast'>
        <section class='fc-block'>
            <div class='fc-loc-actions'>
                <button
                    class='btn btn-sm'
                    :class='pointUi.picking ? "btn-primary" : "btn-outline-primary"'
                    type='button'
                    @click='onSelectLocation'
                >
                    {{ pointUi.picking ? 'Click map…' : 'Select forecast location' }}
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
                class='fc-hint'
            >
                Click the map to set the forecast point.
            </p>
            <p class='fc-place'>
                <template v-if='locationLine'>
                    {{ locationLine }}
                </template>
                <template v-else>
                    No location set
                </template>
            </p>
        </section>

        <section class='fc-block'>
            <div class='fc-fields'>
                <div class='fc-field'>
                    <label
                        class='fc-label'
                        for='livewx-forecast-units'
                    >Units</label>
                    <select
                        id='livewx-forecast-units'
                        class='form-select form-select-sm'
                        :value='state.units'
                        @change='onUnits'
                    >
                        <option value='us'>
                            US
                        </option>
                        <option value='metric'>
                            Metric
                        </option>
                        <option value='aviation'>
                            Avn
                        </option>
                    </select>
                </div>
                <div class='fc-field fc-field-grow'>
                    <label
                        class='fc-label'
                        for='livewx-forecast-source'
                    >Source</label>
                    <select
                        id='livewx-forecast-source'
                        class='form-select form-select-sm'
                        :value='state.forecastSourceId'
                        @change='onSource'
                    >
                        <option
                            v-for='s in sources'
                            :key='s.sourceId'
                            :value='s.sourceId'
                        >
                            {{ s.displayName }}
                        </option>
                    </select>
                </div>
            </div>
            <div class='fc-refresh'>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    :disabled='state.queryLat == null'
                    @click='reload'
                >
                    Refresh
                </button>
                <span class='fc-age'>{{ forecastAge() }}</span>
            </div>
            <p
                v-if='forecast.error'
                class='text-danger small mb-0'
            >
                {{ forecast.error }}
            </p>
            <p
                v-if='forecast.attribution'
                class='fc-attr'
            >
                {{ forecast.attribution }}
            </p>
        </section>

        <template v-if='state.queryLat != null'>
            <h4 class='mb-2'>
                Now
            </h4>
            <div class='row g-2 mb-3'>
                <div
                    v-for='row in nowRows'
                    :key='row.label'
                    class='col-6'
                >
                    <div class='small text-secondary'>
                        {{ row.label }}
                    </div>
                    <div class='fw-bold'>
                        {{ row.value }}
                    </div>
                </div>
            </div>

            <h4 class='mb-2'>
                Next hours
            </h4>
            <div class='table-responsive mb-3'>
                <table class='table table-sm table-striped'>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Temp</th>
                            <th>Wind ({{ windUnit }})</th>
                            <th>PoP</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for='h in hourlyRows'
                            :key='h.t'
                        >
                            <td>{{ h.time }}</td>
                            <td>{{ h.temp }}</td>
                            <td>{{ h.wind }}</td>
                            <td>{{ h.pop }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <h4 class='mb-2'>
                Synopsis (AFD)
            </h4>
            <pre
                v-if='forecast.afd'
                class='small livewx-afd'
            >{{ afdPreview }}</pre>
            <p
                v-else
                class='text-secondary small'
            >
                AFD unavailable.
            </p>
        </template>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
    beginLocationPick,
    cancelLocationPick,
    pointUi,
} from '../../core/point.ts';
import { persist, setUnits, state } from '../../core/state.ts';
import {
    currentHourStartMs,
    formatInTimeZone,
    formatLocalClock,
} from '../../core/timezone.ts';
import {
    convertSpeed,
    convertTemp,
    convertLength,
    degToCompass,
    type UnitSystem,
} from '../../core/units.ts';
import {
    availableSources,
    forecast,
    forecastAge,
    readingByLabel,
    refreshForecast,
} from '../../forecast/engine.ts';

const sources = availableSources();

/** Ticks so the location local clock stays current. */
const clockNow = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
    clockTimer = setInterval(() => {
        clockNow.value = Date.now();
    }, 15_000);
});

const locationLine = computed(() => {
    void clockNow.value;
    let place = '';
    if (state.placeName) place = state.placeName;
    else if (state.queryLat != null && state.queryLon != null) {
        place = `${state.queryLat}, ${state.queryLon}`;
    }
    if (!place) return '';
    const tz = forecast.timeZone;
    if (!tz) return place;
    return `${place} - Local Time: ${formatLocalClock(tz, clockNow.value)}`;
});

const nowRows = computed(() => {
    const u = state.units;
    const rows: Array<{ label: string; value: string }> = [];
    const temp = readingByLabel('temperature', 'temperature_2m');
    if (temp?.current != null) {
        const c = convertTemp(temp.current, u);
        rows.push({ label: 'Temp', value: `${c.value}${c.unit}` });
    }
    const rh = readingByLabel('relativeHumidity', 'relative_humidity', 'RH');
    if (rh?.current != null) rows.push({ label: 'RH', value: `${Math.round(rh.current)}%` });
    const wind = readingByLabel('twentyFootWindSpeed', 'windSpeed', 'wind_speed');
    const wdir = readingByLabel('twentyFootWindDirection', 'windDirection', 'wind_direction');
    if (wind?.current != null) {
        const s = convertSpeed(wind.current, u);
        const dir = wdir?.current != null ? degToCompass(wdir.current) : '';
        rows.push({ label: 'Wind', value: `${s.value} ${s.unit} ${dir}`.trim() });
    }
    const gust = readingByLabel('windGust', 'wind_gusts');
    if (gust?.current != null) {
        const s = convertSpeed(gust.current, u);
        rows.push({ label: 'Gust', value: `${s.value} ${s.unit}` });
    }
    const mix = readingByLabel('mixingHeight');
    if (mix?.current != null) {
        const l = convertLength(mix.current, u);
        rows.push({ label: 'Mixing Height', value: `${l.value} ${l.unit}` });
    }
    const tw = readingByLabel('transportWindSpeed');
    if (tw?.current != null) {
        const s = convertSpeed(tw.current, u);
        rows.push({ label: 'Transport Wind', value: `${s.value} ${s.unit}` });
    }
    const wbgt = readingByLabel('wetBulbGlobeTemperature', 'WBGT');
    if (wbgt?.current != null) {
        const c = convertTemp(wbgt.current, u);
        rows.push({ label: 'WBGT', value: `${c.value}${c.unit}` });
    }
    const pop = readingByLabel('probabilityOfPrecipitation', 'precipitation_probability', 'PoP');
    if (pop?.current != null) rows.push({ label: 'PoP', value: `${Math.round(pop.current)}%` });
    const sky = readingByLabel('skyCover', 'cloud_cover');
    if (sky?.current != null) rows.push({ label: 'Sky', value: `${Math.round(sky.current)}%` });
    return rows;
});

const windUnit = computed(() => convertSpeed(0, state.units).unit);

const hourlyRows = computed(() => {
    const temp = readingByLabel('temperature', 'temperature_2m');
    const wind = readingByLabel('windSpeed', 'wind_speed', 'twentyFootWindSpeed');
    const pop = readingByLabel('probabilityOfPrecipitation', 'precipitation_probability');
    // Current hour and forward in the *forecast location* timezone (not browser TZ).
    const tz = forecast.timeZone;
    const fromMs = tz
        ? currentHourStartMs(tz)
        : (() => {
            const hourStart = new Date();
            hourStart.setMinutes(0, 0, 0);
            return hourStart.getTime();
        })();
    const future = (temp?.series ?? []).filter((pt) => {
        const ms = new Date(pt.t).getTime();
        return Number.isFinite(ms) && ms >= fromMs;
    }).slice(0, 36);
    return future.map((pt) => {
        const t = convertTemp(pt.v ?? 0, state.units);
        const wi = wind?.series?.find((p) => p.t === pt.t)?.v;
        const ws = wi != null ? convertSpeed(wi, state.units) : null;
        const p = pop?.series?.find((sp) => sp.t === pt.t)?.v;
        const timeOpts: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric' };
        const time = tz
            ? formatInTimeZone(pt.t, tz, timeOpts)
            : new Date(pt.t).toLocaleString(undefined, timeOpts);
        return {
            t: pt.t,
            time,
            temp: pt.v != null ? `${t.value}${t.unit}` : '—',
            wind: ws ? `${ws.value}` : '—',
            pop: p != null ? `${Math.round(p)}%` : '—',
        };
    });
});

const afdPreview = computed(() => {
    const t = forecast.afd || '';
    return t.length > 4000 ? `${t.slice(0, 4000)}…` : t;
});

onUnmounted(() => {
    if (clockTimer != null) {
        clearInterval(clockTimer);
        clockTimer = null;
    }
    if (pointUi.picking) cancelLocationPick();
});

function onSelectLocation(): void {
    if (pointUi.picking) {
        cancelLocationPick();
        return;
    }
    beginLocationPick(() => {
        void refreshForecast();
    });
}

function onUnits(e: Event): void {
    setUnits((e.target as HTMLSelectElement).value as UnitSystem);
}

function onSource(e: Event): void {
    state.forecastSourceId = (e.target as HTMLSelectElement).value;
    persist();
    void refreshForecast();
}

function reload(): void {
    void refreshForecast();
}
</script>

<style scoped>
.forecast {
    display: flex;
    flex-direction: column;
    gap: 0;
}
.fc-block {
    padding: 0 0 0.85rem;
    margin-bottom: 0.85rem;
    border-bottom: 1px solid var(--cloudtak-surface-border, var(--tblr-border-color, rgba(128, 128, 128, 0.3)));
}
.fc-block:last-of-type {
    border-bottom: none;
}
.fc-loc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
}
.fc-hint {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: var(--tblr-secondary-color, var(--tblr-secondary, inherit));
}
.fc-place {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: var(--tblr-secondary-color, var(--tblr-secondary, inherit));
}
.fc-fields {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: 0.65rem 0.75rem;
    align-items: end;
}
.fc-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
}
.fc-label {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.85;
}
.fc-refresh {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.65rem;
}
.fc-age {
    font-size: 0.8rem;
    color: var(--tblr-secondary-color, var(--tblr-secondary, inherit));
}
.fc-attr {
    margin: 0.55rem 0 0;
    font-size: 0.8rem;
    color: var(--tblr-secondary-color, var(--tblr-secondary, inherit));
}
.livewx-afd {
    white-space: pre-wrap;
    max-height: 16rem;
    overflow: auto;
    background: transparent;
    color: inherit;
}
</style>
