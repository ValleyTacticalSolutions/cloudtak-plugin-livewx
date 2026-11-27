/**
 * Bridge existing radar/alerts toggles into the layer catalog.
 */
import { startAlerts, stopAlerts } from '../alerts/alerts.ts';
import { getApi } from '../core/map-host.ts';
import { persist, state } from '../core/state.ts';
import { registerLayer } from './registry.ts';

export function registerBridgeLayers(): void {
    registerLayer({
        id: 'nws_wwa',
        group: 'alerts',
        label: 'WWA',
        description: 'NWS Watches, Warnings, Advisories',
        hosts: ['api.weather.gov'],
        sends: 'Alerts feed',
        start: () => {
            state.alertsEnabled = true;
            persist();
            const api = getApi();
            if (api) startAlerts(api);
        },
        stop: () => {
            state.alertsEnabled = false;
            persist();
            stopAlerts();
        },
        restore: () => {
            const api = getApi();
            if (state.alertsEnabled && api) startAlerts(api);
        },
        status: () => (state.alertsEnabled ? `${state.alertCount}` : 'Off'),
    });

    registerLayer({
        id: 'radar_overlay',
        group: 'radar',
        label: 'Radar',
        description: 'US NEXRAD, Canada GeoMet, or RainViewer global composite',
        hosts: [
            'mesonet.agron.iastate.edu',
            'geo.weather.gc.ca',
            'api.rainviewer.com',
            'tilecache.rainviewer.com',
        ],
        sends: 'Tiles',
        defaultOpacity: 0.7,
        applyOpacity: () => {
            void import('../radar/radar.ts').then((m) => m.applyOpacity());
        },
        start: async () => {
            state.overlayEnabled = true;
            persist();
            const { setOverlayEnabled } = await import('../radar/radar.ts');
            await setOverlayEnabled(true);
        },
        stop: async () => {
            state.overlayEnabled = false;
            persist();
            const { setOverlayEnabled } = await import('../radar/radar.ts');
            await setOverlayEnabled(false);
        },
        restore: () => { /* radar module handles style.load */ },
        status: () => (state.overlayEnabled ? state.status : 'Off'),
    });
}
