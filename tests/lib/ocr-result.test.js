import { describe, it, expect } from 'vitest';
import { normalizeRecognition } from '../../src/lib/ocr-result.js';

const word = (text, x0, confidence = 90) => ({
  text,
  confidence,
  bbox: { x0, y0: 10, x1: x0 + 40, y1: 30 },
});

describe('normalizeRecognition', () => {
  it('reads the nested block structure of tesseract v5+', () => {
    const data = {
      blocks: [
        {
          paragraphs: [
            { lines: [{ words: [word('The', 0), word('quick', 50)] }] },
            { lines: [{ words: [word('brown', 0)] }] },
          ],
        },
      ],
    };

    const result = normalizeRecognition(data, 800, 300);

    expect(result.width).toBe(800);
    expect(result.height).toBe(300);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].text).toBe('The quick');
    expect(result.lines[1].text).toBe('brown');
    expect(result.lines[0].words[1].bbox).toEqual({ x0: 50, y0: 10, x1: 90, y1: 30 });
  });

  it('reads the flat line structure of tesseract v4', () => {
    const data = {
      lines: [{ words: [word('Hello', 0), word('world', 60)] }],
    };

    const result = normalizeRecognition(data, 640, 480);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe('Hello world');
  });

  it('preserves reading order across blocks', () => {
    const data = {
      blocks: [
        { paragraphs: [{ lines: [{ words: [word('first', 0)] }] }] },
        { paragraphs: [{ lines: [{ words: [word('second', 0)] }] }] },
      ],
    };
    expect(normalizeRecognition(data, 100, 100).lines.map((l) => l.text)).toEqual([
      'first',
      'second',
    ]);
  });

  it('drops empty and whitespace-only words', () => {
    const data = { lines: [{ words: [word('real', 0), word('   ', 50), word('', 100)] }] };
    const result = normalizeRecognition(data, 100, 100);
    expect(result.lines[0].words).toHaveLength(1);
    expect(result.lines[0].text).toBe('real');
  });

  it('drops words below the confidence floor', () => {
    const data = { lines: [{ words: [word('good', 0, 80), word('junk', 50, 20)] }] };
    const result = normalizeRecognition(data, 100, 100);
    expect(result.lines[0].text).toBe('good');
  });

  it('drops words with a degenerate bounding box', () => {
    const data = {
      lines: [
        {
          words: [
            word('good', 0),
            { text: 'flat', confidence: 90, bbox: { x0: 5, y0: 5, x1: 5, y1: 25 } },
          ],
        },
      ],
    };
    expect(normalizeRecognition(data, 100, 100).lines[0].words).toHaveLength(1);
  });

  it('drops lines left with no words', () => {
    const data = { lines: [{ words: [word('kept', 0)] }, { words: [word('  ', 0)] }] };
    expect(normalizeRecognition(data, 100, 100).lines).toHaveLength(1);
  });

  it('trims surrounding whitespace from word text', () => {
    const data = { lines: [{ words: [word(' padded ', 0)] }] };
    expect(normalizeRecognition(data, 100, 100).lines[0].text).toBe('padded');
  });

  it('returns an empty result for output with no recognisable structure', () => {
    expect(normalizeRecognition({}, 100, 100)).toEqual({
      width: 100,
      height: 100,
      lines: [],
    });
  });
});
