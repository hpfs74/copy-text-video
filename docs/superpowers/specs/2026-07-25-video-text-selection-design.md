# Video Text Selection — Design

**Date:** 2026-07-25
**Status:** Approved, ready for planning

## Summary

A Chrome extension (Manifest V3) that freezes the current video frame on a keyboard
shortcut, runs OCR on it locally, and overlays an invisible, natively selectable text
layer on top of the frozen frame. The user drags across the video exactly as they would
across a web page and copies with Cmd+C. Behaviour mirrors macOS Live Text.

## Scope

**In scope**

- Ordinary HTML5 `<video>` elements: YouTube, Vimeo, self-hosted players, embedded
  players inside iframes, meeting/screen-share recordings.
- Canvas-based players that render frames into a `<canvas>` element.
- English OCR, running fully offline.

**Out of scope**

- DRM-protected players (Netflix, Disney+, Prime Video). EME content yields a black
  canvas; the extension detects this and reports it rather than attempting a
  `getDisplayMedia` workaround.
- Cloud OCR, API keys, and any network traffic. Nothing leaves the machine.
- Languages other than English. The architecture does not preclude adding language
  packs later, but no multi-language UI is built now.
- Translation, summarisation, or any processing of the recognised text beyond copying.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| OCR engine | Tesseract.js, vendored locally | Offline, no key, no cost, and it returns word-level bounding boxes — the geometry drag-selection requires. ~10–15MB extension size and 1–3s per frame are acceptable trade-offs. |
| Selection model | Invisible DOM text layer (pdf.js approach) | Native selection, highlight, Cmd+C, right-click Copy and double-click-word all come free from the browser. Highest fidelity to macOS Live Text with the least custom code. |
| Trigger | Keyboard shortcut only, default `Cmd+Shift+S`, rebindable at `chrome://extensions/shortcuts` | One motion pauses, captures and scans. No persistent UI on any page. |
| Permissions | `activeTab`, granted by the shortcut gesture | No host permissions, no content script on every page. The extension is dormant until invoked. |
| OCR location | Extension-owned offscreen document | Host page CSP frequently blocks WASM instantiation and blob-URL workers in content scripts. The offscreen document runs under the extension's own CSP. |

## Architecture

Three contexts, each with one job.

### Service worker (`src/background/service-worker.js`)

- Listens on `chrome.commands.onCommand` for the capture shortcut.
- Injects the content script into the active tab with `allFrames: true`. Embedded
  players live in iframes, so the owning frame must be reachable.
- Creates and tears down the offscreen document, keeping it alive between captures so
  only the first scan of a session pays the Tesseract model-load cost.
- Routes OCR requests from content script to offscreen document and results back.

### Offscreen document (`src/offscreen/offscreen.{html,js}`)

- Created with `chrome.offscreen.createDocument({reasons: ['WORKERS']})`.
- Hosts a single long-lived Tesseract worker.
- Receives a PNG data URL, returns recognised words with bounding boxes in image
  pixel coordinates, grouped by line in reading order.

### Content script (`src/content/`)

Orchestrates capture and owns all UI. Split by responsibility:

- `index.js` — orchestration only: find, pause, capture, request OCR, mount overlay.
- `video-target.js` — element selection and rendered-content-rect maths. Pure functions
  over supplied rect/dimension inputs; no DOM mutation.
- `capture.js` — frame to PNG data URL, plus classification of capture failures.
- `overlay/overlay.js` — shadow-DOM overlay lifecycle: mount, reposition, dismiss.
- `overlay/text-layer.js` — OCR words to positioned transparent spans. Pure geometry.
- `overlay/overlay.css` — overlay and selection styling.
- `src/lib/messages.js` — message contracts shared across all three contexts.

`video-target.js` and `text-layer.js` are the coordinate-maths core and are deliberately
free of side effects so they can be unit-tested without a browser.

## Flow

```
Cmd+Shift+S
  |
  +- service worker: executeScript into active tab, all frames
  |
  +- content: find target element        -- none? -> toast, done
  |     largest visible playing <video>, else largest <video>, else <canvas>
  |
  +- content: pause it; record whether WE were the one who paused it
  |
  +- content: draw to canvas at intrinsic videoWidth x videoHeight, toDataURL
  |     SecurityError or all-black frame -> classified error toast, resume, done
  |
  +- content: mount overlay immediately with frozen frame + scanning shimmer
  |
  +- message -> service worker -> offscreen -> Tesseract -> word boxes -> back
  |
  +- content: build transparent text layer, remove shimmer
```

Capture happens at the video's intrinsic resolution (`videoWidth` × `videoHeight`), not
its displayed size. OCR accuracy on a 1920px frame is materially better than on the
640px box it may be rendered in, at no cost.

## Overlay

A single host element attached to a shadow root, so page CSS cannot affect it and its
styles cannot leak.

**Attachment point:** `document.fullscreenElement ?? document.body`. Without the
fullscreen check the overlay is invisible whenever the user is watching fullscreen.

**Backdrop:** the captured PNG, not the paused video showing through. This guarantees
the OCR boxes stay pixel-aligned with what the user sees even if the player redraws,
resizes or repositions underneath. The frame is genuinely frozen.

**Repositioning:** the overlay tracks the target element's rect on scroll and resize,
throttled to animation frames.

**Controls:** a Copy all button, a close button, and Esc to dismiss.

**Resume semantics:** on dismiss, playback resumes only if the extension was what
paused it. A video the user had already paused stays paused.

## Text layer

For each recognised word, one absolutely-positioned `<span>` with `color: transparent`,
scaled from image pixels into displayed pixels:

```
scale = renderedContentRect.width / videoWidth
```

`renderedContentRect` is the rect of the actual video content, not the element rect. A
16:9 video in a 4:3 player is letterboxed; using the element rect offsets every box by
the pillarbox margin.

Each span sets `font-size` from its box height, then applies `transform: scaleX(...)`
so the glyphs' natural width matches the measured box width. This is the pdf.js
technique and is what keeps the native highlight tracking the actual letters rather than
drifting along the line.

Spans are inserted in Tesseract's reading order, grouped one `<div>` per line, with real
whitespace text nodes between words. This is what makes Cmd+C yield
`The quick brown fox\njumps over` rather than `Thequickbrownfoxjumpsover`.

Selection behaviour — I-beam cursor, highlight, double-click-a-word, right-click Copy,
Cmd+C — is entirely the browser's. The extension contributes only `::selection`
styling on top.

## Error handling

| Case | Behaviour |
|---|---|
| No video or canvas found on page | Toast; no other state change |
| Tainted canvas (`SecurityError` on `toDataURL`) | Toast "This player blocks frame capture"; resume |
| DRM content (uniformly black frame) | Same message. Detected by pixel sampling, because EME returns a valid all-black canvas with no error |
| Target has zero intrinsic dimensions (not yet loaded) | Toast; resume |
| OCR returns no words | Overlay remains, showing the frame, with "No text found" |
| OCR exceeds a 15s timeout | Abort, dismiss overlay, toast; resume |
| Offscreen document fails to create | Toast; resume |

The black-frame check is essential rather than defensive: DRM capture fails silently, so
without pixel sampling the user would get an empty overlay and no explanation.

## Testing

Vitest for unit tests. esbuild bundles the content script, since MV3 content scripts do
not accept ES modules and the file split is worth preserving.

- **`video-target`** — fixture rects covering letterboxed, pillarboxed, `object-fit:
  cover`, zero-size and offscreen elements; and target selection among several videos.
- **`text-layer`** — a recorded Tesseract result as fixture, asserting both span geometry
  and the resulting copied-text string, including line breaks and inter-word spacing.
- **`capture`** — failure classification: thrown `SecurityError`, all-black frame, valid
  frame.
- **OCR integration** — Tesseract runs under Node, so a golden-image test asserts real
  words are recovered from a real screenshot fixture.
- **Manual E2E checklist** — YouTube inline, YouTube fullscreen, an iframe embed, a plain
  `<video>` element, a canvas-based player.

## Open risks

- Tesseract accuracy on stylised or low-resolution subtitles will be materially worse
  than on slides, code and terminal text. Accepted; the golden-image test documents
  realistic expectations rather than asserting perfection.
- Canvas-based players expose no intrinsic-resolution equivalent to `videoWidth`; the
  canvas's own `width`/`height` attributes are used instead, which may be lower
  resolution than the display size.
