<template>
    <div
        class='position-absolute start-0 top-0 bottom-0 end-0'
        :style='`z-index: ${zindex}`'
    >
        <div
            class='card h-100 livewx-shell'
            :class='{ "border-0": !border }'
        >
            <div
                v-if='name'
                class='card-header d-flex align-items-center py-2'
            >
                <h3 class='card-title mb-0'>
                    {{ name }}
                </h3>
                <div class='ms-auto d-flex align-items-center gap-2'>
                    <slot name='buttons' />
                    <button
                        class='btn btn-sm btn-outline-secondary livewx-legends-btn'
                        type='button'
                        @click='toggleLegendsVisible()'
                    >
                        {{ state.legendsVisible ? 'Hide Legends' : 'Show Legends' }}
                    </button>
                    <button
                        class='btn btn-sm btn-outline-secondary livewx-legends-btn'
                        type='button'
                        @click='toggleRadarAgeVisible()'
                    >
                        {{ state.radarAgeVisible ? 'Hide Radar Time' : 'Show Radar Time' }}
                    </button>
                    <TablerIconButton
                        v-if='backType === "close"'
                        title='Close'
                        @click='router.push("/")'
                    >
                        <IconCircleX
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        v-else-if='backType === "back"'
                        title='Back'
                        @click='routerBack'
                    >
                        <IconCircleArrowLeft
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
            <div class='card-body overflow-auto'>
                <TablerLoading
                    v-if='loading'
                    desc='Loading'
                />
                <TablerNone
                    v-else-if='none'
                    :label='name'
                />
                <slot v-else />
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import {
    TablerNone,
    TablerLoading,
    TablerIconButton,
} from '@tak-ps/vue-tabler';

import {
    IconCircleX,
    IconCircleArrowLeft,
} from '@tabler/icons-vue';

import { useRouter } from 'vue-router';
import { computed } from 'vue';
import { state, toggleLegendsVisible, toggleRadarAgeVisible } from '../core/state.ts';

const router = useRouter();

const props = defineProps({
    name: {
        type: String,
        required: true,
    },
    zindex: {
        type: Number,
        default: 1020,
    },
    border: {
        type: Boolean,
        default: true,
    },
    back: {
        type: Boolean,
        default: true,
    },
    loading: {
        type: Boolean,
        default: false,
    },
    none: {
        type: Boolean,
        default: false,
    },
});

function routerBack() {
    if (!router.options.history.state.back || String(router.options.history.state.back).startsWith('/login')) {
        router.push('/');
    } else {
        router.back();
    }
}

const backType = computed(() => {
    if (!props.back) return 'none';
    if (
        !router.options.history.state.back
        || router.options.history.state.back === '/'
    ) {
        return 'close';
    }
    return 'back';
});
</script>

<style scoped>
/* No surface of its own: host MenuTemplate / panel tokens cover light and dark. */
.livewx-shell {
    color: var(--cloudtak-surface-color, var(--tblr-body-color, inherit));
    background: var(--cloudtak-panel-bg, var(--cloudtak-surface-bg, transparent)) !important;
    border-color: var(--cloudtak-surface-border, transparent);
    box-shadow: none;
}
.livewx-shell :deep(.card-header) {
    color: inherit;
    background: transparent !important;
    border-color: var(--cloudtak-surface-border, var(--tblr-border-color, transparent));
}
.livewx-shell :deep(.card-body) {
    background: transparent;
    padding-top: 0.75rem;
}
.livewx-shell :deep(.card-title),
.livewx-shell :deep(.form-label),
.livewx-shell :deep(.form-check-label) {
    color: inherit;
}
.livewx-shell :deep(.form-range) {
    accent-color: var(--tblr-primary);
}
.livewx-shell :deep(.text-secondary),
.livewx-shell :deep(.form-hint) {
    color: var(--tblr-secondary-color, var(--tblr-secondary, inherit)) !important;
}
.livewx-legends-btn {
    white-space: nowrap;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
}
</style>
