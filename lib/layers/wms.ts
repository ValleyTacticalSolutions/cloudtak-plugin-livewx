/**
 * Helpers for NOAA/nowCOAST WMS and ArcGIS export raster overlays in MapLibre.
 * Tile URLs go through the same-origin proxy so CORS does not block painting.
 */
import { PROXY_PATH, viaProxy } from '../core/egress.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { firstSymbolLayer } from '../core/map-host.ts';
import { removeLayerSafe, removeSourceSafe } from './registry.ts';

/** Root nowCOAST WMS (workspace:layer names from GetCapabilities). */
export const NOWCOAST_OWS = 'https://nowcoast.noaa.gov/geoserver/ows';

/**
 * Build a WMS GetMap tile template.
 * Query values are left with literal `/` and `:` so viaProxy encodeURIComponent
 * applies a single encode pass (URLSearchParams would double-encode).
 */
export function wmsTileUrl(base: string, layers: string, extra: Record<string, string> = {}): string {
    // Do not pre-encode query values — viaProxy() encodeURIComponent's the whole URL once.
    const parts = [
        'SERVICE=WMS',
        'VERSION=1.1.1',
        'REQUEST=GetMap',
        `LAYERS=${layers}`,
        'STYLES=',
        'FORMAT=image/png',
        'TRANSPARENT=true',
        'SRS=EPSG:3857',
        'WIDTH=256',
        'HEIGHT=256',
        'BBOX={bbox-epsg-3857}',
    ];
    for (const [k, v] of Object.entries(extra)) {
        parts.push(`${k}=${v}`);
    }
    return viaProxy(`${base}?${parts.join('&')}`);
}

/** Convenience: nowCOAST OWS with a workspace:layer name. */
export function nowcoastTileUrl(layer: string): string {
    return wmsTileUrl(NOWCOAST_OWS, layer);
}

export type ArcgisExportOpts = {
    /** MapServer layer filter, e.g. `show:0`. */
    layers?: string;
    /** ImageServer raster function name (from rasterFunctionInfos). */
    rasterFunction?: string;
    /**
     * Render DPI (ArcGIS default 96). ArcGIS derives map scale from it, so a
     * lower value draws scale-limited layers at coarser zooms.
     */
    dpi?: number;
    /** Ignored by ArcGIS; changing it makes MapLibre and the browser fetch fresh tiles. */
    cacheKey?: string | number;
};

/**
 * ArcGIS MapServer/export or ImageServer/exportImage tile template.
 * `serviceUrl` should end at MapServer or ImageServer (no /export).
 * Always uses png32 so no-data stays transparent (png fills black).
 */
export function arcgisExportTileUrl(
    serviceUrl: string,
    kind: 'map' | 'image' = 'map',
    opts: ArcgisExportOpts = {},
): string {
    const base = serviceUrl.replace(/\/$/, '');
    const path = kind === 'image' ? 'exportImage' : 'export';
    const parts = [
        'bbox={bbox-epsg-3857}',
        'bboxSR=3857',
        'imageSR=3857',
        'size=256,256',
        'format=png32',
        'transparent=true',
        'f=image',
    ];
    if (opts.layers) parts.push(`layers=${opts.layers}`);
    if (opts.rasterFunction) {
        // Literal JSON — viaProxy applies a single encodeURIComponent pass.
        parts.push(`renderingRule={"rasterFunction":"${opts.rasterFunction}"}`);
    }
    if (opts.dpi) parts.push(`dpi=${opts.dpi}`);
    if (opts.cacheKey != null) parts.push(`_=${opts.cacheKey}`);
    return viaProxy(`${base}/${path}?${parts.join('&')}`);
}

/** Iowa Environmental Mesonet CGI WMS (EPSG:3857 GetMap). */
export function iemWmsTileUrl(cgiPath: string, layers: string): string {
    const path = cgiPath.replace(/^\//, '');
    return wmsTileUrl(`https://mesonet.agron.iastate.edu/cgi-bin/wms/${path}`, layers);
}

export function ensureRasterLayer(
    map: LiveWxMap,
    sourceId: string,
    layerId: string,
    tileUrl: string,
    opacity = 0.7,
    beforeId?: string,
    zoom: { minzoom?: number; maxzoom?: number } = {},
): void {
    const tiles = tileUrl.startsWith('/') || tileUrl.includes(PROXY_PATH)
        ? [tileUrl]
        : [viaProxy(tileUrl)];
    const source = map.getSource(sourceId) as { setTiles?: (t: string[]) => void } | undefined;
    if (source?.setTiles && map.getLayer(layerId)) {
        source.setTiles(tiles);
        map.setPaintProperty?.(layerId, 'raster-opacity', opacity);
        return;
    }
    removeLayerSafe(map, layerId);
    removeSourceSafe(map, sourceId);
    map.addSource(sourceId, {
        type: 'raster',
        tiles,
        tileSize: 256,
        // Below minzoom MapLibre requests and draws nothing.
        ...(zoom.minzoom != null ? { minzoom: zoom.minzoom } : {}),
        maxzoom: zoom.maxzoom ?? 12,
    });
    map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
            'raster-opacity': opacity,
            'raster-fade-duration': 0,
        },
    }, beforeId ?? firstSymbolLayer(map));
}

export function removeRaster(map: LiveWxMap, sourceId: string, layerId: string): void {
    removeLayerSafe(map, layerId);
    removeSourceSafe(map, sourceId);
}
