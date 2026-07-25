const TOAST_MS = 2600;

/** Transient message for failures that never get as far as an overlay. */
export function showToast(text, doc = document) {
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .toast {
        position: fixed;
        left: 50%;
        bottom: 48px;
        transform: translateX(-50%);
        z-index: 2147483647;
        padding: 10px 16px;
        border-radius: 8px;
        font: 13px -apple-system, BlinkMacSystemFont, sans-serif;
        color: #fff;
        background: rgba(0, 0, 0, 0.82);
        backdrop-filter: blur(8px);
        pointer-events: none;
      }
    </style>
    <div class="toast"></div>
  `;
  shadow.querySelector('.toast').textContent = text;
  doc.body.appendChild(host);
  setTimeout(() => host.remove(), TOAST_MS);
  return host;
}
