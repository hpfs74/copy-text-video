/**
 * @typedef {{text:string, left:number, top:number, width:number, height:number, fontSize:number}} LayoutWord
 * @typedef {{text:string, words:LayoutWord[]}} LayoutLine
 * @typedef {{lines:LayoutLine[]}} Layout
 */

/**
 * Convert OCR boxes from captured-image pixels into CSS pixels relative to the
 * overlay root. The root is itself positioned at `contentRect`, so the offset
 * is deliberately NOT added here — doing so would double-count it.
 *
 * @param {{width:number, height:number, lines:Array}} ocrResult
 * @param {{left:number, top:number, width:number, height:number}} contentRect
 * @returns {Layout}
 */
export function layoutTextLayer(ocrResult, contentRect) {
  const scale = ocrResult.width > 0 ? contentRect.width / ocrResult.width : 0;

  const lines = ocrResult.lines.map((line) => ({
    text: line.text,
    words: line.words.map((word) => {
      const height = (word.bbox.y1 - word.bbox.y0) * scale;
      return {
        text: word.text,
        left: word.bbox.x0 * scale,
        top: word.bbox.y0 * scale,
        width: (word.bbox.x1 - word.bbox.x0) * scale,
        height,
        // Start from the box height; the render step corrects the horizontal
        // fit with a transform once the glyphs have actually been measured.
        fontSize: height,
      };
    }),
  }));

  return { lines };
}

/** Plain-text rendering of a layout, for the Copy all button. */
export function layoutToText(layout) {
  return layout.lines.map((line) => line.words.map((w) => w.text).join(' ')).join('\n');
}
