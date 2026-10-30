/**
 * Registers map layers kept for the master pane (priority + pruned More).
 */
import { MAPSERVICES_NWS, NWM_SERVICES } from '../core/constants.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { state } from '../core/state.ts';
import { RIPPLE_ICON } from '../core/map-icons.ts';
import { createGeoLayer, arcgisQueryUrl, mapEnvelope } from './geo-layer.ts';
import { getLayerOpacity, registerLayer } from './registry.ts';
import { registerFireOutlookLayer } from './fire-outlook.ts';
import {
    highFlowStatus,
    startHighFlowExtras,
    stopHighFlowExtras,
    type HighFlowId,
} from './high-flow.ts';
import { registerFuelMoistureLayer } from './fuels.ts';
import { registerMetarLayer } from './metars.ts';
import { registerRainGaugesLayer } from './rain-gauges.ts';
import { registerSpotRequestsLayer } from './spot-requests.ts';
import { registerRainTotalsLayer } from './rain-totals.ts';
import {
    arcgisExportTileUrl,
    ensureRasterLayer,
    iemWmsTileUrl,
    removeRaster,
} from './wms.ts';

function extentUrl(baseQuery: string): string | null {
    const env = mapEnvelope();
    if (!env) return baseQuery;
    // Leave geometry unencoded — viaProxy encodes the whole URL once.
    return `${baseQuery}${baseQuery.includes('?') ? '&' : '?'}geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`;
}

function registerWmsLayer(opts: {
    id: string;
    group: Parameters<typeof registerLayer>[0]['group'];
    label: string;
    description: string;
    hosts: string[];
    sends: string;
    sourceId: string;
    layerId: string;
    tileUrl: () => string;
    opacity?: number;
    minzoom?: number;
    maxzoom?: number;
    /** Re-request tiles this often while on (tileUrl should change with time). */
    refreshMs?: number;
    /** Extra behavior while on (tap details, summaries); start runs again on restore. */
    extras?: { start: () => void; stop: () => void; status: () => string };
}): void {
    const defaultOpacity = opts.opacity ?? 0.65;
    let running = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    registerLayer({
        id: opts.id,
        group: opts.group,
        label: opts.label,
        description: opts.description,
        hosts: opts.hosts,
        sends: opts.sends,
        defaultOpacity,
        applyOpacity: (opacity) => {
            const m = mapOf();
            if (m?.getLayer(opts.layerId)) {
                m.setPaintProperty?.(opts.layerId, 'raster-opacity', opacity);
            }
        },
        start: () => {
            running = true;
            const m = mapOf();
            if (m) optsRestore(m);
            opts.extras?.start();
            if (opts.refreshMs && !timer) {
                timer = setInterval(() => {
                    const map = mapOf();
                    if (running && map) optsRestore(map);
                }, opts.refreshMs);
            }
        },
        stop: () => {
            running = false;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            opts.extras?.stop();
            const m = mapOf();
            if (m) removeRaster(m, opts.sourceId, opts.layerId);
        },
        restore: (map) => {
            if (!running) return;
            optsRestore(map);
            opts.extras?.start();
        },
        status: () => (running ? (opts.extras?.status() ?? 'On') : 'Off'),
    });

    function optsRestore(map: LiveWxMap): void {
        ensureRasterLayer(
            map,
            opts.sourceId,
            opts.layerId,
            opts.tileUrl(),
            getLayerOpacity(opts.id),
            undefined,
            { minzoom: opts.minzoom, maxzoom: opts.maxzoom },
        );
    }
}

/**
 * Flooded-ground extent only draws at 1:400,000 or finer, which with 96 dpi
 * 256 px tiles is zoom 11+. Asking at 24 dpi makes ArcGIS see each tile as 4x
 * finer, so water shows from zoom 9.
 */
const FLOOD_EXTENT_DPI = 24;
const FLOOD_EXTENT_MINZOOM = 9;
/** Stream reaches are 1 pt lines; 144 dpi draws them 2 px wide. */
const HIGH_FLOW_DPI = 144;
const NWM_MAXZOOM = 14;
/** Analysis runs hourly; the 5-day forecast every 6 hours. */
const NWM_NOW_REFRESH_MS = 15 * 60_000;
const NWM_5DAY_REFRESH_MS = 60 * 60_000;

function nwmTileUrl(service: string, dpi: number, refreshMs: number): string {
    return arcgisExportTileUrl(`${NWM_SERVICES}/${service}/MapServer`, 'map', {
        layers: 'show:0',
        dpi,
        cacheKey: Math.floor(Date.now() / refreshMs),
    });
}

function registerNwmLayers(): void {
    const layers = [
        {
            id: 'flood_now',
            label: 'Flooded Ground (Now)',
            description: 'NWM inundation analysis (experimental; zoom in to see)',
            service: 'ana_inundation_extent',
            dpi: FLOOD_EXTENT_DPI,
            minzoom: FLOOD_EXTENT_MINZOOM,
            refreshMs: NWM_NOW_REFRESH_MS,
        },
        {
            id: 'flood_5day',
            label: 'Flooded Ground (5 Days)',
            description: 'NWM 5-day max inundation forecast (experimental; zoom in to see)',
            service: 'mrf_nbm_5day_max_inundation_extent',
            dpi: FLOOD_EXTENT_DPI,
            minzoom: FLOOD_EXTENT_MINZOOM,
            refreshMs: NWM_5DAY_REFRESH_MS,
        },
        {
            id: 'high_flow_now',
            label: 'Streams Running High (Now)',
            description: 'NWM high flow magnitude analysis (experimental)',
            service: 'ana_high_flow_magnitude',
            dpi: HIGH_FLOW_DPI,
            refreshMs: NWM_NOW_REFRESH_MS,
            highFlow: true,
        },
        {
            id: 'high_flow_5day',
            label: 'Streams Running High (5 Days)',
            description: 'NWM 5-day max high flow forecast (experimental)',
            service: 'mrf_nbm_5day_max_high_flow_magnitude',
            dpi: HIGH_FLOW_DPI,
            refreshMs: NWM_5DAY_REFRESH_MS,
            highFlow: true,
        },
    ] as Array<{
        id: string;
        label: string;
        description: string;
        service: string;
        dpi: number;
        minzoom?: number;
        refreshMs: number;
        highFlow?: boolean;
    }>;
    for (const l of layers) {
        const hf = l.id as HighFlowId;
        registerWmsLayer({
            id: l.id,
            group: 'more',
            label: l.label,
            description: l.description,
            hosts: ['maps.water.noaa.gov'],
            sends: 'Tiles',
            sourceId: `livewx-${l.id}-src`,
            layerId: `livewx-${l.id}-lyr`,
            tileUrl: () => nwmTileUrl(l.service, l.dpi, l.refreshMs),
            opacity: 0.8,
            minzoom: l.minzoom,
            maxzoom: NWM_MAXZOOM,
            refreshMs: l.refreshMs,
            extras: l.highFlow
                ? {
                    start: () => startHighFlowExtras(hf),
                    stop: () => stopHighFlowExtras(hf),
                    status: () => highFlowStatus(hf),
                }
                : undefined,
        });
    }
}

/** Wire built-in layers into the registry. Call once at plugin init. */
export function registerCatalogLayers(): void {
    registerWmsLayer({
        id: 'satellite',
        group: 'radar',
        label: 'Infrared Cloud Tops',
        description: 'GOES CONUS IR',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Tiles',
        sourceId: 'livewx-sat-src',
        layerId: 'livewx-sat-lyr',
        tileUrl: () => iemWmsTileUrl('goes/conus_ir.cgi', 'conus_ir_4km'),
        opacity: 0.75,
    });

    registerRainTotalsLayer();

    registerWmsLayer({
        id: 'wind_field',
        group: 'radar',
        label: 'Water Vapor',
        description: 'GOES CONUS water vapor',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Tiles',
        sourceId: 'livewx-wind-src',
        layerId: 'livewx-wind-lyr',
        tileUrl: () => iemWmsTileUrl('goes/conus_wv.cgi', 'conus_wv_4km'),
        opacity: 0.7,
    });

    registerFireOutlookLayer();

    createGeoLayer({
        id: 'fw_zones',
        group: 'more',
        label: 'Fire Zones',
        description: 'NWS fire weather zones',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Extent query',
        sourceId: 'livewx-fwz-src',
        fillId: 'livewx-fwz-fill',
        lineId: 'livewx-fwz-line',
        fillColor: '#ae3ec9',
        fillOpacity: 0.12,
        lineColor: '#9c36b5',
        titleKeys: ['name', 'ZONE', 'zone', 'STATE', 'state'],
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/static/rest/services/nws_reference_maps/nws_reference_map/MapServer/9/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
    });

    registerWmsLayer({
        id: 'smoke',
        group: 'more',
        label: 'Smoke',
        description: 'NDGD surface smoke',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Tiles',
        sourceId: 'livewx-smoke-src',
        layerId: 'livewx-smoke-lyr',
        tileUrl: () => arcgisExportTileUrl(
            `${MAPSERVICES_NWS}/raster/rest/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer`,
            'image',
        ),
    });

    createGeoLayer({
        id: 'air_quality',
        group: 'more',
        label: 'Air Quality',
        description: 'AirNow AQI',
        hosts: ['services.arcgis.com'],
        sends: 'Extent query',
        sourceId: 'livewx-aqi-src',
        fillId: 'livewx-aqi-fill',
        lineId: 'livewx-aqi-line',
        fillColor: '#74b816',
        titleKeys: ['gridcode', 'AQI', 'aqi', 'category', 'parameter'],
        url: () => extentUrl(
            arcgisQueryUrl(
                'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/AirNowLatestContoursCombined/FeatureServer/0',
                { resultRecordCount: '500' },
            ),
        ),
    });

    createGeoLayer({
        id: 'flash_flood',
        group: 'more',
        label: 'Flash Flood',
        description: 'WPC excessive rainfall Day 1',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Extent query',
        sourceId: 'livewx-ero-src',
        fillId: 'livewx-ero-fill',
        lineId: 'livewx-ero-line',
        fillColor: '#2f9e44',
        titleKeys: ['outlook', 'OUTLOOK', 'risk', 'RISK', 'label', 'LABEL'],
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/hazards/wpc_precip_hazards/MapServer/0/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
    });

    createGeoLayer({
        id: 'river_gauges',
        group: 'more',
        label: 'River Gauges',
        description: 'AHPS river stages',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Extent query',
        sourceId: 'livewx-riv-src',
        circleId: 'livewx-riv-circle',
        circleColor: '#1c7ed6',
        circleRadius: 11,
        icon: RIPPLE_ICON,
        titleKeys: ['gaugelid', 'location', 'waterbody', 'name'],
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/eventdriven/rest/services/water/riv_gauges/MapServer/0/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=500`,
        ),
    });

    registerNwmLayers();
    registerRainGaugesLayer();
    registerFuelMoistureLayer();
    registerSpotRequestsLayer();

    createGeoLayer({
        id: 'buoys',
        group: 'more',
        label: 'Buoys',
        description: 'NDBC buoys',
        hosts: ['www.ndbc.noaa.gov'],
        sends: 'Station list',
        sourceId: 'livewx-buoy-src',
        circleId: 'livewx-buoy-circle',
        circleColor: '#0ca678',
        titleKeys: ['name', 'id', 'owner'],
        url: () => 'https://www.ndbc.noaa.gov/ndbcmapstations.json',
        parse: (raw) => {
            const st = (raw as { station?: Array<Record<string, string>> }).station ?? [];
            return {
                type: 'FeatureCollection',
                features: st.filter((s) => s.lat && s.lon).map((s, i) => ({
                    type: 'Feature' as const,
                    id: s.id || i,
                    geometry: {
                        type: 'Point' as const,
                        coordinates: [Number(s.lon), Number(s.lat)],
                    },
                    properties: s,
                })),
            };
        },
    });

    createGeoLayer({
        id: 'avalanche',
        group: 'more',
        label: 'Avalanche',
        description: 'Avalanche zones',
        hosts: ['api.avalanche.org'],
        sends: 'Map layer',
        sourceId: 'livewx-avy-src',
        fillId: 'livewx-avy-fill',
        lineId: 'livewx-avy-line',
        fillColor: '#7048e8',
        titleKeys: ['center', 'name', 'danger', 'published_time_display'],
        url: () => 'https://api.avalanche.org/v2/public/products/map-layer',
    });

    registerWmsLayer({
        id: 'snow_depth',
        group: 'more',
        label: 'Snow Depth',
        description: 'NOHRSC snow',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Tiles',
        sourceId: 'livewx-snowd-src',
        layerId: 'livewx-snowd-lyr',
        tileUrl: () => arcgisExportTileUrl(
            `${MAPSERVICES_NWS}/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer`,
        ),
    });

    createGeoLayer({
        id: 'earthquakes',
        group: 'more',
        label: 'Earthquakes',
        description: 'USGS M2.5+ week',
        hosts: ['earthquake.usgs.gov'],
        sends: 'Feed',
        sourceId: 'livewx-eq-src',
        circleId: 'livewx-eq-circle',
        circleColor: '#e64980',
        circleRadius: 6,
        titleKeys: ['mag', 'place', 'title'],
        url: () => 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
    });

    registerMetarLayer();

    registerLayer({
        id: 'radar_sites',
        group: 'radar',
        label: 'Radar Sites',
        description: 'Site markers',
        hosts: [],
        sends: 'Local',
        start: async () => {
            const { setSitesOnMap } = await import('../core/state.ts');
            setSitesOnMap(true);
            const { applySiteMarkers } = await import('../radar/radar.ts');
            applySiteMarkers();
        },
        stop: async () => {
            const { setSitesOnMap } = await import('../core/state.ts');
            setSitesOnMap(false);
            const { applySiteMarkers } = await import('../radar/radar.ts');
            applySiteMarkers();
        },
        restore: () => { /* site-markers module */ },
        status: () => (state.sitesOnMap ? 'On' : 'Off'),
    });
}
