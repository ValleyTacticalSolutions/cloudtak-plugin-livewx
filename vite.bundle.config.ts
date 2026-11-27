/**
 * Builds the runtime plugin bundle for the CloudTAK iOS/Android apps (CloudTAK 14.2+):
 * one ES module `dist-bundle/index.js`. The host supplies vue, vue-router and
 * @tak-ps/vue-tabler through globalThis.__CLOUDTAK__; everything else is bundled in.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

// Root layout: index.ts and lib/ sit at the repo root
const SRC = resolve(import.meta.dirname);
const SKIP = new Set(['node_modules', 'dist-bundle', 'release', 'scripts', 'test', 'data', '.git', '.github']);
const HOST = ['vue', 'vue-router', '@tak-ps/vue-tabler'];
const require = createRequire(import.meta.url);

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|vue)$/.test(name)) out.push(p);
    }
    return out;
}

/** Names the plugin imports from a host module, found by scanning the source */
function importedNames(id: string): string[] {
    const names = new Set<string>();
    const escaped = id.replace(/[/@-]/g, (c) => `\\${c}`);
    const re = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`, 'g');
    for (const file of walk(SRC)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(re)) {
            for (const part of m[1].split(',')) {
                const n = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '');
                if (n) names.add(n);
            }
        }
    }
    return [...names];
}

function hostModules(): Plugin {
    return {
        name: 'cloudtak-host-modules',
        enforce: 'pre',
        resolveId(id) {
            return HOST.includes(id) ? `\0host:${id}` : null;
        },
        load(id) {
            if (!id.startsWith('\0host:')) return null;
            const mod = id.slice('\0host:'.length);
            // Compiled SFCs import arbitrary helpers from vue / vue-router, so take every export of those
            const names = mod === '@tak-ps/vue-tabler'
                ? importedNames(mod)
                : Object.keys(require(mod)).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
            return [
                `const m = globalThis.__CLOUDTAK__[${JSON.stringify(mod)}];`,
                `if (!m) throw new Error('CloudTAK host did not provide ${mod}');`,
                ...names.map((n) => `export const ${n} = m.${n};`),
                'export default m;'
            ].join('\n');
        }
    };
}

export default defineConfig({
    plugins: [hostModules(), vue(), cssInjectedByJsPlugin()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), __CLOUDTAK_BUNDLE__: 'true' },
    build: {
        outDir: 'dist-bundle',
        emptyOutDir: true,
        target: 'es2022',
        cssCodeSplit: false,
        lib: {
            entry: resolve(SRC, 'index.ts'),
            formats: ['es'],
            fileName: () => 'index.js'
        },
        rollupOptions: {
            output: { inlineDynamicImports: true }
        }
    }
});
