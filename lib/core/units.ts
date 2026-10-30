export type UnitSystem = 'us' | 'metric' | 'aviation';

export function convertTemp(celsius: number, units: UnitSystem): { value: number; unit: string } {
    if (units === 'metric') return { value: round1(celsius), unit: '°C' };
    return { value: round1(celsius * 9 / 5 + 32), unit: '°F' };
}

export function convertSpeed(mps: number, units: UnitSystem): { value: number; unit: string } {
    if (units === 'metric') return { value: round1(mps), unit: 'm/s' };
    if (units === 'aviation') return { value: round1(mps * 1.94384), unit: 'kt' };
    return { value: round1(mps * 2.23694), unit: 'mph' };
}

export function convertLength(meters: number, units: UnitSystem): { value: number; unit: string } {
    if (units === 'metric') {
        if (meters >= 1000) return { value: round1(meters / 1000), unit: 'km' };
        return { value: Math.round(meters), unit: 'm' };
    }
    const ft = meters * 3.28084;
    if (ft >= 5280) return { value: round1(ft / 5280), unit: 'mi' };
    return { value: Math.round(ft), unit: 'ft' };
}

export function convertPrecip(mm: number, units: UnitSystem): { value: number; unit: string } {
    if (units === 'metric') return { value: round1(mm), unit: 'mm' };
    return { value: round2(mm / 25.4), unit: 'in' };
}

/** River flow from cubic feet per second. */
export function convertFlow(cfs: number, units: UnitSystem): { value: number; unit: string } {
    if (units === 'metric') return { value: cfs * 0.0283168, unit: 'm³/s' };
    return { value: cfs, unit: 'cfs' };
}

export function convertPressure(hPa: number, units: UnitSystem): { value: number; unit: string } {
    if (units === 'us') return { value: round2(hPa * 0.02953), unit: 'inHg' };
    return { value: round1(hPa), unit: 'hPa' };
}

export function degToCompass(deg: number): string {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
    return dirs[i];
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Normalize provider units into canonical SI for storage. */
export function toCelsius(value: number, unit?: string): number {
    const u = (unit || '').toLowerCase();
    if (u.includes('f') || u === 'fahrenheit') return (value - 32) * 5 / 9;
    return value;
}

export function toMps(value: number, unit?: string): number {
    const u = (unit || '').toLowerCase();
    if (u.includes('mph') || u.includes('mi/h')) return value * 0.44704;
    if (u.includes('kt') || u.includes('knot')) return value * 0.514444;
    if (u.includes('km') || u.includes('kph')) return value / 3.6;
    return value;
}

export function toMeters(value: number, unit?: string): number {
    const u = (unit || '').toLowerCase();
    if (u.includes('ft') || u.includes('foot')) return value * 0.3048;
    if (u.includes('mi') && !u.includes('mm')) return value * 1609.34;
    if (u.includes('km')) return value * 1000;
    return value;
}
