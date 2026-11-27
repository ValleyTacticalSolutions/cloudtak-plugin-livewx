/**
 * Host bridge. Works both when compiled into the CloudTAK web build and when loaded as a
 * runtime bundle in the iOS/Android apps, where the page origin is the app and not the
 * CloudTAK server, and where core modules (`../../src/...`) cannot be imported.
 */
import type { Pinia } from 'pinia';
import type { PluginAPI } from '@tak-ps/cloudtak';

interface PreferencesLike {
    get(opts: { key: string }): Promise<{ value: string | null }>;
}

interface CapacitorLike {
    isNativePlatform?: () => boolean;
    Plugins?: { Preferences?: PreferencesLike };
}

let host: PluginAPI | undefined;

export function setHost(api: PluginAPI | undefined): void {
    host = api;
}

function capacitor(): CapacitorLike | undefined {
    return (globalThis as { Capacitor?: CapacitorLike }).Capacitor;
}

export function isNative(): boolean {
    try {
        return capacitor()?.isNativePlatform?.() === true;
    } catch {
        return false;
    }
}

async function preference(key: string): Promise<string | undefined> {
    try {
        const prefs = capacitor()?.Plugins?.Preferences;
        if (prefs) {
            const { value } = await prefs.get({ key });
            if (value) return value;
        }
        // The Capacitor web fallback stores preferences in localStorage
        return localStorage.getItem(`CapacitorStorage.${key}`) || undefined;
    } catch {
        return undefined;
    }
}

/** Base URL of the CloudTAK server, without a trailing slash */
export async function serverUrl(): Promise<string> {
    const url = await preference('serverUrl');
    return (url || location.origin).replace(/\/$/, '');
}

export async function token(): Promise<string | undefined> {
    return preference('token');
}

/** Absolute URL on the CloudTAK server for an API path (or an already absolute URL) */
export async function apiUrl(path: string): Promise<URL> {
    try {
        return new URL(path);
    } catch {
        return new URL(await serverUrl() + path);
    }
}

type Opts = Omit<RequestInit, 'body'> & { body?: unknown; timeout?: number };

/** Authenticated request to the CloudTAK server. Resolves the parsed JSON body, or the raw Response when `raw` is set */
export async function apiFetch(path: string, opts: Opts & { raw: true }): Promise<Response>;
export async function apiFetch(path: string, opts?: Opts): Promise<unknown>;
export async function apiFetch(path: string, opts: Opts & { raw?: boolean } = {}): Promise<unknown> {
    const url = await apiUrl(path);
    const headers = new Headers(opts.headers);
    const auth = await token();
    if (auth && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${auth}`);

    let body: BodyInit | undefined;
    if (opts.body !== undefined && opts.body !== null) {
        if (typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)) {
            body = JSON.stringify(opts.body);
            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        } else {
            body = opts.body as BodyInit;
        }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout ?? 30000);
    try {
        const res = await fetch(url, { ...opts, headers, body, signal: opts.signal ?? controller.signal });
        if ((opts as { raw?: boolean }).raw) return res;
        if (!res.ok) {
            let message = `Status Code: ${res.status}`;
            try {
                const json = await res.json() as { message?: string };
                if (json.message) message = json.message;
            } catch { /* not JSON */ }
            throw new Error(message);
        }
        const type = res.headers.get('content-type') || '';
        return type.includes('json') ? await res.json() : await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The live host Pinia store with the given id (`cloudtak` = map store, `cloudtak-app` = app store).
 * Read straight from the host's registry, so a bundle never creates (or bundles) a second Pinia.
 */
export function hostStore<T = Record<string, unknown>>(id: 'cloudtak' | 'cloudtak-app', pinia?: Pinia): T {
    const p = (pinia ?? host?.pinia) as unknown as { _s?: Map<string, unknown> } | undefined;
    const store = p?._s?.get(id);
    if (!store) throw new Error(`CloudTAK store '${id}' is not available`);
    return store as T;
}

/** Open a link in the system browser on native, where popup windows do not work */
export function openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
}
