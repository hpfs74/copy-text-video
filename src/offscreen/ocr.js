import { normalizeRecognition } from '../lib/ocr-result.js';

/**
 * Runs recognition and normalises the result. Kept free of any chrome.* API so
 * it can be exercised under Node in the integration test.
 *
 * @param {import('tesseract.js').Worker} worker
 * @param {string|Buffer|Blob} image data URL, buffer or blob
 */
export async function recognizeFrame(worker, image, width, height) {
  const { data } = await worker.recognize(image, {}, { blocks: true });
  return normalizeRecognition(data, width, height);
}
