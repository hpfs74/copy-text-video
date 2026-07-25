// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { runCapture } from '../../src/content/index.js';
import { ERROR, ERROR_MESSAGE } from '../../src/lib/messages.js';

const candidate = {
  id: 'v1',
  kind: 'video',
  rect: { left: 40, top: 20, width: 500, height: 250 },
  intrinsicWidth: 1000,
  intrinsicHeight: 500,
  paused: false,
  objectFit: 'contain',
};

const frame = { dataUrl: 'data:image/png;base64,AAAA', width: 1000, height: 500 };

const ocrResult = {
  width: 1000,
  height: 500,
  lines: [
    {
      text: 'hello',
      words: [
        { text: 'hello', bbox: { x0: 0, y0: 0, x1: 100, y1: 40 }, confidence: 95 },
      ],
    },
  ],
};

function makeDeps(overrides = {}) {
  const element = { pause: vi.fn() };
  const handle = {
    setLayout: vi.fn(),
    setError: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    element,
    handle,
    deps: {
      collectCandidates: vi.fn(() => [{ ...candidate, element }]),
      captureFrame: vi.fn(() => frame),
      mountOverlay: vi.fn(() => handle),
      requestOcr: vi.fn(async () => ({ ok: true, result: ocrResult })),
      showToast: vi.fn(),
      viewport: { width: 1000, height: 800 },
      doc: document,
      ...overrides,
    },
  };
}

describe('runCapture', () => {
  it('pauses a playing video before capturing', async () => {
    const { element, deps } = makeDeps();
    await runCapture(deps);
    expect(element.pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause a video that was already paused', async () => {
    const element = { pause: vi.fn() };
    const { deps } = makeDeps({
      collectCandidates: () => [{ ...candidate, paused: true, element }],
    });
    await runCapture(deps);
    expect(element.pause).not.toHaveBeenCalled();
  });

  it('mounts the overlay at the content rect, not the element rect', async () => {
    const { deps } = makeDeps();
    await runCapture(deps);
    // 1000x500 content in a 500x250 box already matches: no letterboxing.
    expect(deps.mountOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        frame,
        contentRect: { left: 40, top: 20, width: 500, height: 250 },
      })
    );
  });

  it('mounts the overlay before OCR completes so the user sees the frozen frame', async () => {
    const order = [];
    const { deps } = makeDeps({
      mountOverlay: vi.fn(() => {
        order.push('mount');
        return { setLayout: vi.fn(), setError: vi.fn(), destroy: vi.fn() };
      }),
      requestOcr: vi.fn(async () => {
        order.push('ocr');
        return { ok: true, result: ocrResult };
      }),
    });
    await runCapture(deps);
    expect(order).toEqual(['mount', 'ocr']);
  });

  it('hands the laid-out text to the overlay on success', async () => {
    const { handle, deps } = makeDeps();
    await runCapture(deps);
    const layout = handle.setLayout.mock.calls[0][0];
    expect(layout.lines[0].words[0].text).toBe('hello');
  });

  it('toasts and does not mount when there is no target', async () => {
    const { deps } = makeDeps({ collectCandidates: () => [] });
    await runCapture(deps);
    expect(deps.showToast).toHaveBeenCalledWith(
      ERROR_MESSAGE[ERROR.NO_TARGET],
      document
    );
    expect(deps.mountOverlay).not.toHaveBeenCalled();
  });

  it('toasts and resumes playback when capture is blocked', async () => {
    const element = { pause: vi.fn(), play: vi.fn() };
    const { deps } = makeDeps({
      collectCandidates: () => [{ ...candidate, element }],
      captureFrame: () => {
        const error = new Error('blocked');
        error.code = ERROR.BLOCKED;
        throw error;
      },
    });

    await runCapture(deps);

    expect(deps.showToast).toHaveBeenCalledWith(ERROR_MESSAGE[ERROR.BLOCKED], document);
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it('reports an OCR failure on the overlay rather than tearing it down', async () => {
    const { handle, deps } = makeDeps({
      requestOcr: async () => ({ ok: false, code: ERROR.OCR_TIMEOUT }),
    });
    await runCapture(deps);
    expect(handle.setError).toHaveBeenCalledWith(ERROR.OCR_TIMEOUT);
    expect(handle.destroy).not.toHaveBeenCalled();
  });

  it('reports NO_TEXT when OCR succeeds but finds nothing', async () => {
    const { handle, deps } = makeDeps({
      requestOcr: async () => ({ ok: true, result: { width: 1000, height: 500, lines: [] } }),
    });
    await runCapture(deps);
    expect(handle.setError).toHaveBeenCalledWith(ERROR.NO_TEXT);
  });

  it('resumes playback on dismiss only if it was the one that paused', async () => {
    const element = { pause: vi.fn(), play: vi.fn() };
    const { deps } = makeDeps({ collectCandidates: () => [{ ...candidate, element }] });
    await runCapture(deps);

    deps.mountOverlay.mock.calls[0][0].onDismiss();
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-paused video paused on dismiss', async () => {
    const element = { pause: vi.fn(), play: vi.fn() };
    const { deps } = makeDeps({
      collectCandidates: () => [{ ...candidate, paused: true, element }],
    });
    await runCapture(deps);

    deps.mountOverlay.mock.calls[0][0].onDismiss();
    expect(element.play).not.toHaveBeenCalled();
  });
});
