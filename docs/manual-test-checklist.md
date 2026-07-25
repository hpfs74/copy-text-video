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
