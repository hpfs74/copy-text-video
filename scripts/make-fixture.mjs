import { createCanvas } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';

const canvas = createCanvas(900, 320);
const ctx = canvas.getContext('2d');

ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, 900, 320);
ctx.fillStyle = '#000000';
ctx.font = '52px Helvetica';
ctx.fillText('The quick brown fox', 40, 110);
ctx.fillText('jumps over the lazy dog', 40, 210);

await mkdir('tests/fixtures', { recursive: true });
await writeFile('tests/fixtures/sample-frame.png', canvas.toBuffer('image/png'));
console.log('wrote tests/fixtures/sample-frame.png');
