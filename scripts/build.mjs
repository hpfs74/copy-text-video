import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const outdir = 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const shared = { bundle: true, target: 'chrome116', logLevel: 'info' };

// Service worker and offscreen document are extension pages: ES modules.
await esbuild.build({
  ...shared,
  format: 'esm',
  entryPoints: {
    'background/service-worker': 'src/background/service-worker.js',
    'offscreen/offscreen': 'src/offscreen/offscreen.js',
  },
  outdir,
});

// Content scripts cannot be ES modules — must be a self-contained IIFE.
await esbuild.build({
  ...shared,
  format: 'iife',
  entryPoints: { 'content/index': 'src/content/index.js' },
  outdir,
  loader: { '.css': 'text' },
});

await cp('manifest.json', `${outdir}/manifest.json`);
await cp('src/offscreen/offscreen.html', `${outdir}/offscreen/offscreen.html`);
await cp('vendor', `${outdir}/vendor`, { recursive: true });

console.log('built to dist/');
