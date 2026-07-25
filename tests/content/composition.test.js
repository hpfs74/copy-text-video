// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCapture } from '../../src/content/index.js';
import { mountOverlay } from '../../src/content/overlay/overlay.js';

// Every other test in this suite mocks one seam or another. This one drives
// the real orchestration into the real overlay and the real text layer, so the
// units cannot each be individually correct while the composition is wrong.
// It is the only place that proves letterbox awareness survives the whole
// chain: element rect -> content rect -> overlay root -> span coordinates.

// A 2:1 video in an 800x250 box: pillarboxed, so the picture is 500px wide
// with 150px bars either side, and the element rect is the wrong answer.
const elementRect = { left: 40, top: 20, width: 800, height: 250 };

const candidate = {
  id: 'v1',
  kind: 'video',
  rect: elementRect,
  intrinsicWidth: 1000,
  intrinsicHeight: 500,
  paused: false,
  objectFit: 'contain',
};

// Captured-image pixels, as Tesseract reports them.
const ocrResult = {
  width: 1000,
  height: 500,
  lines: [
    {
      text: 'hello world',
      words: [
        { text: 'hello', bbox: { x0: 100, y0: 60, x1: 200, y1: 100 }, confidence: 95 },
        { text: 'world', bbox: { x0: 220, y0: 60, x1: 340, y1: 100 }, confidence: 95 },
      ],
    },
  ],
};

function drive(overrides = {}) {
  const globals = {};
  let liveRect = { ...elementRect };
  const element = {
    pause: vi.fn(),
    play: vi.fn(),
    getBoundingClientRect: () => liveRect,
  };
  let handle = null;

  const deps = {
    collectCandidates: () => [{ ...candidate, element }],
    captureFrame: () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 1000, height: 500 }),
    mountOverlay: (options) => {
      handle = mountOverlay(options);
      return handle;
    },
    requestOcr: async () => ({ ok: true, result: ocrResult }),
    showToast: vi.fn(),
    viewport: { width: 2000, height: 1000 },
    doc: document,
    schedule: (fn) => fn(),
    globals,
    ...overrides,
  };

  return {
    deps,
    globals,
    run: () => runCapture(deps),
    handle: () => handle,
    resizeTo: (rect) => {
      liveRect = rect;
      window.dispatchEvent(new Event('resize'));
    },
  };
}

const styles = (handle) => {
  const root = handle().shadow.querySelector('.vts-root');
  const span = handle().shadow.querySelector('.vts-word');
  return { root: root.style, span: span.style };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('capture end to end, through the real overlay', () => {
  it('puts the words on the picture, not on the element box', async () => {
    const session = drive();
    await session.run();

    const { root, span } = styles(session.handle);
    // Content rect: 500px of picture centred in the 800px box.
    expect(root.left).toBe('190px');
    expect(root.top).toBe('20px');
    expect(root.width).toBe('500px');
    // scale = 500 CSS px / 1000 captured px = 0.5, and no offset: the root is
    // already at the content rect, so adding it again would double-count.
    expect(span.left).toBe('50px');
    expect(span.top).toBe('30px');
    expect(span.height).toBe('20px');

    session.globals.__vtsDismiss();
  });

  it('follows the element and rescales the words when the page reflows', async () => {
    const session = drive();
    await session.run();

    // Theatre mode: the player doubles. 1600x500 box, 2:1 picture -> 1000x500
    // centred, so 300px bars and a scale of 1.0.
    session.resizeTo({ left: 0, top: 0, width: 1600, height: 500 });

    const { root, span } = styles(session.handle);
    expect(root.left).toBe('300px');
    expect(root.width).toBe('1000px');
    expect(span.left).toBe('100px');
    expect(span.top).toBe('60px');
    expect(span.height).toBe('40px');

    session.globals.__vtsDismiss();
  });

  it('copies every recognised word, separated, when Copy all is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    const session = drive();
    await session.run();

    session.handle().shadow.querySelector('[data-action="copy-all"]').click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('hello world');
    session.globals.__vtsDismiss();
  });

  it('leaves nothing behind in the page once dismissed', async () => {
    const session = drive();
    await session.run();
    const host = session.handle().host;

    session.globals.__vtsDismiss();

    expect(host.isConnected).toBe(false);
    // Tracking is torn down with it: a later reflow must not touch a dead node.
    expect(() => session.resizeTo({ left: 0, top: 0, width: 400, height: 200 })).not.toThrow();
    expect(session.handle().shadow.querySelector('.vts-root').style.width).toBe('500px');
  });
});
