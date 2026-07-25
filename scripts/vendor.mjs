import { cp, mkdir, writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const VENDOR = 'vendor/tesseract';

// Pinned to an immutable commit rather than a branch: these bytes are shipped
// into users' browsers, so "whatever gh-pages happens to point at today" is not
// an acceptable input. Bumping the model means bumping both constants together
// and re-running the OCR integration test.
const LANG_COMMIT = '806cd9adc8c6e8abc11c782db1818c990576bebc';
const LANG_URL = `https://raw.githubusercontent.com/naptha/tessdata/${LANG_COMMIT}/4.0.0_fast/eng.traineddata.gz`;
const LANG_SHA256 = '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

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

/**
 * Verify by reading the file, not by checking that it exists. Existence tells
 * us nothing about the contents, and a check-then-use pattern leaves a window
 * where the file changes between the check and the write.
 */
async function vendoredDigest() {
  try {
    return sha256(await readFile(langFile));
  } catch {
    return null;
  }
}

const existing = await vendoredDigest();

if (existing === LANG_SHA256) {
  console.log('lang data already vendored and verified');
} else {
  if (existing) {
    console.warn(`lang data digest mismatch (${existing}), re-fetching`);
  }

  const res = await fetch(LANG_URL);
  if (!res.ok) throw new Error(`lang data download failed: ${res.status}`);

  const downloaded = Buffer.from(await res.arrayBuffer());
  const digest = sha256(downloaded);

  // Refuse to write anything we cannot vouch for. A compromised or truncated
  // response must not reach disk, let alone get packaged into a release.
  if (digest !== LANG_SHA256) {
    throw new Error(
      `lang data checksum mismatch — refusing to vendor.\n` +
        `  expected ${LANG_SHA256}\n` +
        `  actual   ${digest}\n` +
        `  source   ${LANG_URL}`
    );
  }

  // Write to a sibling temp file and rename into place. Rename within a
  // directory is atomic, so the build either sees the old file or the fully
  // written new one, never a partial read of something mid-write.
  const tempFile = `${langFile}.${process.pid}.tmp`;
  try {
    await writeFile(tempFile, downloaded);
    await rename(tempFile, langFile);
  } catch (error) {
    await unlink(tempFile).catch(() => {});
    throw error;
  }

  console.log(`lang data downloaded and verified (${downloaded.length} bytes)`);
}
