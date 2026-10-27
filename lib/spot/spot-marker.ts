/**
 * Temporary "Zoom" marker for a spot request.
 *
 * A plain MapLibre layer owned by the plugin — not a CoT — so it never reaches
 * the TAK server, the CloudTAK feature list, or an active DataSync. One marker
 * at a time; each Zoom replaces it.
 */
import { reactive } from 'vue';
import { mapOf, registerModule } from '../core/map-host.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { registerFeatureLayers, unregisterFeatureLayers } from '../layers/feature-popup.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    removeLayerSafe,
    removeSourceSafe,
} from '../layers/registry.ts';
import { spotDetailHtml, spotFeatureProps } from '../layers/spot-requests.ts';
import type { SpotRequest } from './spot.ts';

const SOURCE_ID = 'livewx-spot-temp-src';
const CIRCLE_ID = 'livewx-spot-temp-circle';
const LABEL_ID = 'livewx-spot-temp-label';
const MARKER_COLOR = '#00b4d8';

/** The request currently shown as the temporary marker, if any. */
export const spotMarker = reactive({
    id: '',
    name: '',
});

let current: SpotRequest | null = null;

function data(): object {
    if (!current) return emptyFc();
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [current.lon, current.lat] },
            properties: { ...spotFeatureProps(current), label: current.projectName },
        }],
    };
}

function paint(map: LiveWxMap): void {
    ensureGeoJsonSource(map, SOURCE_ID, data());
    if (!map.getLayer(CIRCLE_ID)) {
        map.addLayer({
            id: CIRCLE_ID,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': 9,
                'circle-color': MARKER_COLOR,
                'circle-opacity': 0.9,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff',
            },
        });
    }
    if (!map.getLayer(LABEL_ID)) {
        map.addLayer({
            id: LABEL_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'text-field': ['get', 'label'],
                'text-size': 13,
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': true,
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#0f172a',
                'text-halo-width': 1.5,
            },
        });
    }
}

function remove(map: LiveWxMap): void {
    removeLayerSafe(map, LABEL_ID);
    removeLayerSafe(map, CIRCLE_ID);
    removeSourceSafe(map, SOURCE_ID);
}

/** Show (or move) the temporary marker on a spot request. */
export function showSpotMarker(r: SpotRequest): void {
    const map = mapOf();
    if (!map) return;
    // Registered per call: CloudTAK clears host modules when the plugin is disabled.
    registerModule({
        id: 'spot-temp-marker',
        // Basemap style swaps drop custom layers; put the marker back.
        restore: (m) => {
            if (current) paint(m);
        },
        destroy: () => clearSpotMarker(),
    });
    current = r;
    spotMarker.id = r.id;
    spotMarker.name = r.projectName;
    paint(map);
    registerFeatureLayers([CIRCLE_ID], {
        label: 'Spot Forecast',
        titleKeys: ['projectName'],
        detailHtml: spotDetailHtml,
    });
}

/** Remove the temporary marker. */
export function clearSpotMarker(): void {
    current = null;
    spotMarker.id = '';
    spotMarker.name = '';
    unregisterFeatureLayers([CIRCLE_ID]);
    const map = mapOf();
    if (map) remove(map);
}
