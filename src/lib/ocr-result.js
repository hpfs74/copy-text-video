const MIN_CONFIDENCE = 40;

/**
 * @typedef {{x0:number, y0:number, x1:number, y1:number}} BBox
 * @typedef {{text:string, bbox:BBox, confidence:number}} OcrWord
 * @typedef {{text:string, words:OcrWord[]}} OcrLine
 * @typedef {{width:number, height:number, lines:OcrLine[]}} OcrResult
 */

/** Tesseract v5+ nests lines under blocks/paragraphs; v4 exposes them flat. */
function extractRawLines(data) {
  if (Array.isArray(data?.blocks)) {
    return data.blocks.flatMap((block) =>
      (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? [])
    );
  }
  if (Array.isArray(data?.lines)) return data.lines;
  return [];
}

function isUsableWord(word) {
  if (!word?.bbox) return false;
  if (!word.text?.trim()) return false;
  if ((word.confidence ?? 0) < MIN_CONFIDENCE) return false;
  return word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0;
}

/**
 * Collapse Tesseract's version-specific output into one stable shape, in
 * reading order, with unusable words removed.
 *
 * @returns {OcrResult}
 */
export function normalizeRecognition(data, imageWidth, imageHeight) {
  const lines = extractRawLines(data)
    .map((line) => {
      const words = (line.words ?? []).filter(isUsableWord).map((word) => ({
        text: word.text.trim(),
        bbox: { ...word.bbox },
        confidence: word.confidence ?? 0,
      }));
      return { text: words.map((w) => w.text).join(' '), words };
    })
    .filter((line) => line.words.length > 0);

  return { width: imageWidth, height: imageHeight, lines };
}
