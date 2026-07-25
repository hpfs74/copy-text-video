import { describe, it, expect } from 'vitest';
import {
  layoutTextLayer,
  layoutToText,
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
        { text: 'fox', bbox: { x0: 280, y0: 150, x1: 380, y1: 190 }, confidence: 95 },
      ],
    },
  ],
};

describe('layoutTextLayer', () => {
  it('maps image pixels 1:1 when the frame is displayed at capture size', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(layout.lines[0].words[0]).toEqual({
      text: 'The',
      left: 100,
      top: 50,
      width: 100,
      height: 40,
      fontSize: 40,
    });
  });

  it('scales down when the frame is displayed smaller than captured', () => {
    // 1000px capture shown in a 500px box -> everything halves.
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 500, height: 250 });
    expect(layout.lines[0].words[0]).toEqual({
      text: 'The',
      left: 50,
      top: 25,
      width: 50,
      height: 20,
      fontSize: 20,
    });
  });

  it('scales up when the frame is displayed larger than captured', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 2000, height: 1000 });
    expect(layout.lines[0].words[1].left).toBe(440);
    expect(layout.lines[0].words[1].width).toBe(320);
  });

  it('produces coordinates relative to the overlay root, not the viewport', () => {
    // contentRect's offset is where the overlay root itself is placed, so word
    // coordinates inside it must NOT include that offset again.
    const offset = layoutTextLayer(ocr, {
      left: 300,
      top: 200,
      width: 1000,
      height: 500,
    });
    const origin = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(offset.lines[0].words[0]).toEqual(origin.lines[0].words[0]);
  });

  it('preserves line grouping and reading order', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines.map((line) => line.text)).toEqual(['The quick', 'brown fox']);
  });

  it('returns an empty layout for a result with no lines', () => {
    const empty = layoutTextLayer({ width: 100, height: 100, lines: [] }, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(empty.lines).toEqual([]);
  });

  it('produces zero-sized words when content rect is collapsed', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 0, height: 0 });
    expect(layout.lines[0].words[0]).toEqual({
      text: 'The',
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      fontSize: 0,
    });
  });

  it('survives zero-width OCR result without producing Infinity or NaN', () => {
    // Guard protects against ocrResult.width === 0, which would cause division by zero.
    // With contentRect.width > 0, the numerator is nonzero while denominator is zero,
    // yielding Infinity. Guard ensures scale = 0 instead, making all coordinates finite.
    const layout = layoutTextLayer(
      { width: 0, height: 500, lines: ocr.lines },
      { left: 0, top: 0, width: 1000, height: 500 }
    );
    for (const word of layout.lines[0].words) {
      expect(Number.isFinite(word.left)).toBe(true);
      expect(Number.isFinite(word.top)).toBe(true);
      expect(Number.isFinite(word.width)).toBe(true);
      expect(Number.isFinite(word.height)).toBe(true);
      expect(Number.isFinite(word.fontSize)).toBe(true);
    }
  });
});

describe('layoutToText', () => {
  it('joins words with spaces and lines with newlines', () => {
    const layout = layoutTextLayer(ocr, { left: 0, top: 0, width: 1000, height: 500 });
    expect(layoutToText(layout)).toBe('The quick\nbrown fox');
  });

  it('returns an empty string for an empty layout', () => {
    expect(layoutToText({ lines: [] })).toBe('');
  });
});
