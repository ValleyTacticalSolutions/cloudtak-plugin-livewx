<template>
    <div class='livewx-app'>
        <div
            v-if='state.page !== "home"'
            class='livewx-chrome'
        >
            <button
                class='btn btn-sm btn-outline-secondary'
                type='button'
                @click='setPage("home")'
            >
                ← Back
            </button>
        </div>

        <MasterPane v-if='state.page === "home"' />
        <ForecastPage v-else-if='state.page === "forecast"' />
        <RadarContainer
            v-else-if='state.page === "radar"'
            :api='api'
        />
        <SpotPage v-else-if='state.page === "spot"' />
    </div>
</template>

<script setup lang='ts'>
import type { PluginAPI } from '@tak-ps/cloudtak';
import { setPage, state } from '../core/state.ts';
import RadarContainer from '../radar/RadarContainer.vue';
import ForecastPage from './pages/ForecastPage.vue';
import MasterPane from './pages/MasterPane.vue';
import SpotPage from './pages/SpotPage.vue';

defineProps<{ api: PluginAPI }>();
</script>

<style scoped>
.livewx-app {
    color: inherit;
}
.livewx-chrome {
    border-bottom: 1px solid var(--cloudtak-surface-border, var(--tblr-border-color, rgba(128, 128, 128, 0.3)));
    padding-bottom: 0.5rem;
    margin-bottom: 0.75rem;
}
</style>
