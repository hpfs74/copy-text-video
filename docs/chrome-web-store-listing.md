# Chrome Web Store listing

Paste-ready copy for the developer console. Item ID `kkeldliphfpnofpdfkgdaoamnkjgiogc`.

**Upload the zip from a release built after icons were added.** `v0.2.0` predates the
icons and will be rejected — the store requires a 128×128 icon declared in the manifest.
Run `npm run package` locally, or take the zip attached to the newest GitHub Release.

---

## Product details

**Item name** (max 45 characters — 17 used)

```
Video Text Select
```

**Summary** (max 132 characters — 122 used)

```
Pause any video and select text out of the picture, like macOS Live Text. Fully offline — no frame ever leaves your device.
```

**Category**

`Tools` — it is a general-purpose utility. `Accessibility` is a defensible alternative if
you'd rather lead with the "text you cannot otherwise reach" angle, and competition for
attention there is lower.

**Language**: English

---

## Description

```
Text on screen in a video is trapped. A command in a terminal recording, an
error message in a bug report, a URL on a conference slide, a config snippet in
a tutorial, a book title on a shelf in the background — you can see it, but you
cannot copy it. So you pause, squint, and retype it by hand, and get a character
wrong, and try again.

macOS gives you Live Text on images. Your browser gives you nothing on video.
Video Text Select closes that gap.

HOW IT WORKS

Press Cmd+Shift+S (Ctrl+Shift+S on Windows and Linux) while a video is playing.
The video pauses, the frame freezes, and a moment later every word in the picture
becomes selectable text. Drag across it exactly as you would on a web page and
press Cmd+C. Or click "Copy all" to take everything at once.

Press Esc to dismiss. Playback resumes only if the extension was what paused it —
if you had already paused the video yourself, it stays paused.

The selection is real browser text selection, not a custom imitation. That means
the I-beam cursor, the highlight, double-click to select a word, right-click to
copy, and Cmd+C all behave exactly as you already expect, because they are your
browser's own features working on text laid over the frame.

EVERYTHING RUNS ON YOUR DEVICE

The text recognition engine and its English language model are bundled inside the
extension. There is no server, no API key, no account, and no network request at
any point. Your video frames are processed in memory on your own machine and are
never uploaded, stored, or seen by anyone — including us.

This is also why it works offline, and why it stays fast: recognising a frame
takes a fraction of a second.

IT RUNS ONLY WHEN YOU ASK IT TO

The extension has no access to any page until you press its shortcut, and then
only to the single tab you are looking at. It requests no permission to read your
browsing history, your other tabs, or any specific website. It declares no script
that runs when a page loads — nothing happens anywhere until you invoke it.

WHERE IT WORKS

Ordinary HTML5 video: YouTube, Vimeo, self-hosted players, videos embedded in
other pages, conference talks, screen recordings, and meeting recordings. Also
canvas-based players.

WHERE IT DOES NOT

DRM-protected streaming services — Netflix, Disney+, Prime Video — deliberately
hand back a black frame to anything trying to read their pixels. That is by
design and cannot be worked around. Rather than showing you an empty overlay and
letting you wonder, the extension detects it and tells you plainly.

Recognition is English only for now.

Accuracy is very good on the kind of text you actually want to copy — slides,
code, terminals, subtitles, UI. Stylised titles and very low-resolution text are
harder, as they are for any recognition engine.

OPEN SOURCE

The full source is at https://github.com/hpfs74/copy-text-video — including the
tests, the build, and every line of what runs on your machine.
```

---

## Privacy practices

**Single purpose description**

```
Video Text Select has a single purpose: to let the user select and copy text that
appears inside a video frame.

When the user presses the extension's keyboard shortcut, it pauses the video in
the active tab, captures the current frame, recognises the text in that frame
locally, and overlays the recognised words on top of the frozen frame so that the
browser's normal text selection and clipboard behaviour can be applied to them.
It does nothing else.
```

**Permission justifications**

`activeTab`

```
To read text out of a video, the extension has to read that video's pixels. It
needs this access only for the tab the user is looking at, and only at the instant
the user presses its keyboard shortcut. activeTab grants exactly that: access to a
single tab, in response to an explicit user action, and nothing more.

This is why the extension requests no host permissions. It cannot reach any tab
the user has not deliberately invoked it on.
```

`scripting`

```
Used to inject the capture-and-overlay script into the active tab when the user
presses the keyboard shortcut, and only then. The extension declares no static
content scripts, so no code of ours runs on any page during normal browsing.

Injection targets all frames because a video is very often inside an iframe (an
embedded YouTube or Vimeo player, for example), and the frame that owns the video
is the one that has to do the work.
```

`offscreen`

```
The text recognition engine is WebAssembly. Many websites' Content Security Policy
blocks WebAssembly instantiation inside an injected content script, which would
make the extension fail on those sites. Running the engine in an offscreen document
puts it under the extension's own Content Security Policy, where it works
consistently everywhere.

The offscreen document has no access to page content and makes no network requests.
It receives an image, returns recognised words and their positions, and nothing else.
```

**Are you using remote code?** — **No, I am not using remote code.**

```
All executable code ships inside the package, including the WebAssembly recognition
engine and its English language model. Nothing is fetched, evaluated, or loaded from
any remote source at runtime.
```

**Data usage** — declare **no** data collected in every category, and confirm all three
certifications. Supporting statement:

```
This extension does not collect, transmit, or store any user data.

Video frames are captured into memory, recognised on the user's own device, and
discarded when the overlay is dismissed. Nothing is written to disk, sent over the
network, or shared with any third party. The extension makes no network requests at
all.
```

---

## Graphic assets

| Asset | Required | Status |
|---|---|---|
| Store icon 128×128 | Yes | `icons/icon-128.png` |
| Small promo tile 440×280 | Recommended | `store/promo-440x280.png` |
| Screenshot 1280×800 or 640×400 | **Yes, at least one** | **Missing — see below** |
| Marquee promo 1400×560 | Optional | Not produced |

### Screenshots still needed

At least one screenshot is mandatory, and it cannot be generated without running the
extension in a real browser. The three worth capturing, in order of persuasiveness:

1. **A paused talk with a slide, mid-drag** — text visibly selected with the blue
   highlight over the frozen frame. This one image explains the whole product.
2. **A terminal or code screencast**, showing a command selected. Speaks directly to
   the developer audience most likely to install it.
3. **The DRM message**, to set expectations honestly before install rather than
   collecting one-star reviews after it.

Load `dist/` via `chrome://extensions` → Load unpacked, then capture at exactly
1280×800.

---

## Automated publishing

Every release now uploads and publishes to the store automatically, in the `publish-store`
job of `.github/workflows/release.yml`. It runs only after `release` fully succeeds, so
nothing reaches the store that hasn't passed lint, the unit suite, the real-OCR
integration test and the permission guard.

**This publishes publicly to every existing user, after Google's review.** There is no
undo other than publishing again. The job is separate and re-runnable, so an expired token
or a store outage can be retried from the Actions tab without cutting a new release.

### One-time setup, which cannot be automated

**1. Submit the listing by hand first.** The API uploads and publishes *packages* only. It
cannot create a listing or edit any of the metadata above. The description, screenshots,
category and privacy answers must already exist in the console before the first automated
publish will work.

**2. Create OAuth credentials.**

1. Create a Google Cloud project and enable the **Chrome Web Store API**.
2. Create an OAuth client of type **Desktop app** → gives the client id and secret.
3. **Set the OAuth consent screen to "In production", not "Testing".** This is the step
   people skip. Refresh tokens issued while the consent screen is in Testing mode expire
   after **7 days**, so the pipeline works, you stop thinking about it, and it starts
   failing a week later for no visible reason.
4. Complete the OAuth flow once to obtain a refresh token, requesting the scope
   `https://www.googleapis.com/auth/chromewebstore`.

**3. Add repository secrets** (Settings → Secrets and variables → Actions):

| Secret | |
|---|---|
| `CWS_CLIENT_ID` | OAuth client id |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | OAuth refresh token |

Optionally set the repository **variable** `CWS_EXTENSION_ID` to override the default item
id (`kkeldliphfpnofpdfkgdaoamnkjgiogc`). Extension ids are public, so this is a variable
rather than a secret.

Until the secrets exist, the job fails with instructions rather than failing obscurely.

### Running it by hand

```bash
CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… CWS_REFRESH_TOKEN=… \
  node scripts/publish-webstore.mjs release/video-text-select-0.3.0.zip
```

`CWS_DRY_RUN=true` uploads the package as a draft without publishing it — useful for
confirming the credentials work before letting anything reach users.
`CWS_PUBLISH_TARGET=trustedTesters` publishes to your tester list instead of the public.

## Before you submit

- [ ] Upload a zip built **after** icons were added — not `v0.2.0`
- [ ] At least one 1280×800 screenshot attached
- [ ] `docs/manual-test-checklist.md` actually worked through in a browser. Nothing in
      this extension's visual behaviour has been verified by a human yet, and a
      rejected or one-starred listing is a worse place to discover a problem than
      your own machine.
