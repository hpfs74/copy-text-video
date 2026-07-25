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

/**
 * Build the invisible, selectable DOM. Each word is a real text node so the
 * browser's own selection, highlight, double-click-word and clipboard handling
 * do all the work; nothing here implements copying.
 *
 * @param {Layout} layout
 * @param {Document} doc
 * @returns {HTMLElement}
 */
export function renderTextLayer(layout, doc) {
  const root = doc.createElement('div');
  root.className = 'vts-text-layer';

  for (const line of layout.lines) {
    const lineElement = doc.createElement('div');
    lineElement.className = 'vts-line';

    line.words.forEach((word, index) => {
      // A block element per line plus spaces between words is what makes the
      // copied text come out as "The quick brown fox\njumps over".
      if (index > 0) lineElement.appendChild(doc.createTextNode(' '));

      const span = doc.createElement('span');
      span.className = 'vts-word';
      span.textContent = word.text;
      span.style.left = `${word.left}px`;
      span.style.top = `${word.top}px`;
      span.style.height = `${word.height}px`;
      span.style.fontSize = `${word.fontSize}px`;
      span.dataset.width = String(word.width);
      lineElement.appendChild(span);
    });

    root.appendChild(lineElement);
  }

  return root;
}

/**
 * Squeeze or stretch each span horizontally so its glyphs span exactly the
 * width Tesseract measured. This is the pdf.js technique — without it the
 * selection highlight drifts away from the letters across a long line.
 *
 * @param {HTMLElement} root
 * @param {(span: HTMLElement) => number} measure injected for testability
 */
export function fitSpanWidths(root, measure = (span) => span.getBoundingClientRect().width) {
  for (const span of root.querySelectorAll('.vts-word')) {
    const target = Number(span.dataset.width);
    const natural = measure(span);
    if (!natural || !target) continue;
    span.style.transform = `scaleX(${target / natural})`;
  }
}
