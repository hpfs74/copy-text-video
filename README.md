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
