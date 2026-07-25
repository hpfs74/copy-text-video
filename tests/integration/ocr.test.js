import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorker } from 'tesseract.js';
import { readFileSync } from 'node:fs';
import { recognizeFrame } from '../../src/offscreen/ocr.js';

let worker;

beforeAll(async () => {
  // In Node, Tesseract resolves these from the filesystem; in the extension
  // they are chrome-extension:// URLs. Same vendored files either way.
  worker = await createWorker('eng', 1, {
    langPath: 'vendor/tesseract/lang',
    gzip: true,
  });
}, 120_000);

afterAll(async () => {
  await worker?.terminate();
});

describe('recognizeFrame', () => {
  it('recovers both lines of text from a real image', async () => {
    const png = readFileSync('tests/fixtures/sample-frame.png');
    const result = await recognizeFrame(worker, png, 900, 320);

    expect(result.width).toBe(900);
    expect(result.height).toBe(320);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);

    const text = result.lines.map((line) => line.text).join(' ').toLowerCase();
    for (const expected of ['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog']) {
      expect(text).toContain(expected);
    }
  }, 120_000);

  it('returns word boxes inside the image bounds, ordered left to right', async () => {
    const png = readFileSync('tests/fixtures/sample-frame.png');
    const result = await recognizeFrame(worker, png, 900, 320);
    const words = result.lines[0].words;

    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.bbox.x0).toBeGreaterThanOrEqual(0);
      expect(w.bbox.x1).toBeLessThanOrEqual(900);
      expect(w.bbox.y1).toBeLessThanOrEqual(320);
    }
    for (let i = 1; i < words.length; i++) {
      expect(words[i].bbox.x0).toBeGreaterThan(words[i - 1].bbox.x0);
    }
  }, 120_000);
});
