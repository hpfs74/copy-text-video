import css from './overlay.css';
import { renderTextLayer, fitSpanWidths, layoutToText } from './text-layer.js';
import { ERROR_MESSAGE } from '../../lib/messages.js';

/**
 * @param {{
 *   frame: {dataUrl:string, width:number, height:number},
 *   contentRect: {left:number, top:number, width:number, height:number},
 *   doc?: Document,
 *   onDismiss?: () => void,
 * }} options
 */
export function mountOverlay({ frame, contentRect, doc = document, onDismiss = () => {} }) {
  const host = doc.createElement('div');
  host.style.all = 'initial';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  const root = doc.createElement('div');
  root.className = 'vts-root';
  root.dataset.state = 'scanning';
  applyRect(root, contentRect);

  const image = doc.createElement('img');
  image.className = 'vts-frame';
  image.src = frame.dataUrl;
  image.alt = '';
  root.appendChild(image);

  const status = doc.createElement('div');
  status.className = 'vts-status';
  status.hidden = true;
  root.appendChild(status);

  const controls = doc.createElement('div');
  controls.className = 'vts-controls';
  const copyAll = button(doc, 'Copy all', 'copy-all');
  const close = button(doc, 'Close', 'close');
  controls.append(copyAll, close);
  root.appendChild(controls);

  shadow.appendChild(root);

  // A fullscreen video renders above everything in the normal DOM, so an
  // overlay on document.body would simply be invisible.
  const container = doc.fullscreenElement ?? doc.body;
  container.appendChild(host);

  let textLayer = null;
  let currentLayout = { lines: [] };
  let dismissed = false;

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
    }
  }

  doc.addEventListener('keydown', onKeyDown, true);

  function teardown() {
    doc.removeEventListener('keydown', onKeyDown, true);
    host.remove();
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    teardown();
    onDismiss();
  }

  close.addEventListener('click', dismiss);
  copyAll.addEventListener('click', () => {
    navigator.clipboard.writeText(layoutToText(currentLayout)).then(
      () => setStatus('Copied'),
      () => setStatus('Could not copy')
    );
  });

  function setStatus(text) {
    status.textContent = text;
    status.hidden = false;
  }

  return {
    host,
    shadow,
    setLayout(layout) {
      currentLayout = layout;
      textLayer?.remove();
      textLayer = renderTextLayer(layout, doc);
      root.appendChild(textLayer);
      fitSpanWidths(textLayer);
      root.dataset.state = 'ready';
    },
    setStatus,
    setError(code) {
      root.dataset.state = 'ready';
      setStatus(ERROR_MESSAGE[code] ?? ERROR_MESSAGE.unknown);
    },
    reposition(rect) {
      applyRect(root, rect);
    },
    destroy() {
      if (dismissed) return;
      dismissed = true;
      teardown();
    },
  };
}

function applyRect(element, rect) {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function button(doc, label, action) {
  const element = doc.createElement('button');
  element.className = 'vts-button';
  element.textContent = label;
  element.dataset.action = action;
  return element;
}
