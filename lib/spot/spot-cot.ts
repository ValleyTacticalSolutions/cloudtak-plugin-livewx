/**
 * "Add to Map": put a spot request on the CloudTAK map as a normal authored
 * marker (CoT u-d-p) with a link to its official forecast page, so TAK users
 * who receive it can open the forecast.
 *
 * Behaves exactly like a marker drawn in CloudTAK: with an active DataSync it
 * is filed into that mission; otherwise it stays in My Features until the user
 * shares or broadcasts it. Nothing is sent unless the user clicks Add to Map.
 *
 * The public PluginAPI cannot create features, so this uses CloudTAK's map
 * store (`worker.db.add`, as the draw tool does), looked up at runtime from the
 * plugin's Pinia instance to avoid importing CloudTAK source.
 */
import { reactive } from 'vue';
import { getApi } from '../core/map-host.ts';
import { forecastUrl, statusLabel, type SpotRequest } from './spot.ts';

type AddedCot = { id?: string; origin?: { mode?: string } };

type MapStoreLike = {
    worker: {
        db: {
            add: (feature: unknown, opts: { authored: boolean }) => Promise<AddedCot | void>;
        };
    };
    refresh?: () => Promise<void>;
};

export type AddResult = {
    /** CoT id of the marker on the CloudTAK map. */
    cotId: string;
    /** True when CloudTAK filed it into the active DataSync mission. */
    inMission: boolean;
};

/** Per spot request id: add in progress, result, or error (kept across page visits). */
export const addedSpots = reactive({
    busy: {} as Record<string, boolean>,
    result: {} as Record<string, AddResult>,
    error: {} as Record<string, string>,
});

/**
 * Weather sensor icon from the Incident iconset (CloudTAK `uuid:path` form;
 * node-cot sends it to TAK clients as usericon `uuid/Incident/Sensor-Weather.png`).
 * Clients without that iconset fall back to a default marker.
 */
export const SPOT_ICON = 'de450cbf-2ffc-47fb-bd2b-ba2db89b035e:Incident/Sensor-Weather';

function mapStore(): MapStoreLike | null {
    const pinia = getApi()?.pinia as unknown as { _s?: Map<string, unknown> } | undefined;
    const store = pinia?._s?.get('cloudtak') as MapStoreLike | undefined;
    return store?.worker?.db?.add ? store : null;
}

/** Stable per request, so adding the same forecast again updates one marker. */
export function spotCotId(r: SpotRequest): string {
    return `livewx-spot-${r.id}`;
}

function remarksFor(r: SpotRequest): string {
    const lines = [
        `NWS Spot Forecast: ${r.projectName}`,
        [r.requestType, r.office, statusLabel(r.status)].filter(Boolean).join(' · '),
        `Forecast: ${forecastUrl(r.id)}`,
    ];
    return lines.join('\n');
}

/** Add (or update) the spot request as an authored CloudTAK marker. */
export async function addSpotToMap(r: SpotRequest): Promise<AddResult> {
    const store = mapStore();
    if (!store) throw new Error('CloudTAK map is not ready');

    const id = spotCotId(r);
    const now = new Date();
    const url = forecastUrl(r.id);
    // Mirrors CloudTAK's draw tool for a new point, plus an icon applied the way
    // its style picker does (type stays u-d-p, white marker color so it isn't tinted).
    const feature = {
        id,
        type: 'Feature',
        path: '/',
        properties: {
            id,
            type: 'u-d-p',
            how: 'h-g-i-g-o',
            archived: true,
            callsign: r.projectName,
            remarks: remarksFor(r),
            links: [{
                url,
                remarks: 'NWS Spot Forecast',
                relation: 'r-u',
                mime: 'text/html',
            }],
            time: now.toISOString(),
            start: now.toISOString(),
            stale: new Date(now.getTime() + 3600).toISOString(),
            center: [r.lon, r.lat],
            icon: SPOT_ICON,
            'marker-color': '#FFFFFF',
            'marker-opacity': 1,
        },
        geometry: { type: 'Point', coordinates: [r.lon, r.lat, 0] },
    };

    const cot = await store.worker.db.add(feature, { authored: true });
    await store.refresh?.();
    return {
        cotId: (cot && cot.id) || id,
        inMission: cot?.origin?.mode === 'Mission',
    };
}

/** Open the marker's CloudTAK detail view (where Share / Broadcast live). */
export function openCot(cotId: string): void {
    void getApi()?.router.push(`/cot/${encodeURIComponent(cotId)}`);
}
