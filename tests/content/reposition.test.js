// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { trackTarget } from '../../src/content/index.js';

const target = {
  intrinsicWidth: 1000,
  intrinsicHeight: 500,
  objectFit: 'contain',
  element: {},
};

describe('trackTarget', () => {
  it('repositions the overlay when the page scrolls', () => {
    const overlay = { reposition: vi.fn() };
    const stop = trackTarget(target, overlay, {
      doc: document,
      measure: () => ({ left: 0, top: 100, width: 500, height: 250 }),
      schedule: (fn) => fn(),
    });

    window.dispatchEvent(new Event('scroll'));

    expect(overlay.reposition).toHaveBeenCalledWith({
      left: 0,
      top: 100,
      width: 500,
      height: 250,
    });
    stop();
  });

  it('repositions on resize', () => {
    const overlay = { reposition: vi.fn() };
    const stop = trackTarget(target, overlay, {
      doc: document,
      measure: () => ({ left: 0, top: 0, width: 800, height: 400 }),
      schedule: (fn) => fn(),
    });

    window.dispatchEvent(new Event('resize'));

    expect(overlay.reposition).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops repositioning once stopped', () => {
    const overlay = { reposition: vi.fn() };
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const stop = trackTarget(target, overlay, {
      doc: document,
      measure: () => ({ left: 0, top: 0, width: 100, height: 50 }),
      schedule: (fn) => fn(),
    });

    stop();
    window.dispatchEvent(new Event('scroll'));

    expect(overlay.reposition).not.toHaveBeenCalled();

    // Behaviour-only assertions above pass even if `stop` never removes any
    // listener (it would still be gated by an internal "stopped" flag), so
    // also assert the listener itself is actually torn down.
    const [scrollType, scrollHandler] = addSpy.mock.calls.find(([type]) => type === 'scroll');
    const [resizeType, resizeHandler] = addSpy.mock.calls.find(([type]) => type === 'resize');
    expect(removeSpy).toHaveBeenCalledWith(scrollType, scrollHandler, true);
    expect(removeSpy).toHaveBeenCalledWith(resizeType, resizeHandler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
