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
