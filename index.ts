import type { App } from 'vue';
import { h } from 'vue';
import type { PluginAPI, PluginInstance } from '@tak-ps/cloudtak';
import MenuTemplate from './lib/ui/MenuTemplate.vue';
import AppShell from './lib/ui/AppShell.vue';
import { IconLiveWx } from './lib/ui/icon.ts';
import { MENU_KEY, ROUTE_NAME } from './lib/core/constants.ts';
import { setHost } from './lib/core/host.ts';
import { destroy, init } from './lib/plugin.ts';

export default class LiveWxRadar implements PluginInstance {
    api: PluginAPI;
    private enabled = false;

    constructor(api: PluginAPI) {
        this.api = api;
        setHost(api);

        // Routes register once at install time and are never removed —
        // CloudTAK calls disable() before enable() on load, so removing
        // the route at disable() makes the subsequent menu.add fail.
        this.api.routes.add({
            path: 'plugin-livewx-radar',
            name: ROUTE_NAME,
            component: {
                render: () => h(MenuTemplate, { name: 'LiveWX', back: false }, {
                    default: () => h(AppShell, { api: this.api }),
                }),
            },
        }, 'home-menu');
    }

    static async install(app: App, api: PluginAPI): Promise<LiveWxRadar> {
        void app;
        return new LiveWxRadar(api);
    }

    async enable(): Promise<void> {
        // Idempotent: a repeated or late enable() must not stack a second set of layers/timers
        if (this.enabled) return;
        this.enabled = true;
        try {
            await init(this.api);
        } catch (err) {
            this.enabled = false;
            try { destroy(); } catch { /* partial init */ }
            throw err;
        }

        this.api.menu.add({
            key: MENU_KEY,
            label: 'LiveWX',
            route: ROUTE_NAME,
            tooltip: 'LiveWX Weather',
            description: 'Forecast, radar, NWS alerts, lightning, fire/hydro/marine layers',
            icon: IconLiveWx,
        });
    }

    async disable(): Promise<void> {
        // Safe when never enabled (e.g. CloudTAK calls disable() first on a late load)
        this.enabled = false;
        try { destroy(); } catch { /* map already gone */ }
        try { this.api.menu.remove(MENU_KEY); } catch { /* ignore */ }
        // Intentionally NOT removing the route — see constructor note.
    }
}
