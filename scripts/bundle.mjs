/**
 * Packages the runtime bundle for CloudTAK 14.2+ (iOS/Android):
 *   dist-bundle/index.js  ->  release/<name>-<version>.tar.gz  (manifest.json + index.js only)
 * Upload the tar.gz as a CloudTAK admin via POST /api/plugin/bundle.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const meta = pkg.cloudtakBundle ?? {};

const name = meta.name;
if (!name) throw new Error('package.json needs cloudtakBundle.name (the unique plugin name)');
if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(pkg.version)) throw new Error(`Invalid version ${pkg.version}`);

const out = resolve(root, 'dist-bundle');
const index = readFileSync(resolve(out, 'index.js'));

const manifest = {
    name,
    version: pkg.version,
    sha256: createHash('sha256').update(index).digest('hex'),
    api_version: 1,
    description: pkg.description,
    author: meta.author,
    license: pkg.license,
    homepage: meta.homepage
};
for (const k of Object.keys(manifest)) if (manifest[k] === undefined) delete manifest[k];
if (meta.logo) {
    const png = readFileSync(resolve(root, meta.logo));
    manifest.logo = `data:image/png;base64,${png.toString('base64')}`;
}

writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const release = resolve(root, 'release');
mkdirSync(release, { recursive: true });
const tarball = resolve(release, `${name}-${pkg.version}.tar.gz`);
rmSync(tarball, { force: true });
// Relative paths and cwd: GNU tar treats a drive letter such as C: as a remote host
execFileSync('tar', ['-czf', `../release/${name}-${pkg.version}.tar.gz`, 'manifest.json', 'index.js'], { cwd: out });

console.log(`${tarball}\n  sha256 ${manifest.sha256}\n  ${(index.length / 1024).toFixed(0)} KiB`);
