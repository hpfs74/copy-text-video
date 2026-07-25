import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const VENDOR = 'vendor/tesseract';
const LANG_URL =
  'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz';

await mkdir(`${VENDOR}/core`, { recursive: true });
await mkdir(`${VENDOR}/lang`, { recursive: true });

// Tesseract's dedicated-worker entry point. The package's "main" points at
// src/index.js for bundlers, but the prebuilt worker only exists in dist/.
const tesseractPkgDir = dirname(require.resolve('tesseract.js/package.json'));
await cp(join(tesseractPkgDir, 'dist', 'worker.min.js'), `${VENDOR}/worker.min.js`);

// WASM core: copy the whole directory, Tesseract picks the right variant at runtime.
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
await cp(coreDir, `${VENDOR}/core`, { recursive: true });

// Language data must ship with the extension — no network at runtime.
const langFile = `${VENDOR}/lang/eng.traineddata.gz`;
try {
  await access(langFile);
  console.log('lang data already vendored');
} catch {
  const res = await fetch(LANG_URL);
  if (!res.ok) throw new Error(`lang data download failed: ${res.status}`);
  await writeFile(langFile, Buffer.from(await res.arrayBuffer()));
  console.log('lang data downloaded');
}
