# LiveWX

CloudTAK weather plugin with Atmosphere-class features: point forecast, grouped map layers (fire, hydro, marine, storms, snow), IEM/RainViewer radar, nationwide NWS watches & warnings, and live lightning via a CloudTAK relay.

Requires CloudTAK **13.102** or newer. Apache-2.0 clean-room implementation (not a fork of the AGPL Atmosphere ATAK plugin).

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

### Alerts & lightning

- **Watches & warnings** from `api.weather.gov` (nationwide) — unchanged from prior LiveWX
- **Live lightning (Blitzortung)** via CloudTAK **server relay** (clients never open Blitzortung sockets)
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

## Blitzortung usage

[Blitzortung.org](https://www.blitzortung.org/en/contact.php) requires external apps to:

- Retrieve data from a **separate server** (not Blitzortung’s hosts) — this plugin uses `/api/livewx/lightning`
- Stay **non-commercial**, freely accessible, clearly attributed (**CC BY-SA 4.0**)
- Not use data for storm warning / life-safety systems
- Prevent misuse where practical

The UI shows attribution and a non-warning disclaimer whenever live lightning is on. Install the server route with `install.sh` so the relay is present. Do not point browsers at `wss://ws*.blitzortung.org`.

## Install

```bash
git clone https://github.com/ValleyTacticalSolutions/cloudtak-plugin-livewx.git
cd cloudtak-plugin-livewx
./install.sh
```

Copies into `app/plugins/livewx-radar/` and `api/stateless/routes/plugin-livewx.ts`, then rebuilds the API image. Afterward: **Settings → Refresh App**.

If the whole CloudTAK UI starts returning **502** (basemap, Atlas sync, other plugins), the API container failed to boot — often from a bad `api/stateless/routes/plugin-livewx.ts`. Remove that file, rebuild/restart the API, then reinstall with a fixed copy:

```bash
rm -f "$CLOUDTAK/api/stateless/routes/plugin-livewx.ts"
cd "$CLOUDTAK" && docker compose build --no-cache api && docker compose up -d --force-recreate api
# then from this repo:
./install.sh --no-pull
```

```bash
./install.sh --remove
```

### Local development

Symlink this checkout to `CloudTAK/app/plugins/livewx-radar`, copy or symlink `server/plugin-livewx.ts` into `api/stateless/routes/`, run `npm install` here (with `@tak-ps/cloudtak` pointing at your CloudTAK `app` package), and restart `npm run serve` in `app`.

### CSP / network

- Browser `connect-src` must allow same-origin `/api/livewx/*` (already `'self'` on typical CloudTAK nginx).
- Weather hosts are contacted from the browser when CORS allows; otherwise use `/api/livewx/proxy?url=…` (allowlisted hosts only).
- You no longer need Blitzortung hosts in CSP.

## Accepted deltas vs ATAK Atmosphere

- Wind / smoke / model rain / waves use **WMS/TMS pictures**, not on-device GRIB particle fields
- General NWS WWA are **kept** (Atmosphere omits them for a companion IPAWS plugin)
- No CoT publish for weather features

## Attribution

- Radar: [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/) (US NEXRAD), [Environment Canada GeoMet](https://geo.weather.gc.ca/) (Canada), [RainViewer](https://www.rainviewer.com/) (global)
- Forecast / alerts / many layers: [NWS API](https://www.weather.gov/documentation/services-web-api) and NOAA map services
- Open-Meteo: [open-meteo.com](https://open-meteo.com/) (CC BY 4.0)
- Spot forecasts: [NOAA SPOT Forecast Monitor map service](https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/nws_fire_weather_spot/MapServer) (read-only, public, ~15 min updates); forecasts and requests open on [spot.weather.gov](https://spot.weather.gov/)
- Lightning: [Blitzortung.org](https://www.blitzortung.org/) & contributors (CC BY-SA 4.0); display adapted from [cmlaird/CloudTAK-Plugin-Lightning](https://github.com/cmlaird/CloudTAK-Plugin-Lightning) (MIT)
- Site list / product taxonomy adapted from [Supercell Wx](https://github.com/dpaulat/supercell-wx) (MIT)
- Feature parity inspired by [takwerx/atmosphere](https://github.com/takwerx/atmosphere) (independent reimplementation)
