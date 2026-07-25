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
