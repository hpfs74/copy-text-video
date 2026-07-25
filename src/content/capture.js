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
