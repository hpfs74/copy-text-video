/**
 * @typedef {{left:number, top:number, width:number, height:number}} Rect
 * @typedef {{width:number, height:number}} Viewport
 * @typedef {{
 *   id: string,
 *   kind: 'video'|'canvas',
 *   rect: Rect,
 *   intrinsicWidth: number,
 *   intrinsicHeight: number,
 *   paused: boolean,
 *   objectFit: string,
 * }} Candidate
 */

/**
 * The rect of the actual picture inside the element. A 16:9 video in a 4:3
 * player is letterboxed, so the element rect is NOT where the pixels are.
 * Assumes the default `object-position: 50% 50%`.
 *
 * @returns {Rect}
 */
export function computeContentRect(rect, intrinsicWidth, intrinsicHeight, objectFit) {
  if (objectFit === 'fill') {
    return { ...rect };
  }

  const scaleX = rect.width / intrinsicWidth;
  const scaleY = rect.height / intrinsicHeight;

  let scale;
  if (objectFit === 'cover') scale = Math.max(scaleX, scaleY);
  else if (objectFit === 'none') scale = 1;
  else scale = Math.min(scaleX, scaleY); // 'contain' and anything unrecognised

  const width = intrinsicWidth * scale;
  const height = intrinsicHeight * scale;

  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

/** Area of the element actually inside the viewport, in square CSS pixels. */
export function visibleArea(rect, viewport) {
  const width = Math.max(
    0,
    Math.min(rect.left + rect.width, viewport.width) - Math.max(rect.left, 0)
  );
  const height = Math.max(
    0,
    Math.min(rect.top + rect.height, viewport.height) - Math.max(rect.top, 0)
  );
  return width * height;
}

function isEligible(candidate, viewport) {
  return (
    candidate.intrinsicWidth > 0 &&
    candidate.intrinsicHeight > 0 &&
    candidate.rect.width > 0 &&
    candidate.rect.height > 0 &&
    visibleArea(candidate.rect, viewport) > 0
  );
}

/**
 * Ranking: playing video, then any video, then canvas. Within a tier, the one
 * showing the most pixels on screen wins.
 *
 * @returns {Candidate|null}
 */
export function pickTarget(candidates, viewport) {
  const eligible = candidates.filter((c) => isEligible(c, viewport));
  if (eligible.length === 0) return null;

  const tier = (c) => {
    if (c.kind === 'video' && !c.paused) return 0;
    if (c.kind === 'video') return 1;
    return 2;
  };

  return eligible.reduce((best, candidate) => {
    const tierDelta = tier(candidate) - tier(best);
    if (tierDelta !== 0) return tierDelta < 0 ? candidate : best;
    return visibleArea(candidate.rect, viewport) > visibleArea(best.rect, viewport)
      ? candidate
      : best;
  });
}

let nextId = 0;

/**
 * Reads live DOM state into plain Candidate records. This is the only part of
 * this module that touches the DOM, and it is deliberately trivial — the
 * decision logic above stays testable without a browser.
 *
 * @returns {Array<Candidate & {element: Element}>}
 */
export function collectCandidates(doc = document) {
  const elements = [...doc.querySelectorAll('video, canvas')];

  return elements.map((element) => {
    const isVideo = element.tagName === 'VIDEO';
    const rect = element.getBoundingClientRect();
    return {
      id: `candidate-${nextId++}`,
      element,
      kind: isVideo ? 'video' : 'canvas',
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      intrinsicWidth: isVideo ? element.videoWidth : element.width,
      intrinsicHeight: isVideo ? element.videoHeight : element.height,
      paused: isVideo ? element.paused : true,
      objectFit: getComputedStyle(element).objectFit || 'contain',
    };
  });
}
