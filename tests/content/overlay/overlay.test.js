// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountOverlay } from '../../../src/content/overlay/overlay.js';
import { layoutTextLayer } from '../../../src/content/overlay/text-layer.js';
import { ERROR, ERROR_MESSAGE } from '../../../src/lib/messages.js';

const frame = { dataUrl: 'data:image/png;base64,AAAA', width: 1000, height: 500 };
const contentRect = { left: 40, top: 20, width: 500, height: 250 };

function mount(overrides = {}) {
  return mountOverlay({ frame, contentRect, doc: document, ...overrides });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('mountOverlay', () => {
  it('attaches a shadow root so page CSS cannot reach it', () => {
    const handle = mount();
    expect(handle.host.shadowRoot ?? handle.shadow).toBeTruthy();
    expect(handle.shadow.querySelector('.vts-root')).toBeTruthy();
  });

  it('positions the root at the content rect, not the element rect', () => {
    const handle = mount();
    const root = handle.shadow.querySelector('.vts-root');
    expect(root.style.left).toBe('40px');
    expect(root.style.top).toBe('20px');
    expect(root.style.width).toBe('500px');
    expect(root.style.height).toBe('250px');
  });

  it('shows the captured frame as the backdrop', () => {
    const handle = mount();
    expect(handle.shadow.querySelector('.vts-frame').src).toBe(frame.dataUrl);
  });

  it('starts in the scanning state', () => {
    const handle = mount();
    expect(handle.shadow.querySelector('.vts-root').dataset.state).toBe('scanning');
  });

  it('attaches to the fullscreen element when one is present', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: container,
    });

    const handle = mount();
    expect(handle.host.parentElement).toBe(container);

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  it('inserts the text layer and leaves the scanning state on setLayout', () => {
    const handle = mount();
    const layout = layoutTextLayer(
      {
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
      },
      contentRect
    );

    handle.setLayout(layout);

    expect(handle.shadow.querySelectorAll('.vts-word')).toHaveLength(1);
    expect(handle.shadow.querySelector('.vts-root').dataset.state).toBe('ready');
  });

  it('shows a human-readable message for an error code', () => {
    const handle = mount();
    handle.setError(ERROR.NO_TEXT);
    const status = handle.shadow.querySelector('.vts-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(ERROR_MESSAGE[ERROR.NO_TEXT]);
  });

  it('copies all text when Copy all is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const handle = mount();
    handle.setLayout(
      layoutTextLayer(
        {
          width: 1000,
          height: 500,
          lines: [
            {
              text: 'hello world',
              words: [
                { text: 'hello', bbox: { x0: 0, y0: 0, x1: 80, y1: 40 }, confidence: 95 },
                { text: 'world', bbox: { x0: 90, y0: 0, x1: 180, y1: 40 }, confidence: 95 },
              ],
            },
          ],
        },
        contentRect
      )
    );

    handle.shadow.querySelector('[data-action="copy-all"]').click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('calls onDismiss and removes itself when Escape is pressed', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(handle.host.isConnected).toBe(false);
  });

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });
    handle.shadow.querySelector('[data-action="close"]').click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('destroy() after a dismissal does not throw or call onDismiss again', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });
    handle.shadow.querySelector('[data-action="close"]').click();
    expect(() => handle.destroy()).not.toThrow();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss only once when the close button fires dismiss twice', () => {
    // The close button's own click listener is never unbound, so a
    // detached-but-still-referenced button can still dispatch a second
    // click after the first dismissal. Without the `dismissed` guard this
    // would tear down and invoke onDismiss a second time.
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });
    const closeButton = handle.shadow.querySelector('[data-action="close"]');
    closeButton.click();
    closeButton.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stops Escape from propagating past the overlay while mounted, and releases it once destroyed', () => {
    const onDismiss = vi.fn();
    const handle = mount({ onDismiss });

    let probeCalled = false;
    const probe = () => {
      probeCalled = true;
    };
    document.body.addEventListener('keydown', probe);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(probeCalled).toBe(false);

    handle.destroy();
    probeCalled = false;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(probeCalled).toBe(true);

    document.body.removeEventListener('keydown', probe);
  });
});
