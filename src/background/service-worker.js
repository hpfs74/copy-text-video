import { MSG, ERROR } from '../lib/messages.js';

const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const OCR_TIMEOUT_MS = 15_000;

let creating = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length > 0) return;

  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['WORKERS'],
        justification: 'Runs the Tesseract OCR worker under the extension CSP.',
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

function withTimeout(promise, ms, code) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const error = new Error(code);
        error.code = code;
        reject(error);
      }, ms)
    ),
  ]);
}

// The keyboard command is a user gesture, which is what grants activeTab.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-frame') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content/index.js'],
    });
  } catch (error) {
    // Restricted pages (chrome://, the Web Store) simply cannot be scripted.
    console.warn('[vts] injection refused', error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MSG.OCR_RUN || message.target === 'offscreen') return false;

  (async () => {
    try {
      await ensureOffscreenDocument();
      const response = await withTimeout(
        chrome.runtime.sendMessage({ ...message, target: 'offscreen' }),
        OCR_TIMEOUT_MS,
        ERROR.OCR_TIMEOUT
      );
      sendResponse(response ?? { ok: false, code: ERROR.OCR_FAILED });
    } catch (error) {
      sendResponse({ ok: false, code: error.code ?? ERROR.OCR_FAILED });
    }
  })();

  return true;
});
