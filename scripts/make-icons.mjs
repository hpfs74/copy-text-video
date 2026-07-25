#!/usr/bin/env node
/**
 * Generate the extension icons and the Web Store promo tile.
 *
 * Drawn in code rather than checked in as opaque binaries, so the design is
 * reviewable in a diff and every size is regenerable from one source of truth.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark: a dark screen showing a short paragraph of text, with a blue
 * selection band spanning two of its lines, and a play badge over the
 * bottom-right corner.
 *
 * The two-line selection is what makes it read as a drag-selection rather than
 * a single highlighted row, and the play badge is what makes it read as video
 * rather than a document. An earlier version used a video scrubber along the
 * bottom instead of the badge; it was indistinguishable from the text lines and
 * the whole mark looked like a row of sliders.
 *
 * Detail is dropped as the canvas shrinks: at 16px the play badge is omitted
 * entirely, because at that size it has to be so large in relative terms that
 * its halo eats the screen's corner.
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';

const ICON_SIZES = [16, 32, 48, 128];

const SCREEN_DARK = '#1B2130';
const SCREEN_LIGHT = '#2A3345';
const TEXT = '#E9ECF4';
const SELECTION = '#0A84FF';

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Draw the mark into an s×s box at (ox, oy). Every measurement is a fraction of
 * `s`, so the mark is identical at every size apart from the deliberate
 * detail-dropping below.
 */
function drawMark(ctx, s, ox = 0, oy = 0) {
  const detailed = s >= 32;
  const px = (f) => f * s;

  // Screen. A slight vertical gradient keeps it from looking like a flat
  // rectangle at 128px without muddying it at 16px.
  const inset = px(0.045);
  const gradient = ctx.createLinearGradient(ox, oy, ox, oy + s);
  gradient.addColorStop(0, SCREEN_LIGHT);
  gradient.addColorStop(1, SCREEN_DARK);
  ctx.fillStyle = gradient;
  roundRect(ctx, ox + inset, oy + inset, s - inset * 2, s - inset * 2, px(0.2));
  ctx.fill();

  // Thin lines of ragged width read as a paragraph of text. Thick rounded bars
  // read as sliders, which is the wrong idea entirely.
  const lineH = px(detailed ? 0.052 : 0.075);
  const left = ox + px(0.17);
  const lines = detailed
    ? [
        { y: 0.23, w: 0.5 },
        { y: 0.35, w: 0.58 },
        { y: 0.47, w: 0.42 },
        { y: 0.59, w: 0.28 },
      ]
    : [
        // No play badge at 16px (see below), so the text block gets the whole
        // screen and an extra line.
        { y: 0.24, w: 0.5 },
        { y: 0.43, w: 0.6 },
        { y: 0.62, w: 0.36 },
      ];

  // A selection spanning more than one line is what makes this unmistakably a
  // drag-selection rather than a single highlighted row. Square corners, because
  // that is what a real text selection looks like.
  const band = (lineIndex, widthFraction) => {
    const line = lines[lineIndex];
    ctx.fillStyle = SELECTION;
    ctx.fillRect(
      left - px(0.022),
      oy + px(line.y) - lineH * 0.55,
      px(line.w) * widthFraction + px(0.044),
      lineH * 2.1
    );
  };

  if (detailed) {
    band(1, 1);
    band(2, 0.68);
  } else {
    band(1, 0.8);
  }

  ctx.fillStyle = TEXT;
  for (const line of lines) {
    roundRect(ctx, left, oy + px(line.y), px(line.w), lineH, lineH * 0.35);
    ctx.fill();
  }

  // Play badge: the one element that says "video" at a glance. Sits over the
  // bottom-right corner, clear of the text block.
  //
  // Omitted at 16px: at that size the badge needs to be so large in relative
  // terms that its halo eats the screen's corner and the whole mark reads as
  // damaged. A legible silhouette beats complete semantics on a 16px canvas.
  if (!detailed) return;

  const r = px(0.2);
  const cx = ox + s - inset - r * 0.92;
  const cy = oy + s - inset - r * 0.92;

  ctx.fillStyle = SCREEN_DARK;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = SELECTION;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  const t = r * 0.52;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(cx - t * 0.55, cy - t);
  ctx.lineTo(cx + t * 0.85, cy);
  ctx.lineTo(cx - t * 0.55, cy + t);
  ctx.closePath();
  ctx.fill();
}

await mkdir('icons', { recursive: true });
await mkdir('store', { recursive: true });

for (const size of ICON_SIZES) {
  const canvas = createCanvas(size, size);
  drawMark(canvas.getContext('2d'), size);
  await writeFile(`icons/icon-${size}.png`, canvas.toBuffer('image/png'));
  console.log(`icons/icon-${size}.png`);
}

// Web Store small promo tile. Exactly 440×280 — the store rejects anything else.
const promo = createCanvas(440, 280);
const pctx = promo.getContext('2d');

const bg = pctx.createLinearGradient(0, 0, 440, 280);
bg.addColorStop(0, '#141924');
bg.addColorStop(1, '#232C40');
pctx.fillStyle = bg;
pctx.fillRect(0, 0, 440, 280);

drawMark(pctx, 132, 40, 74);

pctx.fillStyle = TEXT;
pctx.font = '600 34px -apple-system, Helvetica, Arial, sans-serif';
pctx.fillText('Video Text Select', 200, 128);

pctx.fillStyle = '#9AA4BC';
pctx.font = '400 19px -apple-system, Helvetica, Arial, sans-serif';
pctx.fillText('Copy text out of any', 200, 165);
pctx.fillText('paused video.', 200, 191);

await writeFile('store/promo-440x280.png', promo.toBuffer('image/png'));
console.log('store/promo-440x280.png');
