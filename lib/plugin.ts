/**
 * Plugin lifecycle: map host, layers, forecast point, radar/alerts.
 */
import type { PluginAPI } from '@tak-ps/cloudtak';
import { refreshAuthToken } from './core/auth-token.ts';
import { destroyMapHost, initMapHost } from './core/map-host.ts';
import { destroyPointController, initPointController, refreshQueryPoint } from './core/point.ts';
import { persist, state } from './core/state.ts';
import { refreshForecast } from './forecast/engine.ts';
import { registerBridgeLayers } from './layers/bridges.ts';
import { registerCatalogLayers } from './layers/catalog.ts';
import { registerHurricaneLayer } from './layers/hurricanes.ts';
import { migrateLegacyRainLayers } from './layers/rain-totals.ts';
import { startEnabledLayers, stopAllLayers } from './layers/registry.ts';
import { registerDensityLayer, applyDensityFromState } from './lightning/density.ts';
import { destroy as destroyRadar, init as initRadar } from './radar/radar.ts';
import { attachLegendBar, detachLegendBar } from './ui/legend-bar.ts';
import { registerWindLayer } from './wind/particles.ts';

let wired = false;
let forecastTimer: ReturnType<typeof setInterval> | null = null;

function ensureCatalog(): void {
    if (wired) return;
    registerBridgeLayers();
    registerCatalogLayers();
    registerHurricaneLayer();
    registerDensityLayer();
    registerWindLayer();
    wired = true;
}

/** Migrate pre-registry toggles into layer consent/enabled flags. */
function syncLegacyLayerFlags(): void {
    const pairs: Array<[string, boolean]> = [
        ['nws_wwa', state.alertsEnabled],
        ['radar_overlay', state.overlayEnabled],
        ['radar_sites', state.sitesOnMap],
        ['lightning_density', state.densityLightningEnabled],
    ];
    for (const [id, on] of pairs) {
        if (!on) continue;
        if (!state.layers[id]) state.layers[id] = { enabled: true, consent: true };
        else {
            state.layers[id].enabled = true;
            state.layers[id].consent = true;
        }
    }
    persist();
}

export async function init(api: PluginAPI): Promise<void> {
    ensureCatalog();
    syncLegacyLayerFlags();
    migrateLegacyRainLayers();
    await refreshAuthToken();
    initMapHost(api);
    initPointController(api);
    await initRadar(api);
    applyDensityFromState();
    await startEnabledLayers();
    attachLegendBar();
    await refreshQueryPoint();
    void refreshForecast();
    if (forecastTimer) clearInterval(forecastTimer);
    forecastTimer = setInterval(() => {
        void refreshAuthToken()
            .then(() => refreshQueryPoint())
            .then(() => refreshForecast());
    }, 5 * 60_000);
}

export function destroy(): void {
    // destroyMapHost() drops the layer modules, so the catalog must register again on the next init
    wired = false;
    if (forecastTimer) {
        clearInterval(forecastTimer);
        forecastTimer = null;
    }
    stopAllLayers();
    detachLegendBar();
    destroyPointController();
    destroyRadar();
    destroyMapHost();
}

export { refreshForecast, refreshQueryPoint };
