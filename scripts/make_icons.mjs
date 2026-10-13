/**
 * Generate the PWA icons.
 *
 *     node scripts/make_icons.mjs
 *
 * Writes PNGs into public/. There is no image library in this project, so the
 * icons are rasterised here and encoded by hand — a few rectangles, a triangle
 * and a round cap, 4x supersampled, deflated into a PNG.
 *
 * The mark is a knight's move: two squares up, one to the left. It matches the
 * bent arrows the board draws for knight moves.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BACKGROUND = [61, 107, 48]; // deep green
const FOREGROUND = [244, 243, 241]; // app cream
const SAMPLES = 4;

// Geometry in 0..1 of the canvas, before any centre scaling.
const BAR = 0.055; // half the stroke width
const X = 0.62; // file the knight travels up
const TOP = 0.38; // rank it turns on
const BOTTOM = 0.8; // where it starts
const HEAD = 0.2; // arrow tip
const HEAD_BASE = 0.38;
const HEAD_HALF = 0.1;

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function inMark(x, y) {
  if (inRect(x, y, X - BAR, TOP - BAR, X + BAR, BOTTOM)) return true; // up the file
  if (inRect(x, y, HEAD_BASE - 0.02, TOP - BAR, X + BAR, TOP + BAR)) return true; // across
  if ((x - X) ** 2 + (y - BOTTOM) ** 2 <= BAR ** 2) return true; // round cap at the start
  return inTriangle(x, y, HEAD, TOP, HEAD_BASE, TOP - HEAD_HALF, HEAD_BASE, TOP + HEAD_HALF);
}

/** RGBA pixels for one icon. `scale` shrinks the mark about the centre. */
function raster(size, scale) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          // Undo the centre scaling to test against the unscaled geometry.
          if (inMark((x - 0.5) / scale + 0.5, (y - 0.5) / scale + 0.5)) hits += 1;
        }
      }
      const coverage = hits / (SAMPLES * SAMPLES);
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          BACKGROUND[channel] + (FOREGROUND[channel] - BACKGROUND[channel]) * coverage,
        );
      }
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const OUT = new URL('../public/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const icons = [
  // Maskable icons are cropped to a circle by Android, so the mark is shrunk to
  // stay inside the safe zone.
  ['pwa-192.png', 192, 1],
  ['pwa-512.png', 512, 1],
  ['maskable-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 0.92],
  ['favicon-32.png', 32, 1],
];

for (const [name, size, scale] of icons) {
  const file = new URL(name, OUT);
  writeFileSync(file, png(size, raster(size, scale)));
  console.log(`wrote public/${name} (${size}x${size})`);
}
