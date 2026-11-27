# LiveWX

CloudTAK weather plugin with Atmosphere-class features: point forecast, grouped map layers (fire, hydro, marine, storms, snow), IEM/RainViewer radar, nationwide NWS watches & warnings, and NOAA lightning density. It needs no server route and no API rebuild.

**Minimum CloudTAK: v14.4.1**. Built and verified against CloudTAK v14.4.1 (commit 184ecb2, 2026-11-27). There is no upper limit, and newer CloudTAK versions are expected to work. Please report breakage as an issue. Independent clean-room implementation (not a fork of the Atmosphere ATAK plugin).

## What it does

### Forecast

- Point modes: my position, map center, pick on map, named favorites
- Units: US / metric / aviation (display convert, no refetch)
- Pluggable JSON sources (`data/wx_sources/`) — bundled **NWS grid** and **Open-Meteo**
- Fire-relevant fields when the provider sends them (20-ft wind, mixing height, transport wind, WBGT)
- Area Forecast Discussion (AFD) when using NWS
- Stale-while-revalidate with age badge

### Radar (kept + upgraded)

- Overlay off on first install; settings persist in `localStorage`
- CONUS mosaic / single-site RIDGE via Iowa Mesonet
- Optional **Auto** provider: RainViewer world composite outside NWS coverage
- Opacity, min-value filter, last-hour replay, radar age control, site markers

### Alerts & lightning density

- **Watches & warnings** from `api.weather.gov` (nationwide) — unchanged from prior LiveWX
- **Lightning density (NOAA)** — GOES GLM WMS, Atmosphere-style delayed density

### Spot Forecasts

- **Read-only** list of current NWS Spot Forecast requests (the [Spot Forecast Monitor](https://spot.weather.gov/) list, via NOAA map services) — this office (from the forecast point), within a radius, or all offices; incident and hide-complete filters
- Each request opens its official forecast page in a small window; **Zoom** flies the map to it
- **Request a Spot Forecast** opens the official NWS request form in its own window — requests are submitted there, not from CloudTAK
- Optional **Spot Forecasts** map layer (More) with a popup card linking to the forecast

### Layer catalog

Foldable groups with consent dialogs, map keys, and status lines:

Spot & stations · Wind · Storms · Fire · Rain & rivers · Ocean · Snow · Ground · Alerts

Includes fire weather outlook/zones, stations, smoke/AQI/PSPS/ERC, flash flood outlook, river gauges, NWM flooded ground and streams running high (now and 5-day), rain totals, debris flow, buoys, SST, hurricanes, storm reports, tornado paths, avalanche, snow depth, earthquakes, spot forecasts, satellite/wind/rain pictures (WMS stand-ins for NOMADS GRIB).

### Pages

Forecast · Layers · Radar · Spot · Fire Weather Zones · SAWTI · Fire Danger · Weather Stations · River Gauges · Buoys · Storm Reports · Rain Gauges

## Install

LiveWX is a plugin only: no server route and no CloudTAK rebuild. It reaches weather services through CloudTAK's own proxy.

**One-time admin setup** (CloudTAK admin settings): turn on the **plugin proxy** (`proxy::enabled`) and add these origins to the proxy whitelist (`proxy::whitelist`). Map tiles go through the image proxy and need no whitelist, but the origins below also serve data:

```
https://api.weather.gov
https://api.open-meteo.com
https://mesonet.agron.iastate.edu
https://mapservices.weather.noaa.gov
https://opengeo.ncep.noaa.gov
https://geo.weather.gc.ca
https://api.rainviewer.com
https://tilecache.rainviewer.com
https://nowcoast.noaa.gov
https://nomads.ncep.noaa.gov
https://maps.water.noaa.gov
https://api.water.noaa.gov
https://www.ndbc.noaa.gov
https://api.tidesandcurrents.noaa.gov
https://www.nhc.noaa.gov
https://api.avalanche.org
https://wcc.sc.egov.usda.gov
https://services.arcgis.com
https://services3.arcgis.com
https://geocoding.geo.census.gov
https://fsapps.nwcg.gov
https://www.nfmdb.org
https://data.cocorahs.org
https://waterservices.usgs.gov
https://waterdata.usgs.gov
https://earthquake.usgs.gov
https://services.dat.noaa.gov
https://gacc.nifc.gov
https://radar.weather.gov
https://aviationweather.gov
```

Then install the plugin from the TAK Portal marketplace, or load the runtime bundle (see Mobile). Each request uses the signed-in user's CloudTAK session.

Limits of CloudTAK's proxy: responses are capped at 1 MB and requests time out after 15 s, so a very large layer or area can fail to load. The image proxy puts the session token in the tile URL, which can appear in access logs.

**Not included:** live Blitzortung lightning strikes. They need a websocket relay, and CloudTAK's proxy is HTTP only. Lightning *density* (NOAA GOES GLM tiles) still works.

### Manual install into a CloudTAK checkout (optional)

```bash
git clone https://github.com/ValleyTacticalSolutions/cloudtak-plugin-livewx.git
cd cloudtak-plugin-livewx
./install.sh
```

Copies into `app/plugins/livewx-radar/` and rebuilds the API image (the compiled install). It also removes the old `plugin-livewx.ts` server route from earlier versions. Afterward: **Settings → Refresh App**. `./install.sh --remove` uninstalls.

### Local development

Symlink this checkout to `CloudTAK/app/plugins/livewx-radar`, run `npm install` here, and restart `npm run serve` in `app`.

## Mobile (CloudTAK iOS/Android app)

The mobile bundle needs **CloudTAK v14.4.1 or newer** (runtime plugins, the same minimum as the compiled Marketplace install).

The native apps only run runtime bundles, not plugins compiled into the web build. The bundle needs no server route, but the one-time proxy setup under Install is required.

1. Build: `npm install && npm run bundle` creates `release/livewx-<version>.tar.gz` (`manifest.json` + `index.js`).
2. Upload (CloudTAK admin): `POST /api/plugin/bundle` with the tar.gz.
3. On the phone: **Settings → Plugins**, then load LiveWX.

The bundle contains everything except `vue`, `vue-router` and `@tak-ps/vue-tabler`, which the app provides. All requests go to the CloudTAK server with the session token, and links open in the system browser. Detail cards close by tapping them. In the bundle the radar minimum-value filter is off (it needs a map protocol the host map cannot share); radar tiles are otherwise unchanged.

## Core imports

The plugin imports nothing from CloudTAK's `src/`. It reads the host Pinia store, server URL and token through `lib/core/host.ts`.

## Development

`bash verify-cloudtak.sh . livewx-radar` builds the plugin inside the latest CloudTAK `main` (ESLint, `vue-tsc`, Vite build, API oxlint and `tsc`).

## Accepted deltas vs ATAK Atmosphere

- Wind / smoke / model rain / waves use **WMS/TMS pictures**, not on-device GRIB particle fields
- General NWS WWA are **kept** (Atmosphere omits them for a companion IPAWS plugin)
- No CoT publish for weather features

## License

AGPL-3.0-or-later. See `LICENSE`. Third-party material keeps its own license, as noted under Attribution.

## Attribution

- Radar: [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/) (US NEXRAD), [Environment Canada GeoMet](https://geo.weather.gc.ca/) (Canada), [RainViewer](https://www.rainviewer.com/) (global)
- Forecast / alerts / many layers: [NWS API](https://www.weather.gov/documentation/services-web-api) and NOAA map services
- Open-Meteo: [open-meteo.com](https://open-meteo.com/) (CC BY 4.0)
- Spot forecasts: [NOAA SPOT Forecast Monitor map service](https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/nws_fire_weather_spot/MapServer) (read-only, public, ~15 min updates); forecasts and requests open on [spot.weather.gov](https://spot.weather.gov/)
- Lightning density: NOAA GOES GLM. Earlier versions showed Blitzortung strikes; that display was adapted from [cmlaird/CloudTAK-Plugin-Lightning](https://github.com/cmlaird/CloudTAK-Plugin-Lightning) (MIT)
- Site list / product taxonomy adapted from [Supercell Wx](https://github.com/dpaulat/supercell-wx) (MIT)
- Feature parity inspired by [takwerx/atmosphere](https://github.com/takwerx/atmosphere) (independent reimplementation)
