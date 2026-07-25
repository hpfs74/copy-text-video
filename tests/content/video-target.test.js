import { describe, it, expect } from 'vitest';
import {
  computeContentRect,
  pickTarget,
  visibleArea,
} from '../../src/content/video-target.js';

const viewport = { width: 1000, height: 800 };

describe('computeContentRect', () => {
  it('returns the element rect when the aspect ratios already match', () => {
    const rect = { left: 10, top: 20, width: 640, height: 360 };
    expect(computeContentRect(rect, 1920, 1080, 'contain')).toEqual({
      left: 10,
      top: 20,
      width: 640,
      height: 360,
    });
  });

  it('letterboxes a wide video in a tall element', () => {
    // 16:9 content in a 640x480 box -> 640x360, centred vertically (60px bars).
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(computeContentRect(rect, 1920, 1080, 'contain')).toEqual({
      left: 0,
      top: 60,
      width: 640,
      height: 360,
    });
  });

  it('pillarboxes a tall video in a wide element', () => {
    // 1:1 content in a 640x480 box -> 480x480, centred horizontally (80px bars).
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(computeContentRect(rect, 1000, 1000, 'contain')).toEqual({
      left: 80,
      top: 0,
      width: 480,
      height: 480,
    });
  });

  it('overflows the element for object-fit: cover', () => {
    // Cover scales to the larger factor, so content bleeds past the box and
    // is centred on it. A 16:9 video in a 4:3 box overflows horizontally.
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    const result = computeContentRect(rect, 1920, 1080, 'cover');
    expect(result.width).toBeCloseTo(853.333, 2);
    expect(result.height).toBeCloseTo(480, 2);
    expect(result.left).toBeCloseTo(-106.667, 2);
    expect(result.top).toBeCloseTo(0, 2);
  });

  it('stretches to the element for object-fit: fill', () => {
    const rect = { left: 5, top: 5, width: 640, height: 480 };
    expect(computeContentRect(rect, 1920, 1080, 'fill')).toEqual({
      left: 5,
      top: 5,
      width: 640,
      height: 480,
    });
  });

  it('uses intrinsic size centred in the element for object-fit: none', () => {
    const rect = { left: 0, top: 0, width: 640, height: 480 };
    expect(computeContentRect(rect, 320, 240, 'none')).toEqual({
      left: 160,
      top: 120,
      width: 320,
      height: 240,
    });
  });

  it('preserves sub-pixel precision rather than rounding', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    const result = computeContentRect(rect, 3, 2, 'contain');
    expect(result.height).toBeCloseTo(66.6667, 3);
  });
});

describe('visibleArea', () => {
  it('is the full area for a fully visible element', () => {
    expect(visibleArea({ left: 0, top: 0, width: 100, height: 50 }, viewport)).toBe(5000);
  });

  it('clips to the viewport for a partly scrolled-off element', () => {
    expect(visibleArea({ left: -50, top: 0, width: 100, height: 50 }, viewport)).toBe(2500);
  });

  it('is zero for an element entirely off screen', () => {
    expect(visibleArea({ left: -200, top: 0, width: 100, height: 50 }, viewport)).toBe(0);
  });
});

describe('pickTarget', () => {
  const base = {
    kind: 'video',
    intrinsicWidth: 1920,
    intrinsicHeight: 1080,
    paused: true,
    objectFit: 'contain',
  };

  it('returns null when there are no candidates', () => {
    expect(pickTarget([], viewport)).toBeNull();
  });

  it('ignores elements with no intrinsic dimensions', () => {
    const candidates = [
      { ...base, id: 'unloaded', intrinsicWidth: 0, intrinsicHeight: 0,
        rect: { left: 0, top: 0, width: 600, height: 400 } },
    ];
    expect(pickTarget(candidates, viewport)).toBeNull();
  });

  it('ignores elements that are entirely off screen', () => {
    const candidates = [
      { ...base, id: 'offscreen', rect: { left: 0, top: -500, width: 400, height: 300 } },
    ];
    expect(pickTarget(candidates, viewport)).toBeNull();
  });

  it('ignores zero-area elements', () => {
    const candidates = [
      { ...base, id: 'collapsed', rect: { left: 0, top: 0, width: 0, height: 0 } },
    ];
    expect(pickTarget(candidates, viewport)).toBeNull();
  });

  it('prefers a playing video over a larger paused one', () => {
    const candidates = [
      { ...base, id: 'big-paused', paused: true,
        rect: { left: 0, top: 0, width: 800, height: 600 } },
      { ...base, id: 'small-playing', paused: false,
        rect: { left: 0, top: 0, width: 200, height: 150 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('small-playing');
  });

  it('picks the largest visible video when none are playing', () => {
    const candidates = [
      { ...base, id: 'small', rect: { left: 0, top: 0, width: 200, height: 150 } },
      { ...base, id: 'large', rect: { left: 0, top: 0, width: 800, height: 600 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('large');
  });

  it('ranks by visible area, not raw size', () => {
    const candidates = [
      // 900x600 but 800px of its width is scrolled off: 100x600 = 60000 visible.
      { ...base, id: 'mostly-offscreen',
        rect: { left: -800, top: 0, width: 900, height: 600 } },
      // Fully visible 400x400 = 160000 visible.
      { ...base, id: 'fully-visible',
        rect: { left: 0, top: 0, width: 400, height: 400 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('fully-visible');
  });

  it('prefers any eligible video over a larger canvas', () => {
    const candidates = [
      { ...base, id: 'canvas', kind: 'canvas',
        rect: { left: 0, top: 0, width: 900, height: 700 } },
      { ...base, id: 'video', kind: 'video',
        rect: { left: 0, top: 0, width: 300, height: 200 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('video');
  });

  it('falls back to the largest canvas when there is no video', () => {
    const candidates = [
      { ...base, id: 'canvas-small', kind: 'canvas',
        rect: { left: 0, top: 0, width: 200, height: 200 } },
      { ...base, id: 'canvas-large', kind: 'canvas',
        rect: { left: 0, top: 0, width: 600, height: 400 } },
    ];
    expect(pickTarget(candidates, viewport).id).toBe('canvas-large');
  });
});
