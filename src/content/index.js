import {
  collectCandidates,
  pickTarget,
  targetContentRect,
  classifyNoTarget,
} from './video-target.js';
import { captureFrame, classifyCaptureError } from './capture.js';
import { mountOverlay } from './overlay/overlay.js';
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
      return targetContentRect(target, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
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

  // Repositioning is not enough here: the host has to move into the element
  // that is now rendering, or the overlay disappears behind the fullscreen view.
  const onFullscreenChange = () => {
    if (stopped) return;
    overlay.syncContainer();
    update();
  };

  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  doc.addEventListener('fullscreenchange', onFullscreenChange);

  return () => {
    stopped = true;
    window.removeEventListener('scroll', update, true);
    window.removeEventListener('resize', update);
    doc.removeEventListener('fullscreenchange', onFullscreenChange);
  };
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
    schedule = requestAnimationFrame,
    isTopFrame = typeof window === 'undefined' || window.top === window,
    globals = typeof window === 'undefined' ? {} : window,
  } = deps;

  // A capture that has finished still owns an overlay, and the running guard
  // below has already been cleared by then. Take the previous one down — with
  // its tracking listeners and its resume — instead of stacking on top of it,
  // where Close would only ever dismiss the newest and leave a stale frozen
  // frame nailed over the video.
  globals.__vtsDismiss?.();
  globals.__vtsDismiss = null;

  const candidates = collect(doc);
  const target = pickTarget(candidates, viewport);
  if (!target) {
    // Injection is allFrames, so on a page embedding a player every frame runs
    // this and only one of them has the video. Toasting from the top frame
    // would tell the user "No video found" at the same moment the iframe puts
    // an overlay on screen.
    if (isTopFrame) toast(ERROR_MESSAGE[classifyNoTarget(candidates, viewport)], doc);
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

  const contentRect = targetContentRect(target);

  // Mount before OCR: the user should see the frame freeze instantly, with the
  // scanning shimmer explaining the couple of seconds that follow.
  let stopTracking = () => {};
  const overlay = mount({
    frame,
    contentRect,
    doc,
    onDismiss: () => {
      globals.__vtsDismiss = null;
      stopTracking();
      resume();
    },
  });
  stopTracking = trackTarget(target, overlay, { doc, schedule });

  // How a later capture — or anything else — takes this overlay down cleanly.
  globals.__vtsDismiss = () => {
    globals.__vtsDismiss = null;
    overlay.destroy();
    stopTracking();
    resume();
  };

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

  // The overlay lays this out itself, against whatever rect tracking has moved
  // it to by now — the page may well have reflowed during the OCR wait.
  overlay.setResult(response.result);
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
