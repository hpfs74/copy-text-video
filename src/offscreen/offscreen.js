import { createWorker } from 'tesseract.js';
import { MSG, ERROR } from '../lib/messages.js';
import { recognizeFrame } from './ocr.js';

let workerPromise = null;

/**
 * One worker for the life of the document. Loading the language model costs
 * seconds, so only the first capture of a session should pay for it.
 */
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract/core/'),
      langPath: chrome.runtime.getURL('vendor/tesseract/lang'),
      // Tesseract defaults to spawning its worker from a blob: URL, which the
      // extension CSP rejects. Load it from the packaged file instead.
      workerBlobURL: false,
      gzip: true,
    });
  }
  return workerPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.type === MSG.OCR_PING) {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type !== MSG.OCR_RUN) return false;

  (async () => {
    try {
      const worker = await getWorker();
      const result = await recognizeFrame(
        worker,
        message.dataUrl,
        message.width,
        message.height
      );
      sendResponse({ ok: true, result });
    } catch (error) {
      console.error('[vts] ocr failed', error);
      // A failed worker is usually unrecoverable; drop it so the next
      // request builds a fresh one.
      workerPromise = null;
      sendResponse({ ok: false, code: ERROR.OCR_FAILED });
    }
  })();

  return true; // keep the message channel open for the async response
});
