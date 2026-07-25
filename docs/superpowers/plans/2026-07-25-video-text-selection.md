# Video Text Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that freezes the current video frame on a keyboard shortcut, OCRs it locally, and overlays an invisible selectable text layer so the user can drag-select and Cmd+C text out of the picture, exactly like macOS Live Text.

**Architecture:** Three isolated contexts. A service worker owns the keyboard command, injects the content script into the active tab under `activeTab`, and owns an offscreen document. The offscreen document hosts a long-lived Tesseract.js worker under the extension's own CSP (host-page CSP would block WASM in a content script). The content script finds and pauses the video, captures the frame at intrinsic resolution, mounts a shadow-DOM overlay showing the frozen frame, and — once OCR returns — positions one transparent `<span>` per recognised word over its pixels so the browser's own selection machinery does the copying.

**Tech Stack:** Manifest V3, vanilla JS (no framework), Tesseract.js v5+ (vendored, offline), esbuild for bundling, Vitest for tests, jsdom for DOM tests.

## Global Constraints

- **Offline only.** No network requests at runtime. Tesseract WASM, core and `eng.traineddata` are all vendored into the extension.
- **Permissions:** `activeTab`, `scripting`, `offscreen`. No host permissions. No `<all_urls>`.
- **No content script on page load.** Injection happens only in response to the keyboard command.
- **Default shortcut:** `Command+Shift+S` on mac, `Ctrl+Shift+S` elsewhere. Rebindable at `chrome://extensions/shortcuts`.
- **Coordinate convention:** all OCR bounding boxes are in *captured image pixels*. All layout output is in *CSS pixels relative to the overlay root*. Never mix them; every conversion goes through `computeContentRect` + the scale factor derived from the captured image width.
- **Pure-first:** geometry, classification and normalisation live in side-effect-free functions that take plain data. DOM-touching code is a thin shell over them. This is what makes the maths testable without a browser.
- **Chrome 116+** (`minimum_chrome_version`), for stable `chrome.offscreen`.
- **Commit after every task.** Conventional commit messages (`feat:`, `test:`, `chore:`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest: command, permissions, CSP |
| `scripts/build.mjs` | esbuild bundling + static asset copy into `dist/` |
| `scripts/vendor.mjs` | Copy Tesseract runtime out of `node_modules`, fetch `eng.traineddata.gz` |
| `scripts/make-fixture.mjs` | Generate the golden OCR test image |
| `src/lib/messages.js` | Message type constants and error codes shared by all three contexts |
| `src/lib/ocr-result.js` | Normalise Tesseract output into one stable shape |
| `src/background/service-worker.js` | Command handler, script injection, offscreen lifecycle, OCR routing + timeout |
| `src/offscreen/offscreen.html` | Offscreen document shell |
| `src/offscreen/offscreen.js` | Tesseract worker host |
| `src/content/index.js` | Orchestration: find → pause → capture → OCR → overlay |
| `src/content/video-target.js` | Candidate collection, target selection, content-rect maths (pure core) |
| `src/content/capture.js` | Capture sizing, blank-frame detection, error classification, canvas draw |
| `src/content/overlay/overlay.js` | Shadow-DOM overlay lifecycle |
| `src/content/overlay/text-layer.js` | OCR words → positioned transparent spans (pure layout + thin render) |
| `src/content/overlay/overlay.css` | Overlay and `::selection` styling |
| `tests/**` | Vitest unit tests mirroring `src/` |
| `tests/integration/ocr.test.js` | Golden-image OCR test (slow, separate script) |

---

## Task 1: Scaffolding, manifest and build pipeline

**Files:**
- Create: `package.json`, `.gitignore`, `manifest.json`, `vitest.config.js`, `scripts/build.mjs`, `scripts/vendor.mjs`
- Create: `src/background/service-worker.js`, `src/content/index.js`, `src/offscreen/offscreen.html`, `src/offscreen/offscreen.js`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run build` → loadable unpacked extension in `dist/`. `npm test` → Vitest. `npm run vendor` → populates `vendor/tesseract/`.

- [ ] **Step 1: Initialise the project**

```bash
npm init -y
npm install --save-dev esbuild vitest jsdom
npm install tesseract.js
```

Then set `"type": "module"` and the scripts block in `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "vendor": "node scripts/vendor.mjs",
    "build": "npm run vendor && node scripts/build.mjs",
    "test": "vitest run tests --exclude tests/integration/**",
    "test:integration": "vitest run tests/integration"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
vendor/
```

`vendor/` is generated by `npm run vendor`, so it stays out of git.

- [ ] **Step 3: Write the failing manifest test**

Create `tests/manifest.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

describe('manifest', () => {
  it('is manifest v3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('requests only the three permissions it needs and no host permissions', () => {
    expect(new Set(manifest.permissions)).toEqual(
      new Set(['activeTab', 'scripting', 'offscreen'])
    );
    expect(manifest.host_permissions).toBeUndefined();
  });

  it('declares no static content scripts', () => {
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('declares the capture command with a mac-specific binding', () => {
    const command = manifest.commands['capture-frame'];
    expect(command.suggested_key.default).toBe('Ctrl+Shift+S');
    expect(command.suggested_key.mac).toBe('Command+Shift+S');
  });

  it('allows wasm on extension pages', () => {
    expect(manifest.content_security_policy.extension_pages).toContain(
      "'wasm-unsafe-eval'"
    );
  });

  it('requires a chrome version with stable offscreen support', () => {
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/manifest.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'manifest.json'`

- [ ] **Step 5: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Video Text Select",
  "version": "0.1.0",
  "description": "Pause a video and select text out of the frame, like macOS Live Text.",
  "minimum_chrome_version": "116",
  "permissions": ["activeTab", "scripting", "offscreen"],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "commands": {
    "capture-frame": {
      "suggested_key": {
        "default": "Ctrl+Shift+S",
        "mac": "Command+Shift+S"
      },
      "description": "Freeze the video frame and select text"
    }
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Note there is no `action` and no icons — the extension is driven entirely by the keyboard command, and `activeTab` is granted by the command gesture.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/manifest.test.js`
Expected: PASS (6 tests)

- [ ] **Step 7: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
```

DOM-dependent test files opt in individually with a `// @vitest-environment jsdom` comment on line 1.

- [ ] **Step 8: Write `scripts/vendor.mjs`**

```js
import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const VENDOR = 'vendor/tesseract';
const LANG_URL =
  'https://raw.githubusercontent.com/naptha/tessdata/main/4.0.0_fast/eng.traineddata.gz';

await mkdir(`${VENDOR}/core`, { recursive: true });
await mkdir(`${VENDOR}/lang`, { recursive: true });

// Tesseract's dedicated-worker entry point.
const tesseractDist = dirname(require.resolve('tesseract.js'));
await cp(join(tesseractDist, 'worker.min.js'), `${VENDOR}/worker.min.js`);

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
```

If `require.resolve('tesseract.js')` resolves to a file that is not inside a `dist` directory, adjust the path to point at the package's published `dist` folder — verify by listing the directory before moving on.

- [ ] **Step 9: Write `scripts/build.mjs`**

```js
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
```

The `.css` text loader is what lets `overlay.css` be imported as a string in Task 8 and injected into the shadow root.

- [ ] **Step 10: Create the four source stubs**

`src/background/service-worker.js`:

```js
chrome.commands.onCommand.addListener((command) => {
  console.log('[vts] command', command);
});
```

`src/content/index.js`:

```js
console.log('[vts] content script injected');
```

`src/offscreen/offscreen.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Video Text Select — OCR</title>
<script type="module" src="offscreen.js"></script>
```

`src/offscreen/offscreen.js`:

```js
console.log('[vts] offscreen ready');
```

- [ ] **Step 11: Verify the build produces a loadable extension**

Run: `npm run build`
Expected: `dist/` contains `manifest.json`, `background/service-worker.js`, `content/index.js`, `offscreen/offscreen.html`, `offscreen/offscreen.js`, and `vendor/tesseract/` with `worker.min.js`, `core/` and `lang/eng.traineddata.gz`.

Then load `dist/` at `chrome://extensions` with Developer mode on. Confirm it loads with no errors and that `chrome://extensions/shortcuts` lists "Freeze the video frame and select text".

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json .gitignore manifest.json vitest.config.js scripts src tests
git commit -m "chore: scaffold MV3 extension with build pipeline and manifest tests"
```

---

## Task 2: Target selection and content-rect maths

This is the geometry core. Everything downstream trusts these numbers, so it is entirely pure and heavily tested.

**Files:**
- Create: `src/content/video-target.js`
- Test: `tests/content/video-target.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `computeContentRect(rect, intrinsicWidth, intrinsicHeight, objectFit) → {left, top, width, height}` — all numbers, viewport CSS pixels. `rect` is `{left, top, width, height}`. `objectFit` is `'contain' | 'cover' | 'fill' | 'none'`.
  - `pickTarget(candidates, viewport) → Candidate | null` where `Candidate` is `{id, kind: 'video'|'canvas', rect, intrinsicWidth, intrinsicHeight, paused, objectFit}` and `viewport` is `{width, height}`.
  - `visibleArea(rect, viewport) → number`

- [ ] **Step 1: Write the failing tests**

Create `tests/content/video-target.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  computeContentRect,
  pickTarget,
  visibleArea,
} from '../../src/content/video-target.js';

const viewport = { width: 1000, height: 800 };

describe('computeContentRect', () => {
  it('returns the element rect when the aspect ratios already match', () => {
    const rect = { left: 10, top: 20, width: 640, height: 360 };
    expect(computeContentRect(rect, 1920, 1080, 'contain')).toEqual({
      left: 10,
      top: 20,
      width: 640,
      height: 360,
    });
  });

  it('letterboxes a wide video in a tall element', () => {
    // 16:9 content in a 640x480 box -> 640x360, centred vertically (60px bars).
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(computeContentRect(rect, 1920, 1080, 'contain')).toEqual({
      left: 0,
      top: 60,
      width: 640,
      height: 360,
    });
  });

  it('pillarboxes a tall video in a wide element', () => {
    // 1:1 content in a 640x480 box -> 480x480, centred horizontally (80px bars).
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(computeContentRect(rect, 1000, 1000, 'contain')).toEqual({
      left: 80,
      top: 0,
      width: 480,
      height: 480,
    });
  });

  it('overflows the element for object-fit: cover', () => {
    // Cover scales to the larger factor, so content bleeds past the box and
    // is centred on it. Negative offsets are correct and expected here.
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(computeContentRect(rect, 1920, 1080, 'cover')).toEqual({
      left: 0,
      top: -120,
      width: 640,
      height: 720,
    });
  });

  it('stretches to the element for object-fit: fill', () => {
    const rect = { left: 5, top: 5, width: 640, height: 480 };
    expect(computeContentRect(rect, 1920, 1080, 'fill')).toEqual({
      left: 5,
      top: 5,
      width: 640,
      height: 480,
    });
  });

  it('uses intrinsic size centred in the element for object-fit: none', () => {
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(computeContentRect(rect, 320, 240, 'none')).toEqual({
      left: 160,
      top: 120,
      width: 320,
      height: 240,
    });
  });

  it('preserves sub-pixel precision rather than rounding', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    const result = computeContentRect(rect, 3, 2, 'contain');
    expect(result.height).toBeCloseTo(66.6667, 3);
  });
});

describe('visibleArea', () => {
  it('is the full area for a fully visible element', () => {
    expect(visibleArea({ left: 0, top: 0, width: 100, height: 50 }, viewport)).toBe(5000);
  });

  it('clips to the viewport for a partly scrolled-off element', () => {
    expect(visibleArea({ left: -50, top: 0, width: 100, height: 50 }, viewport)).toBe(2500);
  });

  it('is zero for an element entirely off screen', () => {
    expect(visibleArea({ left: -200, top: 0, width: 100, height: 50 }, viewport)).toBe(0);
  });
});

describe('pickTarget', () => {
  const base = {
    kind: 'video',
    intrinsicWidth: 1920,
    intrinsicHeight: 1080,
    paused: true,
    objectFit: 'contain',
  };

  it('returns null when there are no candidates', () => {
    expect(pickTarget([], viewport)).toBeNull();
  });

  it('ignores elements with no intrinsic dimensions', () => {
    const candidates = [
      { ...base, id: 'unloaded', intrinsicWidth: 0, intrinsicHeight: 0,
        rect: { left: 0, top: 0, width: 600, height: 400 } },
    ];
    expect(pickTarget(candidates, viewport)).toBeNull();
  });

  it('ignores elements that are entirely off screen', () => {
    const candidates = [
      { ...base, id: 'offscreen', rect: { left: 0, top: -500, width: 400, height: 300 } },
    ];
    expect(pickTarget(candidates, viewport)).toBeNull();
  });

  it('ignores zero-area elements', () => {
    const candidates = [
      { ...base, id: 'collapsed', rect: { left: 0, top: 0, width: 0, height: 0 } },
    ];
    expect(pickTarget(candidates, viewport)).toBeNull();
  });

  it('prefers a playing video over a larger paused one', () => {
    const candidates = [
      { ...base, id: 'big-paused', paused: true,
        rect: { left: 0, top: 0, width: 800, height: 600 } },
      { ...base, id: 'small-playing', paused: false,
        rect: { left: 0, top: 0, width: 200, height: 150 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('small-playing');
  });

  it('picks the largest visible video when none are playing', () => {
    const candidates = [
      { ...base, id: 'small', rect: { left: 0, top: 0, width: 200, height: 150 } },
      { ...base, id: 'large', rect: { left: 0, top: 0, width: 800, height: 600 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('large');
  });

  it('ranks by visible area, not raw size', () => {
    const candidates = [
      // 900x600 but 800px of its width is scrolled off: 100x600 = 60000 visible.
      { ...base, id: 'mostly-offscreen',
        rect: { left: -800, top: 0, width: 900, height: 600 } },
      // Fully visible 400x400 = 160000 visible.
      { ...base, id: 'fully-visible',
        rect: { left: 0, top: 0, width: 400, height: 400 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('fully-visible');
  });

  it('prefers any eligible video over a larger canvas', () => {
    const candidates = [
      { ...base, id: 'canvas', kind: 'canvas',
        rect: { left: 0, top: 0, width: 900, height: 700 } },
      { ...base, id: 'video', kind: 'video',
        rect: { left: 0, top: 0, width: 300, height: 200 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('video');
  });

  it('falls back to the largest canvas when there is no video', () => {
    const candidates = [
      { ...base, id: 'canvas-small', kind: 'canvas',
        rect: { left: 0, top: 0, width: 200, height: 200 } },
      { ...base, id: 'canvas-large', kind: 'canvas',
        rect: { left: 0, top: 0, width: 600, height: 400 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('canvas-large');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/content/video-target.test.js`
Expected: FAIL — `Failed to load ../../src/content/video-target.js`

- [ ] **Step 3: Implement the pure core**

Create `src/content/video-target.js`:

```js
/**
 * @typedef {{left:number, top:number, width:number, height:number}} Rect
 * @typedef {{width:number, height:number}} Viewport
 * @typedef {{
 *   id: string,
 *   kind: 'video'|'canvas',
 *   rect: Rect,
 *   intrinsicWidth: number,
 *   intrinsicHeight: number,
 *   paused: boolean,
 *   objectFit: string,
 * }} Candidate
 */

/**
 * The rect of the actual picture inside the element. A 16:9 video in a 4:3
 * player is letterboxed, so the element rect is NOT where the pixels are.
 * Assumes the default `object-position: 50% 50%`.
 *
 * @returns {Rect}
 */
export function computeContentRect(rect, intrinsicWidth, intrinsicHeight, objectFit) {
  if (objectFit === 'fill') {
    return { ...rect };
  }

  const scaleX = rect.width / intrinsicWidth;
  const scaleY = rect.height / intrinsicHeight;

  let scale;
  if (objectFit === 'cover') scale = Math.max(scaleX, scaleY);
  else if (objectFit === 'none') scale = 1;
  else scale = Math.min(scaleX, scaleY); // 'contain' and anything unrecognised

  const width = intrinsicWidth * scale;
  const height = intrinsicHeight * scale;

  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

/** Area of the element actually inside the viewport, in square CSS pixels. */
export function visibleArea(rect, viewport) {
  const width = Math.max(
    0,
    Math.min(rect.left + rect.width, viewport.width) - Math.max(rect.left, 0)
  );
  const height = Math.max(
    0,
    Math.min(rect.top + rect.height, viewport.height) - Math.max(rect.top, 0)
  );
  return width * height;
}

function isEligible(candidate, viewport) {
  return (
    candidate.intrinsicWidth > 0 &&
    candidate.intrinsicHeight > 0 &&
    candidate.rect.width > 0 &&
    candidate.rect.height > 0 &&
    visibleArea(candidate.rect, viewport) > 0
  );
}

/**
 * Ranking: playing video, then any video, then canvas. Within a tier, the one
 * showing the most pixels on screen wins.
 *
 * @returns {Candidate|null}
 */
export function pickTarget(candidates, viewport) {
  const eligible = candidates.filter((c) => isEligible(c, viewport));
  if (eligible.length === 0) return null;

  const tier = (c) => {
    if (c.kind === 'video' && !c.paused) return 0;
    if (c.kind === 'video') return 1;
    return 2;
  };

  return eligible.reduce((best, candidate) => {
    const tierDelta = tier(candidate) - tier(best);
    if (tierDelta !== 0) return tierDelta < 0 ? candidate : best;
    return visibleArea(candidate.rect, viewport) > visibleArea(best.rect, viewport)
      ? candidate
      : best;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/content/video-target.test.js`
Expected: PASS (all 18 tests)

- [ ] **Step 5: Add the DOM adapter**

Append to `src/content/video-target.js`:

```js
let nextId = 0;

/**
 * Reads live DOM state into plain Candidate records. This is the only part of
 * this module that touches the DOM, and it is deliberately trivial — the
 * decision logic above stays testable without a browser.
 *
 * @returns {Array<Candidate & {element: Element}>}
 */
export function collectCandidates(doc = document) {
  const elements = [...doc.querySelectorAll('video, canvas')];

  return elements.map((element) => {
    const isVideo = element.tagName === 'VIDEO';
    const rect = element.getBoundingClientRect();
    return {
      id: `candidate-${nextId++}`,
      element,
      kind: isVideo ? 'video' : 'canvas',
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      intrinsicWidth: isVideo ? element.videoWidth : element.width,
      intrinsicHeight: isVideo ? element.videoHeight : element.height,
      paused: isVideo ? element.paused : true,
      objectFit: getComputedStyle(element).objectFit || 'contain',
    };
  });
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — manifest tests plus all video-target tests.

- [ ] **Step 7: Commit**

```bash
git add src/content/video-target.js tests/content/video-target.test.js
git commit -m "feat: add video target selection and content-rect geometry"
```

---

## Task 3: Frame capture, sizing and failure classification

**Files:**
- Create: `src/content/capture.js`, `src/lib/messages.js`
- Test: `tests/content/capture.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ERROR` — frozen object of error-code constants, in `src/lib/messages.js`.
  - `computeCaptureSize(intrinsicWidth, intrinsicHeight, maxWidth) → {width, height}`
  - `isBlankFrame(pixels, options?) → boolean` where `pixels` is a `Uint8ClampedArray` of RGBA.
  - `classifyCaptureError(error) → string` (an `ERROR` code)
  - `captureFrame(element, candidate, options?) → {dataUrl, width, height}` — throws `Error` with a `.code` property from `ERROR`.

- [ ] **Step 1: Write `src/lib/messages.js`**

```js
export const MSG = Object.freeze({
  OCR_RUN: 'vts:ocr-run',
  OCR_PING: 'vts:ocr-ping',
});

export const ERROR = Object.freeze({
  NO_TARGET: 'no_target',
  NOT_READY: 'not_ready',
  BLOCKED: 'blocked',
  OCR_TIMEOUT: 'ocr_timeout',
  OCR_FAILED: 'ocr_failed',
  NO_TEXT: 'no_text',
  UNKNOWN: 'unknown',
});

/** User-facing copy. Keep every ERROR code represented. */
export const ERROR_MESSAGE = Object.freeze({
  [ERROR.NO_TARGET]: 'No video found on this page',
  [ERROR.NOT_READY]: 'The video has not loaded a frame yet',
  [ERROR.BLOCKED]: 'This player blocks frame capture (DRM or cross-origin video)',
  [ERROR.OCR_TIMEOUT]: 'Text recognition timed out',
  [ERROR.OCR_FAILED]: 'Text recognition failed',
  [ERROR.NO_TEXT]: 'No text found in this frame',
  [ERROR.UNKNOWN]: 'Could not capture this frame',
});
```

- [ ] **Step 2: Write the failing tests**

Create `tests/content/capture.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  computeCaptureSize,
  isBlankFrame,
  classifyCaptureError,
} from '../../src/content/capture.js';
import { ERROR } from '../../src/lib/messages.js';

/** Build an RGBA buffer of `count` pixels, all the same colour. */
function solid(count, r, g, b) {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

describe('computeCaptureSize', () => {
  it('captures at intrinsic resolution when under the cap', () => {
    expect(computeCaptureSize(1920, 1080, 2560)).toEqual({ width: 1920, height: 1080 });
  });

  it('downscales 4K to the cap, preserving aspect ratio', () => {
    expect(computeCaptureSize(3840, 2160, 2560)).toEqual({ width: 2560, height: 1440 });
  });

  it('rounds to whole pixels', () => {
    const size = computeCaptureSize(3000, 1001, 1500);
    expect(size.width).toBe(1500);
    expect(Number.isInteger(size.height)).toBe(true);
    expect(size.height).toBe(501);
  });

  it('never upscales a small video', () => {
    expect(computeCaptureSize(320, 240, 2560)).toEqual({ width: 320, height: 240 });
  });
});

describe('isBlankFrame', () => {
  it('detects a fully black frame, which is how DRM capture fails', () => {
    expect(isBlankFrame(solid(10000, 0, 0, 0))).toBe(true);
  });

  it('treats near-black noise as blank', () => {
    expect(isBlankFrame(solid(10000, 3, 3, 3))).toBe(true);
  });

  it('does not treat a white frame as blank', () => {
    expect(isBlankFrame(solid(10000, 255, 255, 255))).toBe(false);
  });

  it('does not treat a mid-grey frame as blank', () => {
    expect(isBlankFrame(solid(10000, 128, 128, 128))).toBe(false);
  });

  it('is not fooled by a mostly-black frame with real content', () => {
    // A dark slide with white text: 1% bright pixels is still a real frame.
    const pixels = solid(10000, 0, 0, 0);
    for (let i = 0; i < 100; i++) {
      const p = i * 4 * 97; // spread the bright pixels across the buffer
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
    }
    expect(isBlankFrame(pixels)).toBe(false);
  });
});

describe('classifyCaptureError', () => {
  it('maps a SecurityError to BLOCKED', () => {
    const error = new Error('tainted canvas');
    error.name = 'SecurityError';
    expect(classifyCaptureError(error)).toBe(ERROR.BLOCKED);
  });

  it('preserves an already-classified code', () => {
    const error = new Error('nope');
    error.code = ERROR.NOT_READY;
    expect(classifyCaptureError(error)).toBe(ERROR.NOT_READY);
  });

  it('falls back to UNKNOWN', () => {
    expect(classifyCaptureError(new Error('who knows'))).toBe(ERROR.UNKNOWN);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/content/capture.test.js`
Expected: FAIL — `Failed to load ../../src/content/capture.js`

- [ ] **Step 4: Implement `src/content/capture.js`**

```js
import { ERROR } from '../lib/messages.js';

const DEFAULT_MAX_WIDTH = 2560;

/**
 * Capture at the video's intrinsic resolution — OCR on a 1920px frame is much
 * more accurate than on the 640px box it may be displayed in — but cap it so
 * the data URL stays a sane size to pass between extension contexts.
 */
export function computeCaptureSize(intrinsicWidth, intrinsicHeight, maxWidth = DEFAULT_MAX_WIDTH) {
  if (intrinsicWidth <= maxWidth) {
    return { width: intrinsicWidth, height: intrinsicHeight };
  }
  const scale = maxWidth / intrinsicWidth;
  return {
    width: maxWidth,
    height: Math.round(intrinsicHeight * scale),
  };
}

/**
 * DRM-protected players do not throw — they hand back a perfectly valid,
 * entirely black canvas. Without this check the user gets an empty overlay and
 * no explanation, so this is the only signal that capture silently failed.
 *
 * @param {Uint8ClampedArray} pixels RGBA
 */
export function isBlankFrame(pixels, { step = 97, threshold = 8, minBrightRatio = 0.001 } = {}) {
  const pixelCount = pixels.length / 4;
  let sampled = 0;
  let bright = 0;

  for (let i = 0; i < pixelCount; i += step) {
    const offset = i * 4;
    const luminance =
      0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
    sampled++;
    if (luminance > threshold) bright++;
  }

  if (sampled === 0) return true;
  return bright / sampled <= minBrightRatio;
}

export function classifyCaptureError(error) {
  if (error?.code) return error.code;
  if (error?.name === 'SecurityError') return ERROR.BLOCKED;
  return ERROR.UNKNOWN;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * Draw the element's current frame to an offscreen canvas and encode it.
 *
 * @param {HTMLVideoElement|HTMLCanvasElement} element
 * @param {{intrinsicWidth:number, intrinsicHeight:number}} candidate
 * @returns {{dataUrl:string, width:number, height:number}}
 * @throws {Error} with a `.code` from ERROR
 */
export function captureFrame(element, candidate, { maxWidth = DEFAULT_MAX_WIDTH } = {}) {
  const { intrinsicWidth, intrinsicHeight } = candidate;
  if (!intrinsicWidth || !intrinsicHeight) throw fail(ERROR.NOT_READY);

  const { width, height } = computeCaptureSize(intrinsicWidth, intrinsicHeight, maxWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });

  let dataUrl;
  let pixels;
  try {
    context.drawImage(element, 0, 0, width, height);
    pixels = context.getImageData(0, 0, width, height).data;
    dataUrl = canvas.toDataURL('image/png');
  } catch (error) {
    throw fail(classifyCaptureError(error));
  }

  if (isBlankFrame(pixels)) throw fail(ERROR.BLOCKED);

  return { dataUrl, width, height };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/content/capture.test.js`
Expected: PASS (12 tests)

- [ ] **Step 6: Commit**

```bash
git add src/content/capture.js src/lib/messages.js tests/content/capture.test.js
git commit -m "feat: add frame capture with blank-frame and error classification"
```

---

## Task 4: OCR result normalisation

Tesseract's output shape has changed between major versions — v4 exposes `data.words` and `data.lines` directly, v5+ nests everything under `data.blocks[].paragraphs[].lines[].words[]`. Normalising once here means nothing downstream cares which version is installed.

**Files:**
- Create: `src/lib/ocr-result.js`
- Test: `tests/lib/ocr-result.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeRecognition(data, imageWidth, imageHeight) → OcrResult`
  - `OcrResult` = `{width:number, height:number, lines:OcrLine[]}`
  - `OcrLine` = `{text:string, words:OcrWord[]}`
  - `OcrWord` = `{text:string, bbox:{x0,y0,x1,y1}, confidence:number}`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/ocr-result.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { normalizeRecognition } from '../../src/lib/ocr-result.js';

const word = (text, x0, confidence = 90) => ({
  text,
  confidence,
  bbox: { x0, y0: 10, x1: x0 + 40, y1: 30 },
});

describe('normalizeRecognition', () => {
  it('reads the nested block structure of tesseract v5+', () => {
    const data = {
      blocks: [
        {
          paragraphs: [
            { lines: [{ words: [word('The', 0), word('quick', 50)] }] },
            { lines: [{ words: [word('brown', 0)] }] },
          ],
        },
      ],
    };

    const result = normalizeRecognition(data, 800, 300);

    expect(result.width).toBe(800);
    expect(result.height).toBe(300);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].text).toBe('The quick');
    expect(result.lines[1].text).toBe('brown');
    expect(result.lines[0].words[1].bbox).toEqual({ x0: 50, y0: 10, x1: 90, y1: 30 });
  });

  it('reads the flat line structure of tesseract v4', () => {
    const data = {
      lines: [{ words: [word('Hello', 0), word('world', 60)] }],
    };

    const result = normalizeRecognition(data, 640, 480);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe('Hello world');
  });

  it('preserves reading order across blocks', () => {
    const data = {
      blocks: [
        { paragraphs: [{ lines: [{ words: [word('first', 0)] }] }] },
        { paragraphs: [{ lines: [{ words: [word('second', 0)] }] }] },
      ],
    };
    expect(normalizeRecognition(data, 100, 100).lines.map((l) => l.text)).toEqual([
      'first',
      'second',
    ]);
  });

  it('drops empty and whitespace-only words', () => {
    const data = { lines: [{ words: [word('real', 0), word('   ', 50), word('', 100)] }] };
    const result = normalizeRecognition(data, 100, 100);
    expect(result.lines[0].words).toHaveLength(1);
    expect(result.lines[0].text).toBe('real');
  });

  it('drops words below the confidence floor', () => {
    const data = { lines: [{ words: [word('good', 0, 80), word('junk', 50, 20)] }] };
    const result = normalizeRecognition(data, 100, 100);
    expect(result.lines[0].text).toBe('good');
  });

  it('drops words with a degenerate bounding box', () => {
    const data = {
      lines: [
        {
          words: [
            word('good', 0),
            { text: 'flat', confidence: 90, bbox: { x0: 5, y0: 5, x1: 5, y1: 25 } },
          ],
        },
      ],
    };
    expect(normalizeRecognition(data, 100, 100).lines[0].words).toHaveLength(1);
  });

  it('drops lines left with no words', () => {
    const data = { lines: [{ words: [word('kept', 0)] }, { words: [word('  ', 0)] }] };
    expect(normalizeRecognition(data, 100, 100).lines).toHaveLength(1);
  });

  it('trims surrounding whitespace from word text', () => {
    const data = { lines: [{ words: [word(' padded ', 0)] }] };
    expect(normalizeRecognition(data, 100, 100).lines[0].text).toBe('padded');
  });

  it('returns an empty result for output with no recognisable structure', () => {
    expect(normalizeRecognition({}, 100, 100)).toEqual({
      width: 100,
      height: 100,
      lines: [],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/ocr-result.test.js`
Expected: FAIL — `Failed to load ../../src/lib/ocr-result.js`

- [ ] **Step 3: Implement `src/lib/ocr-result.js`**

```js
const MIN_CONFIDENCE = 40;

/**
 * @typedef {{x0:number, y0:number, x1:number, y1:number}} BBox
 * @typedef {{text:string, bbox:BBox, confidence:number}} OcrWord
 * @typedef {{text:string, words:OcrWord[]}} OcrLine
 * @typedef {{width:number, height:number, lines:OcrLine[]}} OcrResult
 */

/** Tesseract v5+ nests lines under blocks/paragraphs; v4 exposes them flat. */
function extractRawLines(data) {
  if (Array.isArray(data?.blocks)) {
    return data.blocks.flatMap((block) =>
      (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? [])
    );
  }
  if (Array.isArray(data?.lines)) return data.lines;
  return [];
}

function isUsableWord(word) {
  if (!word?.bbox) return false;
  if (!word.text?.trim()) return false;
  if ((word.confidence ?? 0) < MIN_CONFIDENCE) return false;
  return word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0;
}

/**
 * Collapse Tesseract's version-specific output into one stable shape, in
 * reading order, with unusable words removed.
 *
 * @returns {OcrResult}
 */
export function normalizeRecognition(data, imageWidth, imageHeight) {
  const lines = extractRawLines(data)
    .map((line) => {
      const words = (line.words ?? []).filter(isUsableWord).map((word) => ({
        text: word.text.trim(),
        bbox: { ...word.bbox },
        confidence: word.confidence ?? 0,
      }));
      return { text: words.map((w) => w.text).join(' '), words };
    })
    .filter((line) => line.words.length > 0);

  return { width: imageWidth, height: imageHeight, lines };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/ocr-result.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ocr-result.js tests/lib/ocr-result.test.js
git commit -m "feat: normalise tesseract output across major versions"
```

---

## Task 5: Offscreen OCR worker and service-worker routing

**Files:**
- Modify: `src/offscreen/offscreen.js`, `src/background/service-worker.js`
- Create: `scripts/make-fixture.mjs`, `tests/integration/ocr.test.js`, `tests/fixtures/sample-frame.png`

**Interfaces:**
- Consumes: `MSG`, `ERROR` from `src/lib/messages.js`; `normalizeRecognition` from `src/lib/ocr-result.js`.
- Produces:
  - Offscreen listens for `{type: MSG.OCR_RUN, target: 'offscreen', dataUrl, width, height}` and responds `{ok: true, result: OcrResult}` or `{ok: false, code: ERROR.OCR_FAILED}`.
  - Service worker responds to the same message shape sent from a content script, adding a 15s timeout and offscreen-document lifecycle.
  - `recognizeFrame(worker, dataUrl, width, height) → OcrResult` exported from `src/offscreen/ocr.js` for the integration test.

- [ ] **Step 1: Generate the golden test image**

```bash
npm install --save-dev @napi-rs/canvas
```

Create `scripts/make-fixture.mjs`:

```js
import { createCanvas } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';

const canvas = createCanvas(900, 320);
const ctx = canvas.getContext('2d');

ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, 900, 320);
ctx.fillStyle = '#000000';
ctx.font = '52px Helvetica';
ctx.fillText('The quick brown fox', 40, 110);
ctx.fillText('jumps over the lazy dog', 40, 210);

await mkdir('tests/fixtures', { recursive: true });
await writeFile('tests/fixtures/sample-frame.png', canvas.toBuffer('image/png'));
console.log('wrote tests/fixtures/sample-frame.png');
```

Run: `node scripts/make-fixture.mjs`
Expected: `tests/fixtures/sample-frame.png` exists. Open it and confirm both lines are legible black-on-white text.

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/ocr.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorker } from 'tesseract.js';
import { readFileSync } from 'node:fs';
import { recognizeFrame } from '../../src/offscreen/ocr.js';

let worker;

beforeAll(async () => {
  // In Node, Tesseract resolves these from the filesystem; in the extension
  // they are chrome-extension:// URLs. Same vendored files either way.
  worker = await createWorker('eng', 1, {
    langPath: 'vendor/tesseract/lang',
    gzip: true,
  });
}, 120_000);

afterAll(async () => {
  await worker?.terminate();
});

describe('recognizeFrame', () => {
  it('recovers both lines of text from a real image', async () => {
    const png = readFileSync('tests/fixtures/sample-frame.png');
    const result = await recognizeFrame(worker, png, 900, 320);

    expect(result.width).toBe(900);
    expect(result.height).toBe(320);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);

    const text = result.lines.map((line) => line.text).join(' ').toLowerCase();
    for (const expected of ['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog']) {
      expect(text).toContain(expected);
    }
  }, 120_000);

  it('returns word boxes inside the image bounds, ordered left to right', async () => {
    const png = readFileSync('tests/fixtures/sample-frame.png');
    const result = await recognizeFrame(worker, png, 900, 320);
    const words = result.lines[0].words;

    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.bbox.x0).toBeGreaterThanOrEqual(0);
      expect(w.bbox.x1).toBeLessThanOrEqual(900);
      expect(w.bbox.y1).toBeLessThanOrEqual(320);
    }
    for (let i = 1; i < words.length; i++) {
      expect(words[i].bbox.x0).toBeGreaterThan(words[i - 1].bbox.x0);
    }
  }, 120_000);
});
```

- [ ] **Step 3: Run the integration test to verify it fails**

Run: `npm run vendor && npx vitest run tests/integration/ocr.test.js`
Expected: FAIL — `Failed to load ../../src/offscreen/ocr.js`

- [ ] **Step 4: Implement `src/offscreen/ocr.js`**

```js
import { normalizeRecognition } from '../lib/ocr-result.js';

/**
 * Runs recognition and normalises the result. Kept free of any chrome.* API so
 * it can be exercised under Node in the integration test.
 *
 * @param {import('tesseract.js').Worker} worker
 * @param {string|Buffer|Blob} image data URL, buffer or blob
 */
export async function recognizeFrame(worker, image, width, height) {
  const { data } = await worker.recognize(image, {}, { blocks: true });
  return normalizeRecognition(data, width, height);
}
```

The `{blocks: true}` output flag is required on Tesseract v5+ — without it `data.blocks` is omitted and there are no word boxes at all, only a text dump.

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `npx vitest run tests/integration/ocr.test.js`
Expected: PASS (2 tests). First run takes 30–60s while the language model loads.

If `data.blocks` is empty but `data.text` has content, the installed Tesseract version takes a different output flag — inspect the raw `data` keys and extend `extractRawLines` in `src/lib/ocr-result.js` with a test for that shape rather than patching around it here.

- [ ] **Step 6: Implement the offscreen document**

Replace `src/offscreen/offscreen.js`:

```js
import { createWorker } from 'tesseract.js';
import { MSG, ERROR } from '../lib/messages.js';
import { recognizeFrame } from './ocr.js';

let workerPromise = null;

/**
 * One worker for the life of the document. Loading the language model costs
 * seconds, so only the first capture of a session should pay for it.
 */
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract/core/'),
      langPath: chrome.runtime.getURL('vendor/tesseract/lang'),
      // Tesseract defaults to spawning its worker from a blob: URL, which the
      // extension CSP rejects. Load it from the packaged file instead.
      workerBlobURL: false,
      gzip: true,
    });
  }
  return workerPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.type === MSG.OCR_PING) {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type !== MSG.OCR_RUN) return false;

  (async () => {
    try {
      const worker = await getWorker();
      const result = await recognizeFrame(
        worker,
        message.dataUrl,
        message.width,
        message.height
      );
      sendResponse({ ok: true, result });
    } catch (error) {
      console.error('[vts] ocr failed', error);
      // A failed worker is usually unrecoverable; drop it so the next
      // request builds a fresh one.
      workerPromise = null;
      sendResponse({ ok: false, code: ERROR.OCR_FAILED });
    }
  })();

  return true; // keep the message channel open for the async response
});
```

- [ ] **Step 7: Implement the service worker**

Replace `src/background/service-worker.js`:

```js
import { MSG, ERROR } from '../lib/messages.js';

const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const OCR_TIMEOUT_MS = 15_000;

let creating = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length > 0) return;

  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['WORKERS'],
        justification: 'Runs the Tesseract OCR worker under the extension CSP.',
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

function withTimeout(promise, ms, code) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const error = new Error(code);
        error.code = code;
        reject(error);
      }, ms)
    ),
  ]);
}

// The keyboard command is a user gesture, which is what grants activeTab.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-frame') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content/index.js'],
    });
  } catch (error) {
    // Restricted pages (chrome://, the Web Store) simply cannot be scripted.
    console.warn('[vts] injection refused', error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MSG.OCR_RUN || message.target === 'offscreen') return false;

  (async () => {
    try {
      await ensureOffscreenDocument();
      const response = await withTimeout(
        chrome.runtime.sendMessage({ ...message, target: 'offscreen' }),
        OCR_TIMEOUT_MS,
        ERROR.OCR_TIMEOUT
      );
      sendResponse(response ?? { ok: false, code: ERROR.OCR_FAILED });
    } catch (error) {
      sendResponse({ ok: false, code: error.code ?? ERROR.OCR_FAILED });
    }
  })();

  return true;
});
```

- [ ] **Step 8: Verify the OCR path end to end in the browser**

Run: `npm run build`, then reload the extension at `chrome://extensions`.

Open the service worker's console (the "service worker" link on the extension card) and run:

```js
await chrome.offscreen.createDocument({
  url: 'offscreen/offscreen.html',
  reasons: ['WORKERS'],
  justification: 'manual check',
});
await chrome.runtime.sendMessage({ type: 'vts:ocr-ping', target: 'offscreen' });
```

Expected: `{ok: true}`. If instead you see a CSP error about `blob:` or `wasm`, the `workerBlobURL: false` option or the manifest CSP is wrong — fix that before continuing, because nothing downstream will work.

- [ ] **Step 9: Run the full suite**

Run: `npm test && npm run test:integration`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/offscreen src/background scripts/make-fixture.mjs tests/integration tests/fixtures package.json package-lock.json
git commit -m "feat: run OCR in an offscreen document with service-worker routing"
```

---

## Task 6: Text layer geometry

The maths that puts each transparent word over its pixels. Pure, and the single most correctness-critical piece in the extension.

**Files:**
- Create: `src/content/overlay/text-layer.js`
- Test: `tests/content/overlay/text-layer.test.js`

**Interfaces:**
- Consumes: `OcrResult` from Task 4.
- Produces:
  - `layoutTextLayer(ocrResult, contentRect) → Layout`
  - `Layout` = `{lines: LayoutLine[]}`
  - `LayoutLine` = `{text:string, words: LayoutWord[]}`
  - `LayoutWord` = `{text:string, left:number, top:number, width:number, height:number, fontSize:number}` — CSS pixels relative to the overlay root, which is positioned at `contentRect`'s origin, so coordinates start at 0.
  - `layoutToText(layout) → string`

- [ ] **Step 1: Write the failing tests**

Create `tests/content/overlay/text-layer.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  layoutTextLayer,
  layoutToText,
} from '../../../src/content/overlay/text-layer.js';

const ocr = {
  width: 1000,
  height: 500,
  lines: [
    {
      text: 'The quick',
      words: [
        { text: 'The', bbox: { x0: 100, y0: 50, x1: 200, y1: 90 }, confidence: 95 },
        { text: 'quick', bbox: { x0: 220, y0: 50, x1: 380, y1: 90 }, confidence: 95 },
      ],
    },
    {
      text: 'brown fox',
      words: [
        { text: 'brown', bbox: { x0: 100, y0: 150, x1: 260, y1: 190 }, confidence: 95 },
        { text: 'fox', bbox: { x0: 280, y0: 150, x1: 380, y1: 190 }, confidence: 95 },
      ],
    },
  ],
};

describe('layoutTextLayer', () => {
  it('maps image pixels 1:1 when the frame is displayed at capture size', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(layout.lines[0].words[0]).toEqual({
      text: 'The',
      left: 100,
      top: 50,
      width: 100,
      height: 40,
      fontSize: 40,
    });
  });

  it('scales down when the frame is displayed smaller than captured', () => {
    // 1000px capture shown in a 500px box -> everything halves.
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 500, height: 250 });
    expect(layout.lines[0].words[0]).toEqual({
      text: 'The',
      left: 50,
      top: 25,
      width: 50,
      height: 20,
      fontSize: 20,
    });
  });

  it('scales up when the frame is displayed larger than captured', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 2000, height: 1000 });
    expect(layout.lines[0].words[1].left).toBe(440);
    expect(layout.lines[0].words[1].width).toBe(320);
  });

  it('produces coordinates relative to the overlay root, not the viewport', () => {
    // contentRect's offset is where the overlay root itself is placed, so word
    // coordinates inside it must NOT include that offset again.
    const offset = layoutTextLayer(ocr, {
      left: 300,
      top: 200,
      width: 1000,
      height: 500,
    });
    const origin = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(offset.lines[0].words[0]).toEqual(origin.lines[0].words[0]);
  });

  it('preserves line grouping and reading order', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines.map((line) => line.text)).toEqual(['The quick', 'brown fox']);
  });

  it('returns an empty layout for a result with no lines', () => {
    const empty = layoutTextLayer({ width: 100, height: 100, lines: [] }, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(empty.lines).toEqual([]);
  });

  it('survives a zero-width content rect without producing NaN', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 0, height: 0 });
    for (const word of layout.lines[0].words) {
      expect(Number.isFinite(word.left)).toBe(true);
      expect(Number.isFinite(word.fontSize)).toBe(true);
    }
  });
});

describe('layoutToText', () => {
  it('joins words with spaces and lines with newlines', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(layoutToText(layout)).toBe('The quick\nbrown fox');
  });

  it('returns an empty string for an empty layout', () => {
    expect(layoutToText({ lines: [] })).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/content/overlay/text-layer.test.js`
Expected: FAIL — `Failed to load .../text-layer.js`

- [ ] **Step 3: Implement the layout maths**

Create `src/content/overlay/text-layer.js`:

```js
/**
 * @typedef {{text:string, left:number, top:number, width:number, height:number, fontSize:number}} LayoutWord
 * @typedef {{text:string, words:LayoutWord[]}} LayoutLine
 * @typedef {{lines:LayoutLine[]}} Layout
 */

/**
 * Convert OCR boxes from captured-image pixels into CSS pixels relative to the
 * overlay root. The root is itself positioned at `contentRect`, so the offset
 * is deliberately NOT added here — doing so would double-count it.
 *
 * @param {{width:number, height:number, lines:Array}} ocrResult
 * @param {{left:number, top:number, width:number, height:number}} contentRect
 * @returns {Layout}
 */
export function layoutTextLayer(ocrResult, contentRect) {
  const scale = ocrResult.width > 0 ? contentRect.width / ocrResult.width : 0;

  const lines = ocrResult.lines.map((line) => ({
    text: line.text,
    words: line.words.map((word) => {
      const height = (word.bbox.y1 - word.bbox.y0) * scale;
      return {
        text: word.text,
        left: word.bbox.x0 * scale,
        top: word.bbox.y0 * scale,
        width: (word.bbox.x1 - word.bbox.x0) * scale,
        height,
        // Start from the box height; the render step corrects the horizontal
        // fit with a transform once the glyphs have actually been measured.
        fontSize: height,
      };
    }),
  }));

  return { lines };
}

/** Plain-text rendering of a layout, for the Copy all button. */
export function layoutToText(layout) {
  return layout.lines.map((line) => line.words.map((w) => w.text).join(' ')).join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/content/overlay/text-layer.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/content/overlay/text-layer.js tests/content/overlay/text-layer.test.js
git commit -m "feat: add text layer geometry mapping OCR boxes to CSS pixels"
```

---

## Task 7: Text layer rendering

**Files:**
- Modify: `src/content/overlay/text-layer.js`
- Test: `tests/content/overlay/text-layer-render.test.js`

**Interfaces:**
- Consumes: `Layout` from Task 6.
- Produces: `renderTextLayer(layout, doc) → HTMLElement` — a `<div class="vts-text-layer">` containing one `<div class="vts-line">` per line, each holding `<span class="vts-word">` elements separated by literal space text nodes.

- [ ] **Step 1: Write the failing tests**

Create `tests/content/overlay/text-layer-render.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  layoutTextLayer,
  renderTextLayer,
} from '../../../src/content/overlay/text-layer.js';

const ocr = {
  width: 1000,
  height: 500,
  lines: [
    {
      text: 'The quick',
      words: [
        { text: 'The', bbox: { x0: 100, y0: 50, x1: 200, y1: 90 }, confidence: 95 },
        { text: 'quick', bbox: { x0: 220, y0: 50, x1: 380, y1: 90 }, confidence: 95 },
      ],
    },
    {
      text: 'brown fox',
      words: [
        { text: 'brown', bbox: { x0: 100, y0: 150, x1: 260, y1: 190 }, confidence: 95 },
      ],
    },
  ],
};

const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });

describe('renderTextLayer', () => {
  it('creates one line element per OCR line', () => {
    const root = renderTextLayer(layout, document);
    expect(root.querySelectorAll('.vts-line')).toHaveLength(2);
  });

  it('creates one span per word, in reading order', () => {
    const root = renderTextLayer(layout, document);
    const words = [...root.querySelectorAll('.vts-word')].map((el) => el.textContent);
    expect(words).toEqual(['The', 'quick', 'brown']);
  });

  it('separates words with real whitespace text nodes', () => {
    // Without these, Cmd+C yields "Thequick" rather than "The quick".
    const root = renderTextLayer(layout, document);
    const firstLine = root.querySelector('.vts-line');
    expect(firstLine.textContent).toBe('The quick');
  });

  it('positions each span at its layout coordinates', () => {
    const root = renderTextLayer(layout, document);
    const span = root.querySelector('.vts-word');
    expect(span.style.left).toBe('100px');
    expect(span.style.top).toBe('50px');
    expect(span.style.fontSize).toBe('40px');
  });

  it('marks each span with its target width for post-measurement fitting', () => {
    const root = renderTextLayer(layout, document);
    const span = root.querySelector('.vts-word');
    expect(span.dataset.width).toBe('100');
  });

  it('renders an empty container for an empty layout', () => {
    const root = renderTextLayer({ lines: [] }, document);
    expect(root.querySelectorAll('.vts-word')).toHaveLength(0);
    expect(root.className).toBe('vts-text-layer');
  });
});

describe('fitSpanWidths', () => {
  it('applies a horizontal scale so glyph width matches the measured box', async () => {
    const { fitSpanWidths } = await import(
      '../../../src/content/overlay/text-layer.js'
    );
    const root = renderTextLayer(layout, document);
    const span = root.querySelector('.vts-word');
    // jsdom reports zero-width layout, so feed the measurement in directly.
    fitSpanWidths(root, () => 50);
    expect(span.style.transform).toBe('scaleX(2)');
  });

  it('leaves spans untouched when they cannot be measured', async () => {
    const { fitSpanWidths } = await import(
      '../../../src/content/overlay/text-layer.js'
    );
    const root = renderTextLayer(layout, document);
    fitSpanWidths(root, () => 0);
    expect(root.querySelector('.vts-word').style.transform).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/content/overlay/text-layer-render.test.js`
Expected: FAIL — `renderTextLayer is not a function`

- [ ] **Step 3: Implement rendering**

Append to `src/content/overlay/text-layer.js`:

```js
/**
 * Build the invisible, selectable DOM. Each word is a real text node so the
 * browser's own selection, highlight, double-click-word and clipboard handling
 * do all the work; nothing here implements copying.
 *
 * @param {Layout} layout
 * @param {Document} doc
 * @returns {HTMLElement}
 */
export function renderTextLayer(layout, doc) {
  const root = doc.createElement('div');
  root.className = 'vts-text-layer';

  for (const line of layout.lines) {
    const lineElement = doc.createElement('div');
    lineElement.className = 'vts-line';

    line.words.forEach((word, index) => {
      // A block element per line plus spaces between words is what makes the
      // copied text come out as "The quick brown fox\njumps over".
      if (index > 0) lineElement.appendChild(doc.createTextNode(' '));

      const span = doc.createElement('span');
      span.className = 'vts-word';
      span.textContent = word.text;
      span.style.left = `${word.left}px`;
      span.style.top = `${word.top}px`;
      span.style.height = `${word.height}px`;
      span.style.fontSize = `${word.fontSize}px`;
      span.dataset.width = String(word.width);
      lineElement.appendChild(span);
    });

    root.appendChild(lineElement);
  }

  return root;
}

/**
 * Squeeze or stretch each span horizontally so its glyphs span exactly the
 * width Tesseract measured. This is the pdf.js technique — without it the
 * selection highlight drifts away from the letters across a long line.
 *
 * @param {HTMLElement} root
 * @param {(span: HTMLElement) => number} measure injected for testability
 */
export function fitSpanWidths(root, measure = (span) => span.getBoundingClientRect().width) {
  for (const span of root.querySelectorAll('.vts-word')) {
    const target = Number(span.dataset.width);
    const natural = measure(span);
    if (!natural || !target) continue;
    span.style.transform = `scaleX(${target / natural})`;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/content/overlay/text-layer-render.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/content/overlay/text-layer.js tests/content/overlay/text-layer-render.test.js
git commit -m "feat: render invisible selectable spans for recognised words"
```

---

## Task 8: The overlay shell

**Files:**
- Create: `src/content/overlay/overlay.js`, `src/content/overlay/overlay.css`
- Test: `tests/content/overlay/overlay.test.js`

**Interfaces:**
- Consumes: `renderTextLayer`, `fitSpanWidths`, `layoutToText` from Task 7; `ERROR_MESSAGE` from `src/lib/messages.js`.
- Produces: `mountOverlay({frame, contentRect, doc, onDismiss}) → OverlayHandle` where
  - `frame` = `{dataUrl, width, height}`
  - `OverlayHandle` = `{host, shadow, setLayout(layout), setStatus(text), setError(code), destroy()}`

- [ ] **Step 1: Write `src/content/overlay/overlay.css`**

```css
:host {
  all: initial;
}

.vts-root {
  position: fixed;
  z-index: 2147483647;
  overflow: hidden;
  cursor: text;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  contain: layout paint;
}

.vts-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.vts-text-layer {
  position: absolute;
  inset: 0;
  user-select: text;
  -webkit-user-select: text;
}

.vts-line {
  position: static;
}

.vts-word {
  position: absolute;
  color: transparent;
  white-space: pre;
  transform-origin: 0 0;
  line-height: 1;
  cursor: text;
}

.vts-word::selection {
  background: rgba(0, 122, 255, 0.4);
  color: transparent;
}

.vts-controls {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  gap: 8px;
  user-select: none;
}

.vts-button {
  appearance: none;
  border: 0;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: inherit;
  color: #fff;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  cursor: pointer;
}

.vts-button:hover {
  background: rgba(0, 0, 0, 0.85);
}

.vts-status {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #fff;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  user-select: none;
}

.vts-status[hidden] {
  display: none;
}

/* Scanning shimmer while OCR runs. */
.vts-root[data-state='scanning']::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    transparent 40%,
    rgba(255, 255, 255, 0.25) 50%,
    transparent 60%
  );
  background-size: 300% 100%;
  animation: vts-shimmer 1.2s linear infinite;
}

@keyframes vts-shimmer {
  from { background-position: 150% 0; }
  to { background-position: -150% 0; }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/content/overlay/overlay.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountOverlay } from '../../../src/content/overlay/overlay.js';
import { layoutTextLayer } from '../../../src/content/overlay/text-layer.js';
import { ERROR, ERROR_MESSAGE } from '../../../src/lib/messages.js';

const frame = { dataUrl: 'data:image/png;base64,AAAA', width: 1000, height: 500 };
const contentRect = { left: 40, top: 20, width: 500, height: 250 };

function mount(overrides = {}) {
  return mountOverlay({ frame, contentRect, doc: document, ...overrides });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('mountOverlay', () => {
  it('attaches a shadow root so page CSS cannot reach it', () => {
    const handle = mount();
    expect(handle.host.shadowRoot ?? handle.shadow).toBeTruthy();
    expect(handle.shadow.querySelector('.vts-root')).toBeTruthy();
  });

  it('positions the root at the content rect, not the element rect', () => {
    const handle = mount();
    const root = handle.shadow.querySelector('.vts-root');
    expect(root.style.left).toBe('40px');
    expect(root.style.top).toBe('20px');
    expect(root.style.width).toBe('500px');
    expect(root.style.height).toBe('250px');
  });

  it('shows the captured frame as the backdrop', () => {
    const handle = mount();
    expect(handle.shadow.querySelector('.vts-frame').src).toBe(frame.dataUrl);
  });

  it('starts in the scanning state', () => {
    const handle = mount();
    expect(handle.shadow.querySelector('.vts-root').dataset.state).toBe('scanning');
  });

  it('attaches to the fullscreen element when one is present', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: container,
    });

    const handle = mount();
    expect(handle.host.parentElement).toBe(container);

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  it('inserts the text layer and leaves the scanning state on setLayout', () => {
    const handle = mount();
    const layout = layoutTextLayer(
      {
        width: 1000,
        height: 500,
        lines: [
          {
            text: 'hello',
            words: [
              { text: 'hello', bbox: { x0: 0, y0: 0, x1: 100, y1: 40 }, confidence: 95 },
            ],
          },
        ],
      },
      contentRect
    );

    handle.setLayout(layout);

    expect(handle.shadow.querySelectorAll('.vts-word')).toHaveLength(1);
    expect(handle.shadow.querySelector('.vts-root').dataset.state).toBe('ready');
  });

  it('shows a human-readable message for an error code', () => {
    const handle = mount();
    handle.setError(ERROR.NO_TEXT);
    const status = handle.shadow.querySelector('.vts-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(ERROR_MESSAGE[ERROR.NO_TEXT]);
  });

  it('copies all text when Copy all is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const handle = mount();
    handle.setLayout(
      layoutTextLayer(
        {
          width: 1000,
          height: 500,
          lines: [
            {
              text: 'hello world',
              words: [
                { text: 'hello', bbox: { x0: 0, y0: 0, x1: 80, y1: 40 }, confidence: 95 },
                { text: 'world', bbox: { x0: 90, y0: 0, x1: 180, y1: 40 }, confidence: 95 },
              ],
            },
          ],
        },
        contentRect
      )
    );

    handle.shadow.querySelector('[data-action="copy-all"]').click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('calls onDismiss and removes itself when Escape is pressed', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(handle.host.isConnected).toBe(false);
  });

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });
    handle.shadow.querySelector('[data-action="close"]').click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss twice when destroyed after dismissal', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });
    handle.shadow.querySelector('[data-action="close"]').click();
    handle.destroy();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Escape once destroyed', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });
    handle.destroy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/content/overlay/overlay.test.js`
Expected: FAIL — `Failed to load .../overlay.js`

- [ ] **Step 4: Implement `src/content/overlay/overlay.js`**

```js
import css from './overlay.css';
import { renderTextLayer, fitSpanWidths, layoutToText } from './text-layer.js';
import { ERROR_MESSAGE } from '../../lib/messages.js';

/**
 * @param {{
 *   frame: {dataUrl:string, width:number, height:number},
 *   contentRect: {left:number, top:number, width:number, height:number},
 *   doc?: Document,
 *   onDismiss?: () => void,
 * }} options
 */
export function mountOverlay({ frame, contentRect, doc = document, onDismiss = () => {} }) {
  const host = doc.createElement('div');
  host.style.all = 'initial';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  const root = doc.createElement('div');
  root.className = 'vts-root';
  root.dataset.state = 'scanning';
  applyRect(root, contentRect);

  const image = doc.createElement('img');
  image.className = 'vts-frame';
  image.src = frame.dataUrl;
  image.alt = '';
  root.appendChild(image);

  const status = doc.createElement('div');
  status.className = 'vts-status';
  status.hidden = true;
  root.appendChild(status);

  const controls = doc.createElement('div');
  controls.className = 'vts-controls';
  const copyAll = button(doc, 'Copy all', 'copy-all');
  const close = button(doc, 'Close', 'close');
  controls.append(copyAll, close);
  root.appendChild(controls);

  shadow.appendChild(root);

  // A fullscreen video renders above everything in the normal DOM, so an
  // overlay on document.body would simply be invisible.
  const container = doc.fullscreenElement ?? doc.body;
  container.appendChild(host);

  let textLayer = null;
  let currentLayout = { lines: [] };
  let dismissed = false;

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
    }
  }

  doc.addEventListener('keydown', onKeyDown, true);

  function teardown() {
    doc.removeEventListener('keydown', onKeyDown, true);
    host.remove();
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    teardown();
    onDismiss();
  }

  close.addEventListener('click', dismiss);
  copyAll.addEventListener('click', () => {
    navigator.clipboard.writeText(layoutToText(currentLayout)).then(
      () => setStatus('Copied'),
      () => setStatus('Could not copy')
    );
  });

  function setStatus(text) {
    status.textContent = text;
    status.hidden = false;
  }

  return {
    host,
    shadow,
    setLayout(layout) {
      currentLayout = layout;
      textLayer?.remove();
      textLayer = renderTextLayer(layout, doc);
      root.appendChild(textLayer);
      fitSpanWidths(textLayer);
      root.dataset.state = 'ready';
    },
    setStatus,
    setError(code) {
      root.dataset.state = 'ready';
      setStatus(ERROR_MESSAGE[code] ?? ERROR_MESSAGE.unknown);
    },
    reposition(rect) {
      applyRect(root, rect);
    },
    destroy() {
      if (dismissed) return;
      dismissed = true;
      teardown();
    },
  };
}

function applyRect(element, rect) {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function button(doc, label, action) {
  const element = doc.createElement('button');
  element.className = 'vts-button';
  element.textContent = label;
  element.dataset.action = action;
  return element;
}
```

- [ ] **Step 5: Teach Vitest to import CSS as text**

esbuild handles `import css from './overlay.css'` via the loader configured in Task 1, but Vitest needs the same treatment. Add to `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
  plugins: [
    {
      name: 'css-as-text',
      transform(code, id) {
        if (!id.endsWith('.css')) return null;
        return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/content/overlay/overlay.test.js`
Expected: PASS (13 tests)

- [ ] **Step 7: Commit**

```bash
git add src/content/overlay/overlay.js src/content/overlay/overlay.css vitest.config.js tests/content/overlay/overlay.test.js
git commit -m "feat: add shadow-DOM overlay shell with frozen frame and controls"
```

---

## Task 9: Content-script orchestration

**Files:**
- Modify: `src/content/index.js`
- Create: `src/content/toast.js`
- Test: `tests/content/index.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2, 3, 6, 7, 8.
- Produces: `runCapture(deps) → Promise<void>` — the whole flow with every dependency injectable, plus a default-wired invocation at module scope guarded so repeated injection does not stack overlays.

- [ ] **Step 1: Write `src/content/toast.js`**

```js
const TOAST_MS = 2600;

/** Transient message for failures that never get as far as an overlay. */
export function showToast(text, doc = document) {
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .toast {
        position: fixed;
        left: 50%;
        bottom: 48px;
        transform: translateX(-50%);
        z-index: 2147483647;
        padding: 10px 16px;
        border-radius: 8px;
        font: 13px -apple-system, BlinkMacSystemFont, sans-serif;
        color: #fff;
        background: rgba(0, 0, 0, 0.82);
        backdrop-filter: blur(8px);
        pointer-events: none;
      }
    </style>
    <div class="toast"></div>
  `;
  shadow.querySelector('.toast').textContent = text;
  doc.body.appendChild(host);
  setTimeout(() => host.remove(), TOAST_MS);
  return host;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/content/index.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { runCapture } from '../../src/content/index.js';
import { ERROR, ERROR_MESSAGE } from '../../src/lib/messages.js';

const candidate = {
  id: 'v1',
  kind: 'video',
  rect: { left: 40, top: 20, width: 500, height: 250 },
  intrinsicWidth: 1000,
  intrinsicHeight: 500,
  paused: false,
  objectFit: 'contain',
};

const frame = { dataUrl: 'data:image/png;base64,AAAA', width: 1000, height: 500 };

const ocrResult = {
  width: 1000,
  height: 500,
  lines: [
    {
      text: 'hello',
      words: [
        { text: 'hello', bbox: { x0: 0, y0: 0, x1: 100, y1: 40 }, confidence: 95 },
      ],
    },
  ],
};

function makeDeps(overrides = {}) {
  const element = { pause: vi.fn() };
  const handle = {
    setLayout: vi.fn(),
    setError: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    element,
    handle,
    deps: {
      collectCandidates: vi.fn(() => [{ ...candidate, element }]),
      captureFrame: vi.fn(() => frame),
      mountOverlay: vi.fn(() => handle),
      requestOcr: vi.fn(async () => ({ ok: true, result: ocrResult })),
      showToast: vi.fn(),
      viewport: { width: 1000, height: 800 },
      doc: document,
      ...overrides,
    },
  };
}

describe('runCapture', () => {
  it('pauses a playing video before capturing', async () => {
    const { element, deps } = makeDeps();
    await runCapture(deps);
    expect(element.pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause a video that was already paused', async () => {
    const element = { pause: vi.fn() };
    const { deps } = makeDeps({
      collectCandidates: () => [{ ...candidate, paused: true, element }],
    });
    await runCapture(deps);
    expect(element.pause).not.toHaveBeenCalled();
  });

  it('mounts the overlay at the content rect, not the element rect', async () => {
    const { deps } = makeDeps();
    await runCapture(deps);
    // 1000x500 content in a 500x250 box already matches: no letterboxing.
    expect(deps.mountOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        frame,
        contentRect: { left: 40, top: 20, width: 500, height: 250 },
      })
    );
  });

  it('mounts the overlay before OCR completes so the user sees the frozen frame', async () => {
    const order = [];
    const { deps } = makeDeps({
      mountOverlay: vi.fn(() => {
        order.push('mount');
        return { setLayout: vi.fn(), setError: vi.fn(), destroy: vi.fn() };
      }),
      requestOcr: vi.fn(async () => {
        order.push('ocr');
        return { ok: true, result: ocrResult };
      }),
    });
    await runCapture(deps);
    expect(order).toEqual(['mount', 'ocr']);
  });

  it('hands the laid-out text to the overlay on success', async () => {
    const { handle, deps } = makeDeps();
    await runCapture(deps);
    const layout = handle.setLayout.mock.calls[0][0];
    expect(layout.lines[0].words[0].text).toBe('hello');
  });

  it('toasts and does not mount when there is no target', async () => {
    const { deps } = makeDeps({ collectCandidates: () => [] });
    await runCapture(deps);
    expect(deps.showToast).toHaveBeenCalledWith(
      ERROR_MESSAGE[ERROR.NO_TARGET],
      document
    );
    expect(deps.mountOverlay).not.toHaveBeenCalled();
  });

  it('toasts and resumes playback when capture is blocked', async () => {
    const element = { pause: vi.fn(), play: vi.fn() };
    const { deps } = makeDeps({
      collectCandidates: () => [{ ...candidate, element }],
      captureFrame: () => {
        const error = new Error('blocked');
        error.code = ERROR.BLOCKED;
        throw error;
      },
    });

    await runCapture(deps);

    expect(deps.showToast).toHaveBeenCalledWith(ERROR_MESSAGE[ERROR.BLOCKED], document);
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it('reports an OCR failure on the overlay rather than tearing it down', async () => {
    const { handle, deps } = makeDeps({
      requestOcr: async () => ({ ok: false, code: ERROR.OCR_TIMEOUT }),
    });
    await runCapture(deps);
    expect(handle.setError).toHaveBeenCalledWith(ERROR.OCR_TIMEOUT);
    expect(handle.destroy).not.toHaveBeenCalled();
  });

  it('reports NO_TEXT when OCR succeeds but finds nothing', async () => {
    const { handle, deps } = makeDeps({
      requestOcr: async () => ({ ok: true, result: { width: 1000, height: 500, lines: [] } }),
    });
    await runCapture(deps);
    expect(handle.setError).toHaveBeenCalledWith(ERROR.NO_TEXT);
  });

  it('resumes playback on dismiss only if it was the one that paused', async () => {
    const element = { pause: vi.fn(), play: vi.fn() };
    const { deps } = makeDeps({ collectCandidates: () => [{ ...candidate, element }] });
    await runCapture(deps);

    deps.mountOverlay.mock.calls[0][0].onDismiss();
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-paused video paused on dismiss', async () => {
    const element = { pause: vi.fn(), play: vi.fn() };
    const { deps } = makeDeps({
      collectCandidates: () => [{ ...candidate, paused: true, element }],
    });
    await runCapture(deps);

    deps.mountOverlay.mock.calls[0][0].onDismiss();
    expect(element.play).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/content/index.test.js`
Expected: FAIL — `runCapture is not a function`

- [ ] **Step 4: Implement `src/content/index.js`**

```js
import { collectCandidates, pickTarget, computeContentRect } from './video-target.js';
import { captureFrame, classifyCaptureError } from './capture.js';
import { mountOverlay } from './overlay/overlay.js';
import { layoutTextLayer } from './overlay/text-layer.js';
import { showToast } from './toast.js';
import { MSG, ERROR, ERROR_MESSAGE } from '../lib/messages.js';

async function requestOcr(frame) {
  return chrome.runtime.sendMessage({
    type: MSG.OCR_RUN,
    dataUrl: frame.dataUrl,
    width: frame.width,
    height: frame.height,
  });
}

/**
 * The whole flow, with every collaborator injectable so it can be driven under
 * jsdom without chrome.* or a real <video>.
 */
export async function runCapture(deps = {}) {
  const {
    collectCandidates: collect = collectCandidates,
    captureFrame: capture = captureFrame,
    mountOverlay: mount = mountOverlay,
    requestOcr: ocr = requestOcr,
    showToast: toast = showToast,
    doc = document,
    viewport = { width: window.innerWidth, height: window.innerHeight },
  } = deps;

  const target = pickTarget(collect(doc), viewport);
  if (!target) {
    toast(ERROR_MESSAGE[ERROR.NO_TARGET], doc);
    return;
  }

  const { element } = target;
  const pausedByUs = target.kind === 'video' && !target.paused;
  if (pausedByUs) element.pause();

  const resume = () => {
    if (pausedByUs) element.play?.();
  };

  let frame;
  try {
    frame = capture(element, target);
  } catch (error) {
    toast(ERROR_MESSAGE[classifyCaptureError(error)] ?? ERROR_MESSAGE[ERROR.UNKNOWN], doc);
    resume();
    return;
  }

  const contentRect = computeContentRect(
    target.rect,
    target.intrinsicWidth,
    target.intrinsicHeight,
    target.objectFit
  );

  // Mount before OCR: the user should see the frame freeze instantly, with the
  // scanning shimmer explaining the couple of seconds that follow.
  const overlay = mount({ frame, contentRect, doc, onDismiss: resume });

  let response;
  try {
    response = await ocr(frame);
  } catch {
    response = { ok: false, code: ERROR.OCR_FAILED };
  }

  if (!response?.ok) {
    overlay.setError(response?.code ?? ERROR.OCR_FAILED);
    return;
  }

  if (response.result.lines.length === 0) {
    overlay.setError(ERROR.NO_TEXT);
    return;
  }

  overlay.setLayout(layoutTextLayer(response.result, contentRect));
}

// Re-injection is how a second keypress arrives, so guard against stacking.
if (typeof window !== 'undefined' && !window.__vtsRunning) {
  window.__vtsRunning = true;
  runCapture()
    .catch((error) => console.error('[vts]', error))
    .finally(() => {
      window.__vtsRunning = false;
    });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/content/index.test.js`
Expected: PASS (11 tests)

If the module-scope block runs during the test and throws on `chrome` being undefined, confirm the guard sits behind `typeof window !== 'undefined'` and that `runCapture()`'s default `requestOcr` is only reached at call time — the test never calls it.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS across all files.

- [ ] **Step 7: Verify in the real browser**

Run: `npm run build`, reload the extension, open a YouTube video with visible on-screen text (a conference talk with slides is ideal), and press `Cmd+Shift+S`.

Expected: the video pauses, the frame freezes with a shimmer, and within a few seconds you can drag across the on-screen text and press Cmd+C. Esc dismisses and playback resumes.

- [ ] **Step 8: Commit**

```bash
git add src/content/index.js src/content/toast.js tests/content/index.test.js
git commit -m "feat: wire capture, OCR and overlay into the content script flow"
```

---

## Task 10: Overlay repositioning, README and manual E2E pass

**Files:**
- Modify: `src/content/index.js`
- Create: `README.md`, `docs/manual-test-checklist.md`
- Test: `tests/content/reposition.test.js`

**Interfaces:**
- Consumes: `OverlayHandle.reposition(rect)` from Task 8.
- Produces: `trackTarget(target, overlay, options) → () => void` — starts tracking, returns a stop function.

- [ ] **Step 1: Write the failing test**

Create `tests/content/reposition.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { trackTarget } from '../../src/content/index.js';

const target = {
  intrinsicWidth: 1000,
  intrinsicHeight: 500,
  objectFit: 'contain',
  element: {},
};

describe('trackTarget', () => {
  it('repositions the overlay when the page scrolls', () => {
    const overlay = { reposition: vi.fn() };
    const stop = trackTarget(target, overlay, {
      doc: document,
      measure: () => ({ left: 0, top: 100, width: 500, height: 250 }),
      schedule: (fn) => fn(),
    });

    window.dispatchEvent(new Event('scroll'));

    expect(overlay.reposition).toHaveBeenCalledWith({
      left: 0,
      top: 100,
      width: 500,
      height: 250,
    });
    stop();
  });

  it('repositions on resize', () => {
    const overlay = { reposition: vi.fn() };
    const stop = trackTarget(target, overlay, {
      doc: document,
      measure: () => ({ left: 0, top: 0, width: 800, height: 400 }),
      schedule: (fn) => fn(),
    });

    window.dispatchEvent(new Event('resize'));

    expect(overlay.reposition).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops repositioning once stopped', () => {
    const overlay = { reposition: vi.fn() };
    const stop = trackTarget(target, overlay, {
      doc: document,
      measure: () => ({ left: 0, top: 0, width: 100, height: 50 }),
      schedule: (fn) => fn(),
    });

    stop();
    window.dispatchEvent(new Event('scroll'));

    expect(overlay.reposition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/content/reposition.test.js`
Expected: FAIL — `trackTarget is not a function`

- [ ] **Step 3: Implement `trackTarget` and wire it in**

Add to `src/content/index.js`:

```js
/**
 * Keep the overlay glued to the element while the page scrolls or reflows.
 * Measurement and scheduling are injected so this is testable without layout.
 *
 * @returns {() => void} stop
 */
export function trackTarget(target, overlay, options = {}) {
  const {
    doc = document,
    schedule = requestAnimationFrame,
    measure = () => {
      const rect = target.element.getBoundingClientRect();
      return computeContentRect(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        target.intrinsicWidth,
        target.intrinsicHeight,
        target.objectFit
      );
    },
  } = options;

  let stopped = false;
  let queued = false;

  const update = () => {
    if (stopped || queued) return;
    queued = true;
    schedule(() => {
      queued = false;
      if (!stopped) overlay.reposition(measure());
    });
  };

  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  doc.addEventListener('fullscreenchange', update);

  return () => {
    stopped = true;
    window.removeEventListener('scroll', update, true);
    window.removeEventListener('resize', update);
    doc.removeEventListener('fullscreenchange', update);
  };
}
```

Then wire it into `runCapture`, immediately after the overlay is mounted. Replace the existing `const overlay = mount(...)` line with:

```js
  let stopTracking = () => {};
  const overlay = mount({
    frame,
    contentRect,
    doc,
    onDismiss: () => {
      stopTracking();
      resume();
    },
  });
  stopTracking = trackTarget(target, overlay, { doc });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/content/reposition.test.js && npm test`
Expected: PASS across every file, including the Task 9 tests — `onDismiss` still resumes playback, now via the wrapper.

- [ ] **Step 5: Write `README.md`**

```markdown
# Video Text Select

Pause a video and select text straight out of the picture, the way macOS Live Text
works on images. Everything runs locally — no API keys, no network, no video frame
ever leaves your machine.

## Install

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**,
and select the `dist/` directory.

## Use

Press **Cmd+Shift+S** (Ctrl+Shift+S on Windows/Linux) while a video is playing.
The video pauses, the frame freezes, and after a moment you can drag across any
text in the picture and copy it with Cmd+C — or use **Copy all**.

Press **Esc** to dismiss. Playback resumes only if the extension was what paused it.

Rebind the shortcut at `chrome://extensions/shortcuts`.

## What works

Ordinary HTML5 `<video>` elements — YouTube, Vimeo, self-hosted players, embedded
players inside iframes, meeting and screen-share recordings — plus canvas-based
players.

## What does not

DRM-protected services (Netflix, Disney+, Prime Video) hand back a black frame by
design; the extension detects this and says so rather than showing you an empty
overlay. English only.

## Development

```bash
npm test              # unit tests
npm run test:integration  # golden-image OCR test (slow)
npm run build         # bundle to dist/
```
```

- [ ] **Step 6: Write `docs/manual-test-checklist.md`**

```markdown
# Manual test checklist

Run after any change to capture, overlay or geometry code. Build and reload the
extension first.

## Core paths

- [ ] **YouTube, inline** — a talk with slides. Frame freezes, text selectable,
      Cmd+C yields the right text with line breaks intact.
- [ ] **YouTube, fullscreen** — overlay is visible (this is the case that breaks
      if the fullscreen attachment point regresses).
- [ ] **YouTube, theatre mode** — overlay covers the resized player correctly.
- [ ] **Embedded player in an iframe** — any site embedding a YouTube or Vimeo
      video. The overlay appears over the embed, not the host page.
- [ ] **Plain `<video>`** — any direct .mp4 link.
- [ ] **Canvas-based player** — a Twitch clip or similar.

## Geometry

- [ ] **Letterboxed video** (4:3 content in a wide player) — text boxes sit on the
      letters, not offset into the black bars.
- [ ] **Scroll while the overlay is open** — the overlay follows the video.
- [ ] **Resize the window while open** — the overlay tracks and rescales.

## Selection fidelity

- [ ] Drag across a partial phrase mid-line — selection starts and ends where the
      cursor is, not at word boundaries.
- [ ] Double-click a word — selects that word only.
- [ ] Drag across two lines — copied text contains a newline between them.
- [ ] Right-click a selection — Chrome's Copy appears and works.
- [ ] **Copy all** — copies every recognised line in reading order.

## Failure paths

- [ ] **Netflix or another DRM service** — "This player blocks frame capture",
      no empty overlay, playback resumes.
- [ ] **A page with no video** — "No video found on this page".
- [ ] **A frame with no text** (a blank scene) — overlay stays up showing the
      frame with "No text found in this frame".
- [ ] **A restricted page** (`chrome://extensions`) — nothing happens, no crash
      in the service worker console.

## Lifecycle

- [ ] Esc after the extension paused the video — playback resumes.
- [ ] Esc after you paused the video yourself — stays paused.
- [ ] Press the shortcut twice quickly — one overlay, not two.
- [ ] Second capture in the same session is noticeably faster than the first
      (the Tesseract worker stays warm).
```

- [ ] **Step 7: Work through the manual checklist**

Run: `npm run build`, reload the extension, and complete every box in
`docs/manual-test-checklist.md`. Record any failure as a bug to fix before
declaring the feature done — do not tick a box you have not actually exercised.

- [ ] **Step 8: Commit**

```bash
git add src/content/index.js tests/content/reposition.test.js README.md docs/manual-test-checklist.md
git commit -m "feat: track target on scroll and resize, add docs and manual checklist"
```

---

## Self-Review Notes

**Spec coverage:** every section of the design maps to a task — permissions and manifest (1), target selection and content-rect maths (2), capture with blank-frame detection and error classification (3), Tesseract normalisation (4), offscreen worker and service-worker routing with the 15s timeout (5), text layer geometry (6), transparent span rendering with the pdf.js `scaleX` fit (7), shadow-DOM overlay with fullscreen attachment and resume semantics (8), orchestration and every error path from the spec's error table (9), repositioning and the spec's manual E2E checklist (10).

**Known deviations from the spec, both deliberate:**
- The spec's error table lists a `NOT_READY` case for zero intrinsic dimensions. `pickTarget` filters those candidates out first, so in practice such an element surfaces as `NO_TARGET`. `NOT_READY` is retained in `captureFrame` as a guard for the race where a video unloads between selection and capture.
- Capture is capped at 2560px wide (Task 3). The spec says "intrinsic resolution"; the cap only affects 4K sources, keeps the data URL passable between contexts, and is transparent to the geometry because all scaling derives from the captured image width rather than the intrinsic width.
