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
npm test                  # unit tests
npm run test:integration  # golden-image test against the real OCR engine
npm run lint              # eslint
npm run check:permissions # fail if the manifest gains permissions
npm run check:audit       # fail on high/critical dependency advisories
npm run build             # bundle to dist/
npm run package           # build, then zip to release/ for the Web Store
```

## CI

Every pull request runs lint, the unit suite, the real-OCR integration test, a
dependency audit, an extension permission guard, a dependency review of anything
newly added, and CodeQL analysis. The build is also exercised end to end to prove
`dist/` is complete and loadable.

The permission guard is the one worth knowing about: it fails the build if
`manifest.json` ever gains a permission beyond `activeTab`, `scripting` and
`offscreen`, adds any host permission, or declares a static content script. Those
three properties are what limit the extension to seeing only the tab you invoke it
on, at the moment you invoke it, and they are each one line away from being lost.

## Releases

Merging to `main` derives a version from the merged commits — `feat:` gives a minor
bump, `fix:` or `perf:` a patch, `!` or `BREAKING CHANGE` a major, and anything else
releases nothing. The workflow writes that version into the working tree so it reaches
the built artifact, tags the commit, and publishes the packaged zip as a GitHub Release.

**Git tags are the source of truth for the released version.** The version committed in
`manifest.json` is only a development placeholder and will lag behind the latest tag.
That is deliberate: `main` requires every change to arrive through a pull request with
verified signatures, so the release job cannot push a version-bump commit back — it
tags instead. To find what actually shipped, read `git tag` or the Releases page.

Because the squashed commit's message is what drives the version, a squash merge whose
subject is not conventional-commit format (GitHub defaults it to the PR title) will
release nothing. Give the squash commit a `feat:` or `fix:` subject.

Releases are built and tested automatically, but **no automated browser test exists
for this extension** — layout, painting, text selection, clipboard behaviour and DRM
handling are all invisible to CI. See `docs/manual-test-checklist.md` for what still
needs a human before a release is trustworthy.
