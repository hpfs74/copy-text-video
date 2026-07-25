// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  layoutTextLayer,
  renderTextLayer,
} from '../../../src/content/overlay/text-layer.js';

const ocr = {
  width: 1000,
  height: 500,
  lines: [
    {
      text: 'The quick',
      words: [
        { text: 'The', bbox: { x0: 100, y0: 50, x1: 200, y1: 90 }, confidence: 95 },
        { text: 'quick', bbox: { x0: 220, y0: 50, x1: 380, y1: 90 }, confidence: 95 },
      ],
    },
    {
      text: 'brown fox',
      words: [
        { text: 'brown', bbox: { x0: 100, y0: 150, x1: 260, y1: 190 }, confidence: 95 },
      ],
    },
  ],
};

const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });

describe('renderTextLayer', () => {
  it('creates one line element per OCR line', () => {
    const root = renderTextLayer(layout, document);
    expect(root.querySelectorAll('.vts-line')).toHaveLength(2);
  });

  it('creates one span per word, in reading order', () => {
    const root = renderTextLayer(layout, document);
    const words = [...root.querySelectorAll('.vts-word')].map((el) => el.textContent);
    expect(words).toEqual(['The', 'quick', 'brown']);
  });

  it('separates words with real whitespace text nodes', () => {
    // Without these, Cmd+C yields "Thequick" rather than "The quick".
    const root = renderTextLayer(layout, document);
    const firstLine = root.querySelector('.vts-line');
    expect(firstLine.textContent).toBe('The quick');
  });

  it('positions each span at its layout coordinates', () => {
    const root = renderTextLayer(layout, document);
    const span = root.querySelector('.vts-word');
    expect(span.style.left).toBe('100px');
    expect(span.style.top).toBe('50px');
    expect(span.style.fontSize).toBe('40px');
  });

  it('marks each span with its target width for post-measurement fitting', () => {
    const root = renderTextLayer(layout, document);
    const span = root.querySelector('.vts-word');
    expect(span.dataset.width).toBe('100');
  });

  it('renders an empty container for an empty layout', () => {
    const root = renderTextLayer({ lines: [] }, document);
    expect(root.querySelectorAll('.vts-word')).toHaveLength(0);
    expect(root.className).toBe('vts-text-layer');
  });
});

describe('fitSpanWidths', () => {
  it('applies a horizontal scale so glyph width matches the measured box', async () => {
    const { fitSpanWidths } = await import(
      '../../../src/content/overlay/text-layer.js'
    );
    const root = renderTextLayer(layout, document);
    const span = root.querySelector('.vts-word');
    // jsdom reports zero-width layout, so feed the measurement in directly.
    fitSpanWidths(root, () => 50);
    expect(span.style.transform).toBe('scaleX(2)');
  });

  it('leaves spans untouched when they cannot be measured', async () => {
    const { fitSpanWidths } = await import(
      '../../../src/content/overlay/text-layer.js'
    );
    const root = renderTextLayer(layout, document);
    fitSpanWidths(root, () => 0);
    expect(root.querySelector('.vts-word').style.transform).toBe('');
  });
});
