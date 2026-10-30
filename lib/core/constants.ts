export const ROUTE_NAME = 'home-menu-plugin-livewx-radar';
export const MENU_KEY = 'livewx-radar';

export const RADAR_SOURCE_ID = 'livewx-radar-source';
export const RADAR_LAYER_ID = 'livewx-radar-layer';
export const ALERT_SOURCE_ID = 'livewx-alerts-source';
export const ALERT_FILL_ID = 'livewx-alerts-fill';
export const ALERT_LINE_ID = 'livewx-alerts-line';
export const SITES_SOURCE_ID = 'livewx-sites-source';
export const SITES_CIRCLE_ID = 'livewx-sites-circle';
export const SITES_LABEL_ID = 'livewx-sites-label';
export const SITES_RANGE_SOURCE_ID = 'livewx-sites-range-source';
export const SITES_RANGE_FILL_ID = 'livewx-sites-range-fill';
export const SITES_RANGE_LINE_ID = 'livewx-sites-range-line';
export const LIGHTNING_SOURCE_ID = 'livewx-lightning-strikes';
export const LIGHTNING_LAYER_ID = 'livewx-lightning-strikes-icon';
export const LIGHTNING_ICON_ID = 'livewx-lightning-bolt';
export const LIGHTNING_LEGACY_CIRCLE_ID = 'livewx-lightning-strikes-circle';
export const LIGHTNING_DENSITY_SOURCE_ID = 'livewx-lightning-density-source';
export const LIGHTNING_DENSITY_LAYER_ID = 'livewx-lightning-density-layer';

export const CONUS_SITE_ID = 'CONUS';
export const IEM_TMS_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
export const IEM_JSON_BASE = 'https://mesonet.agron.iastate.edu/json';
export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
export const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
/** Environment Canada GeoMet WMS (Canada radar mosaic). */
export const CANADA_GEOMET = 'https://geo.weather.gc.ca/geomet';
export const NOWCOAST_WMS = 'https://nowcoast.noaa.gov/geoserver/weather_radar/wms';
export const MAPSERVICES_NWS = 'https://mapservices.weather.noaa.gov';
/** RainViewer tiles return a "zoom not supported" plate above this. */
export const RAINVIEWER_MAXZOOM = 7;
/** GeoMet radar is ~1 km; overzoom beyond this. */
export const CANADA_MAXZOOM = 10;
/** NOAA National Water Model map services (experimental, lower 48). */
export const NWM_SERVICES = 'https://maps.water.noaa.gov/server/rest/services/nwm';

export const STORAGE_KEY = 'livewx-radar-settings';
export const REFRESH_MS = 60_000;
export const ALERT_POLL_MS = 60_000;
export const PROTOCOL_NAME = 'livewx';

export const DEFAULT_OPACITY = 0.7;
export const DEFAULT_FILTER = 0;
export const DEFAULT_LIGHTNING_STALE_SEC = 120;

/** IEM mosaic tiles get mushy past this; MapLibre overzooms instead of fetching empty high-z tiles. */
export const MOSAIC_MAXZOOM = 8;
/** Single-site RIDGE has more native detail. */
export const RIDGE_MAXZOOM = 10;

/** Standard 0.5° base reflectivity coverage (124 nmi). */
export const WSR88D_RANGE_KM = 230;
/** TDWR reflectivity / Doppler range (48 nmi). */
export const TDWR_RANGE_KM = 90;

/** Same-origin path for Blitzortung relay (CloudTAK server plugin). */
export const BLITZ_RELAY_PATH = '/api/livewx/lightning';

/** In-plugin views: master home + detail screens with Back. */
export type AppPageId = 'home' | 'forecast' | 'radar' | 'spot';
