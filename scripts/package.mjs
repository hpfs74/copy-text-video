#!/usr/bin/env node
/**
 * Package the built extension into a Chrome Web Store uploadable zip.
 *
 * The zip's contents must be the extension root itself — manifest.json at the
 * top level, not nested inside a dist/ folder — or the Web Store rejects it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (!existsSync('dist/manifest.json')) {
  console.error('dist/manifest.json not found — run `npm run build` first.');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const outDir = resolve('release');
const outFile = resolve(outDir, `video-text-select-${version}.zip`);

mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true });

// -r recurse, -q quiet, -X strip extra file attributes for a reproducible archive.
execFileSync('zip', ['-rqX', outFile, '.'], { cwd: 'dist', stdio: 'inherit' });

const bytes = execFileSync('wc', ['-c', outFile], { encoding: 'utf8' }).trim().split(/\s+/)[0];
console.log(`Packaged ${outFile} (${(Number(bytes) / 1024 / 1024).toFixed(1)} MB)`);

if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `zip=${outFile}\nversion=${version}\n`);
}
