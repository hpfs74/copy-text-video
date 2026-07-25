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
      video. The overlay appears over the embed, not the host page, **and no
      "No video found on this page" toast appears anywhere**: injection is
      allFrames, so the host frame runs the same code with nothing to capture.
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
- [ ] **Spaces survive a drag-select** — wait for the text to appear, drag across a
      whole line, press Cmd+C, paste into a plain-text editor (TextEdit in plain
      mode, or the address bar). Pass = `The quick brown fox`, single spaces
      between words. Fail = `Thequickbrownfox`. Judge this on the *pasted*
      text: Copy all joins the words in JavaScript and would look correct even
      if the rendered separators had collapsed, so it cannot substitute here.
      (No automated test can cover this: jsdom does not collapse whitespace and
      has no clipboard.)

## Controls

- [ ] **The buttons still work after the text appears** — wait for the scanning
      shimmer to stop and the words to become selectable, *then* click Copy all
      (the status pill reads "Copied") and Close (the overlay disappears).
      Pass = both respond after OCR finished, not only during scanning. The
      text layer covers the whole overlay and must not swallow their clicks.
      (No automated test can cover this: jsdom does no hit testing.)

## Failure paths

- [ ] **Netflix or another DRM service** — "This player blocks frame capture",
      no empty overlay, playback resumes.
- [ ] **A page with no video** — "No video found on this page".
- [ ] **A video that has not loaded yet** — reload a video page and press the
      shortcut before the first frame paints: "The video has not loaded a frame
      yet", not "No video found on this page".
- [ ] **A frame with no text** (a blank scene) — overlay stays up showing the
      frame with "No text found in this frame".
- [ ] **A restricted page** (`chrome://extensions`) — nothing happens, no crash
      in the service worker console.

## Lifecycle

- [ ] Esc after the extension paused the video — playback resumes.
- [ ] Esc after you paused the video yourself — stays paused.
- [ ] Press the shortcut twice quickly — one overlay, not two.
- [ ] **Press the shortcut again after the text has appeared** — the old overlay
      is replaced, not stacked. Then click Close once: the video is fully
      uncovered, with no stale frozen frame left behind it.

## Transitions with the overlay open

These are state *changes* while the overlay is live, which is where the states
above cannot go wrong but the transitions between them can.

- [ ] **Enter fullscreen while the overlay is open** (press the shortcut inline,
      then f on YouTube) — the frozen frame follows into fullscreen and stays
      selectable. A pass is that it is visible at all: nothing outside the
      fullscreen element is rendered, so an overlay left on document.body
      simply vanishes.
- [ ] **Leave fullscreen again** — the overlay comes back out with the player
      and lands back on the video, not somewhere else on the page.
- [ ] **Toggle theatre mode / resize the window while open** — the picture and
      the invisible text rescale *together*. Check by dragging across a line
      after the resize: the highlight must still sit on the letters. The
      picture rescaling on its own is not a pass.
- [ ] Second capture in the same session is noticeably faster than the first
      (the Tesseract worker stays warm).
