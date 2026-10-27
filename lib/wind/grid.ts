/**
 * Wind U/V grid over the map view via Open-Meteo (JSON stand-in for Atmosphere's NOMADS GRIB).
 * Samples sit on a fixed world lat/lon lattice so pan/zoom does not invent a new wind field.
 */
import { fetchJson } from '../core/egress.ts';
import { mapOf } from '../core/map-host.ts';

export type WindSample = { u: number; v: number; speed: number };

export type WindGrid = {
    west: number;
    east: number;
    south: number;
    north: number;
    /** Lattice spacing in degrees (snapped world grid). */
    step: number;
    nx: number;
    ny: number;
    u: Float32Array;
    v: Float32Array;
    fetchedAt: number;
    model: string;
};

type OmPoint = {
    latitude?: number;
    longitude?: number;
    current?: {
        wind_speed_10m?: number;
        wind_direction_10m?: number;
    };
};

type WindMesh = {
    lats: number[];
    lons: number[];
    nx: number;
    ny: number;
    step: number;
    west: number;
    east: number;
    south: number;
    north: number;
};

/** Cap multi-location current queries (Open-Meteo allows up to 1000). */
const MAX_POINTS = 64;

/** Power-of-2 nested lattice steps so parent cells coincide across zoom levels. */
const STEPS = [0.25, 0.5, 1, 2, 4, 8] as const;

const LON_MIN = -180;
const LON_MAX = 180;
const LAT_MIN = -90;
const LAT_MAX = 90;

/** Meteorological "from" degrees → eastward (u) / northward (v) m/s. */
export function uvFromSpeedDir(speedMs: number, fromDeg: number): { u: number; v: number } {
    const rad = (fromDeg * Math.PI) / 180;
    return {
        u: -speedMs * Math.sin(rad),
        v: -speedMs * Math.cos(rad),
    };
}

export function sampleGrid(g: WindGrid, lon: number, lat: number): WindSample | null {
    if (lon < g.west || lon > g.east || lat < g.south || lat > g.north) return null;
    const dx = g.east - g.west;
    const dy = g.north - g.south;
    if (!(dx > 0) || !(dy > 0) || g.nx < 1 || g.ny < 1) return null;
    const x = ((lon - g.west) / dx) * Math.max(1, g.nx - 1);
    const y = ((lat - g.south) / dy) * Math.max(1, g.ny - 1);
    const x0 = Math.max(0, Math.min(g.nx - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(g.ny - 1, Math.floor(y)));
    const x1 = Math.min(g.nx - 1, x0 + 1);
    const y1 = Math.min(g.ny - 1, y0 + 1);
    const tx = g.nx === 1 ? 0 : x - x0;
    const ty = g.ny === 1 ? 0 : y - y0;
    const i00 = y0 * g.nx + x0;
    const i10 = y0 * g.nx + x1;
    const i01 = y1 * g.nx + x0;
    const i11 = y1 * g.nx + x1;
    const u = bil(g.u[i00], g.u[i10], g.u[i01], g.u[i11], tx, ty);
    const v = bil(g.v[i00], g.v[i10], g.v[i01], g.v[i11], tx, ty);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    return { u, v, speed: Math.hypot(u, v) };
}

function bil(a: number, b: number, c: number, d: number, tx: number, ty: number): number {
    const w00 = Number.isFinite(a) ? (1 - tx) * (1 - ty) : 0;
    const w10 = Number.isFinite(b) ? tx * (1 - ty) : 0;
    const w01 = Number.isFinite(c) ? (1 - tx) * ty : 0;
    const w11 = Number.isFinite(d) ? tx * ty : 0;
    const w = w00 + w10 + w01 + w11;
    if (!(w > 0)) return Number.NaN;
    return ((Number.isFinite(a) ? a * w00 : 0)
        + (Number.isFinite(b) ? b * w10 : 0)
        + (Number.isFinite(c) ? c * w01 : 0)
        + (Number.isFinite(d) ? d * w11 : 0)) / w;
}

/** Only fill gaps from nearby lattice neighbors (not across the whole view). */
function fillNaNs(u: Float32Array, v: Float32Array, nx: number): number {
    let valid = 0;
    for (let i = 0; i < u.length; i++) {
        if (Number.isFinite(u[i]) && Number.isFinite(v[i])) valid++;
    }
    if (!valid) return 0;
    const maxDist2 = 2 * 2; // ≤2 lattice steps
    for (let i = 0; i < u.length; i++) {
        if (Number.isFinite(u[i]) && Number.isFinite(v[i])) continue;
        const x0 = i % nx;
        const y0 = Math.floor(i / nx);
        let best = -1;
        let bestD = Number.POSITIVE_INFINITY;
        for (let j = 0; j < u.length; j++) {
            if (!Number.isFinite(u[j]) || !Number.isFinite(v[j])) continue;
            const x1 = j % nx;
            const y1 = Math.floor(j / nx);
            const d = (x1 - x0) ** 2 + (y1 - y0) ** 2;
            if (d < bestD && d <= maxDist2) {
                bestD = d;
                best = j;
            }
        }
        if (best >= 0) {
            u[i] = u[best];
            v[i] = v[best];
            valid++;
        }
    }
    return valid;
}

function readBounds(b: {
    getWest?: () => number;
    getEast?: () => number;
    getSouth?: () => number;
    getNorth?: () => number;
    _sw?: { lng: number; lat: number };
    _ne?: { lng: number; lat: number };
}): { west: number; east: number; south: number; north: number } | null {
    let west: number | undefined;
    let east: number | undefined;
    let south: number | undefined;
    let north: number | undefined;
    try {
        west = typeof b.getWest === 'function' ? b.getWest() : b._sw?.lng;
        east = typeof b.getEast === 'function' ? b.getEast() : b._ne?.lng;
        south = typeof b.getSouth === 'function' ? b.getSouth() : b._sw?.lat;
        north = typeof b.getNorth === 'function' ? b.getNorth() : b._ne?.lat;
    } catch {
        return null;
    }
    if ([west, east, south, north].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        return null;
    }
    if (!((east as number) > (west as number)) || !((north as number) > (south as number))) {
        return null;
    }
    return {
        west: west as number,
        east: east as number,
        south: south as number,
        north: north as number,
    };
}

export function viewBounds(): { west: number; east: number; south: number; north: number } | null {
    const b = mapOf()?.getBounds?.();
    if (!b) return null;
    const raw = readBounds(b);
    if (!raw) return null;
    let { west, east, south, north } = raw;
    const padLon = Math.min(2, (east - west) * 0.08);
    const padLat = Math.min(1.5, (north - south) * 0.08);
    west = Math.max(LON_MIN, west - padLon);
    east = Math.min(LON_MAX, east + padLon);
    south = Math.max(-85, south - padLat);
    north = Math.min(85, north + padLat);
    if (!(east > west) || !(north > south)) return null;
    return { west, east, south, north };
}

function snapDown(v: number, step: number): number {
    return Math.floor(v / step + 1e-9) * step;
}

function snapUp(v: number, step: number): number {
    return Math.ceil(v / step - 1e-9) * step;
}

function clampLon(lon: number): number {
    return Math.max(LON_MIN, Math.min(LON_MAX, lon));
}

function clampLat(lat: number): number {
    return Math.max(LAT_MIN, Math.min(LAT_MAX, lat));
}

function roundCoord(n: number): number {
    return Math.round(n * 1000) / 1000;
}

function isValidSample(lat: number, lon: number): boolean {
    return Number.isFinite(lat)
        && Number.isFinite(lon)
        && lat >= LAT_MIN
        && lat <= LAT_MAX
        && lon >= LON_MIN
        && lon <= LON_MAX;
}

/** Smallest nested lattice step that covers the view with ≤ maxPoints. */
export function chooseStep(
    west: number,
    south: number,
    east: number,
    north: number,
    maxPoints = MAX_POINTS,
): number {
    for (const step of STEPS) {
        const x0 = Math.max(LON_MIN, snapDown(west, step));
        const y0 = Math.max(LAT_MIN, snapDown(south, step));
        const x1 = Math.min(LON_MAX, snapUp(east, step));
        const y1 = Math.min(LAT_MAX, snapUp(north, step));
        const nx = Math.max(1, Math.round((x1 - x0) / step) + 1);
        const ny = Math.max(1, Math.round((y1 - y0) / step) + 1);
        if (nx * ny <= maxPoints) return step;
    }
    return STEPS[STEPS.length - 1];
}

/** Even spacing inside the view bbox — used when a nested lattice cannot fit the point cap. */
function evenSpacingMesh(
    west: number,
    south: number,
    east: number,
    north: number,
    maxPoints: number,
): WindMesh {
    const spanLon = Math.max(0.05, east - west);
    const spanLat = Math.max(0.05, north - south);
    const aspect = spanLon / spanLat;
    let nx = Math.max(2, Math.round(Math.sqrt(maxPoints * aspect)));
    let ny = Math.max(2, Math.floor(maxPoints / nx));
    while (nx * ny > maxPoints && nx > 2) nx--;
    while (nx * ny > maxPoints && ny > 2) ny--;
    const dLon = spanLon / Math.max(1, nx - 1);
    const dLat = spanLat / Math.max(1, ny - 1);
    const step = Math.max(dLon, dLat);
    const lats: number[] = [];
    const lons: number[] = [];
    const seen = new Set<string>();
    for (let j = 0; j < ny; j++) {
        const lat = clampLat(roundCoord(south + dLat * j));
        for (let i = 0; i < nx; i++) {
            const lon = clampLon(roundCoord(west + dLon * i));
            const key = `${lat},${lon}`;
            if (seen.has(key)) continue;
            seen.add(key);
            lats.push(lat);
            lons.push(lon);
        }
    }
    // Rebuild as a dense row-major grid if clamp collapsed duplicates (rare at edges).
    if (lats.length !== nx * ny) {
        const uniqLons = [...new Set(lons)].sort((a, b) => a - b);
        const uniqLats = [...new Set(lats)].sort((a, b) => a - b);
        nx = uniqLons.length;
        ny = uniqLats.length;
        lats.length = 0;
        lons.length = 0;
        for (const lat of uniqLats) {
            for (const lon of uniqLons) {
                lats.push(lat);
                lons.push(lon);
            }
        }
    }
    return {
        lats,
        lons,
        nx,
        ny,
        step,
        west: lons.length ? Math.min(...lons) : west,
        east: lons.length ? Math.max(...lons) : east,
        south: lats.length ? Math.min(...lats) : south,
        north: lats.length ? Math.max(...lats) : north,
    };
}

/**
 * Build a mesh on a world-aligned lattice so the same geographic cell is reused
 * across pan/zoom instead of shifting with the viewport corner.
 * Always spans the full view — never truncates to the west/south when over budget.
 */
export function buildMesh(
    west: number,
    south: number,
    east: number,
    north: number,
    maxPoints = MAX_POINTS,
): WindMesh {
    let step = chooseStep(west, south, east, north, maxPoints);
    let x0 = Math.max(LON_MIN, snapDown(west, step));
    let y0 = Math.max(LAT_MIN, snapDown(south, step));
    let x1 = Math.min(LON_MAX, snapUp(east, step));
    let y1 = Math.min(LAT_MAX, snapUp(north, step));
    let nx = Math.max(1, Math.round((x1 - x0) / step) + 1);
    let ny = Math.max(1, Math.round((y1 - y0) / step) + 1);

    // Grow through nested STEPS only; never invent non-nesting coarse steps.
    let guard = 0;
    while (nx * ny > maxPoints && guard < STEPS.length) {
        guard++;
        const idx = STEPS.indexOf(step as typeof STEPS[number]);
        if (idx < 0 || idx >= STEPS.length - 1) break;
        step = STEPS[idx + 1];
        x0 = Math.max(LON_MIN, snapDown(west, step));
        y0 = Math.max(LAT_MIN, snapDown(south, step));
        x1 = Math.min(LON_MAX, snapUp(east, step));
        y1 = Math.min(LAT_MAX, snapUp(north, step));
        nx = Math.max(1, Math.round((x1 - x0) / step) + 1);
        ny = Math.max(1, Math.round((y1 - y0) / step) + 1);
    }

    // Wide views (hemisphere / world): even spacing inside the clamped bbox.
    if (nx * ny > maxPoints || !(x1 > x0) || !(y1 > y0)) {
        return evenSpacingMesh(west, south, east, north, maxPoints);
    }

    const lats: number[] = [];
    const lons: number[] = [];
    for (let j = 0; j < ny; j++) {
        const lat = clampLat(roundCoord(y0 + step * j));
        for (let i = 0; i < nx; i++) {
            const lon = clampLon(roundCoord(x0 + step * i));
            lats.push(lat);
            lons.push(lon);
        }
    }
    return {
        lats,
        lons,
        nx,
        ny,
        step,
        west: clampLon(x0),
        east: clampLon(x0 + step * Math.max(0, nx - 1)),
        south: clampLat(y0),
        north: clampLat(y0 + step * Math.max(0, ny - 1)),
    };
}

export function boundsKey(b: {
    west: number;
    east: number;
    south: number;
    north: number;
    step?: number;
}): string {
    const step = b.step ?? chooseStep(b.west, b.south, b.east, b.north);
    const mesh = buildMesh(b.west, b.south, b.east, b.north);
    return [
        mesh.west.toFixed(3),
        mesh.south.toFixed(3),
        mesh.east.toFixed(3),
        mesh.north.toFixed(3),
        step.toFixed(3),
        String(mesh.nx),
        String(mesh.ny),
    ].join('|');
}

/** True when an existing grid still covers the view at an acceptable density. */
export function gridStillGood(
    g: WindGrid,
    view: { west: number; east: number; south: number; north: number },
): boolean {
    const marginLon = g.step * 0.25;
    const marginLat = g.step * 0.25;
    if (view.west < g.west - marginLon || view.east > g.east + marginLon) return false;
    if (view.south < g.south - marginLat || view.north > g.north + marginLat) return false;
    const want = chooseStep(view.west, view.south, view.east, view.north);
    // Refetch only when zoomed in enough to need a much denser lattice.
    // Keep the coarser field longer — avoids direction flips on mild zoom.
    if (want < g.step * 0.35) return false;
    return true;
}

export async function fetchWindGrid(signal?: AbortSignal): Promise<WindGrid | null> {
    const bounds = viewBounds();
    if (!bounds) return null;
    const mesh = buildMesh(bounds.west, bounds.south, bounds.east, bounds.north);

    const lats: number[] = [];
    const lons: number[] = [];
    const indexMap: number[] = [];
    for (let i = 0; i < mesh.lats.length; i++) {
        const lat = mesh.lats[i];
        const lon = mesh.lons[i];
        if (!isValidSample(lat, lon)) continue;
        lats.push(lat);
        lons.push(lon);
        indexMap.push(i);
    }
    if (!lats.length) throw new Error('No valid wind sample coordinates');

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}`
        + `&longitude=${lons.join(',')}`
        + '&current=wind_speed_10m,wind_direction_10m'
        + '&wind_speed_unit=ms&timezone=UTC&forecast_days=1'
        + '&cell_selection=nearest';
    const body = await fetchJson<OmPoint | OmPoint[]>(url, { signal });
    const rows = Array.isArray(body) ? body : [body];
    const u = new Float32Array(mesh.nx * mesh.ny);
    const v = new Float32Array(mesh.nx * mesh.ny);
    u.fill(Number.NaN);
    v.fill(Number.NaN);
    let filled = 0;
    for (let r = 0; r < rows.length && r < indexMap.length; r++) {
        const cur = rows[r]?.current;
        const spd = cur?.wind_speed_10m;
        const dir = cur?.wind_direction_10m;
        if (spd == null || dir == null || !Number.isFinite(spd) || !Number.isFinite(dir)) continue;
        const uv = uvFromSpeedDir(spd, dir);
        const i = indexMap[r];
        u[i] = uv.u;
        v[i] = uv.v;
        filled++;
    }
    if (!filled) throw new Error('No wind samples in view');
    fillNaNs(u, v, mesh.nx);
    return {
        west: mesh.west,
        east: mesh.east,
        south: mesh.south,
        north: mesh.north,
        step: mesh.step,
        nx: mesh.nx,
        ny: mesh.ny,
        u,
        v,
        fetchedAt: Date.now(),
        model: 'Open-Meteo',
    };
}
