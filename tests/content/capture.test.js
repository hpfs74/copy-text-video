import { describe, it, expect } from 'vitest';
import {
  computeCaptureSize,
  isBlankFrame,
  classifyCaptureError,
} from '../../src/content/capture.js';
import { ERROR } from '../../src/lib/messages.js';

/** Build an RGBA buffer of `count` pixels, all the same colour. */
function solid(count, r, g, b) {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

describe('computeCaptureSize', () => {
  it('captures at intrinsic resolution when under the cap', () => {
    expect(computeCaptureSize(1920, 1080, 2560)).toEqual({ width: 1920, height: 1080 });
  });

  it('downscales 4K to the cap, preserving aspect ratio', () => {
    expect(computeCaptureSize(3840, 2160, 2560)).toEqual({ width: 2560, height: 1440 });
  });

  it('rounds to whole pixels', () => {
    const size = computeCaptureSize(3000, 1001, 1500);
    expect(size.width).toBe(1500);
    expect(Number.isInteger(size.height)).toBe(true);
    expect(size.height).toBe(501);
  });

  it('never upscales a small video', () => {
    expect(computeCaptureSize(320, 240, 2560)).toEqual({ width: 320, height: 240 });
  });
});

describe('isBlankFrame', () => {
  it('detects a fully black frame, which is how DRM capture fails', () => {
    expect(isBlankFrame(solid(10000, 0, 0, 0))).toBe(true);
  });

  it('treats near-black noise as blank', () => {
    expect(isBlankFrame(solid(10000, 3, 3, 3))).toBe(true);
  });

  it('does not treat a white frame as blank', () => {
    expect(isBlankFrame(solid(10000, 255, 255, 255))).toBe(false);
  });

  it('does not treat a mid-grey frame as blank', () => {
    expect(isBlankFrame(solid(10000, 128, 128, 128))).toBe(false);
  });

  it('is not fooled by a mostly-black frame with real content', () => {
    // A dark slide with white text: 100 bright pixels in 10000 (1% bright).
    // Sampler reads every 97 pixels; only pixels at indices 0 and 9700 align
    // with the sample stride, so 2 out of 104 samples are bright (≈1.9%),
    // which exceeds minBrightRatio of 0.1%, so the frame is not blank.
    const pixels = solid(10000, 0, 0, 0);
    for (let i = 0; i < 100; i++) {
      const p = i * 400; // place bright pixels every 100 pixels (byte offset)
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
    }
    expect(isBlankFrame(pixels)).toBe(false);
  });
});

describe('classifyCaptureError', () => {
  it('maps a SecurityError to BLOCKED', () => {
    const error = new Error('tainted canvas');
    error.name = 'SecurityError';
    expect(classifyCaptureError(error)).toBe(ERROR.BLOCKED);
  });

  it('preserves an already-classified code', () => {
    const error = new Error('nope');
    error.code = ERROR.NOT_READY;
    expect(classifyCaptureError(error)).toBe(ERROR.NOT_READY);
  });

  it('falls back to UNKNOWN', () => {
    expect(classifyCaptureError(new Error('who knows'))).toBe(ERROR.UNKNOWN);
  });
});
