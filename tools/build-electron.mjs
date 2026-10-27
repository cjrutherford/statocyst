#!/usr/bin/env node
/**
 * Bundles the Electron main process and preload with esbuild.
 *
 * Bare runtime dependencies stay external so native/WASM packages resolve from
 * `node_modules` in development and from the packaged app's pruned dependency
 * tree in production. Workspace libraries are aliased directly to source.
 */
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist/apps/desktop-electron');
const production = process.env['NODE_ENV'] === 'production';

const alias = {
  '@statocyst/contracts': resolve(root, 'libs/contracts/src/index.ts'),
  '@statocyst/playback-core': resolve(root, 'libs/playback-core/src/index.ts'),
  '@statocyst/persistence': resolve(root, 'libs/persistence/src/index.ts'),
  '@statocyst/media-library': resolve(root, 'libs/media-library/src/index.ts'),
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: production ? false : 'linked',
  minify: false,
  alias,
  external: ['electron', '@libsql/client', 'libsql', 'music-metadata'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  },
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(root, 'apps/desktop-electron/src/main/main.ts')],
    outfile: resolve(outdir, 'main.js'),
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, 'apps/desktop-electron/src/preload/preload.ts')],
    outfile: resolve(outdir, 'preload.js'),
  }),
]);

console.log(`Electron bundles written to ${outdir}`);
