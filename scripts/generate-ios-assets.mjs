import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, renderPixel) {
  // Color type 2 = RGB (no alpha channel - required by Apple for App Store / IPA icons)
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = renderPixel(x, y, width, height);
      const idx = rowStart + 1 + x * 3;
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 2; // color type 2 (RGB)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance / point-in-polygon helpers in 128x128 SVG coordinate space
// SVG:
// <rect width="128" height="128" rx="30" fill="#101312"/>
// <path d="m64 20 38 82H79L64 68l-15 34H26z" fill="#d4f07d"/>
// <path d="m64 42 10 23H54z" fill="#101312"/>
// <circle cx="97" cy="30" r="7" fill="#d4f07d"/>
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const outerA = [
  [64, 20],
  [102, 102],
  [79, 102],
  [64, 68],
  [49, 102],
  [26, 102],
];
const innerHole = [
  [64, 42],
  [74, 65],
  [54, 65],
];

function sampleLogo128(ux, uy) {
  if (ux < 0 || ux >= 128 || uy < 0 || uy >= 128) return false;
  const dx = ux - 97;
  const dy = uy - 30;
  if (dx * dx + dy * dy <= 7 * 7) return true;
  if (pointInPoly(ux, uy, outerA) && !pointInPoly(ux, uy, innerHole)) return true;
  return false;
}

// 2x2 supersampled renderer for crisp anti-aliased edges
function makeIconRenderer(logoBoxSize, totalSize) {
  const offset = (totalSize - logoBoxSize) / 2;
  const scale = 128 / logoBoxSize;
  const bg = [0x10, 0x13, 0x12]; // #101312
  const fg = [0xd4, 0xf0, 0x7d]; // #d4f07d

  return (x, y) => {
    const lx = x - offset;
    const ly = y - offset;
    if (lx < -2 || ly < -2 || lx > logoBoxSize + 2 || ly > logoBoxSize + 2) return bg;
    let hits = 0;
    for (const sx of [0.25, 0.75]) {
      for (const sy of [0.25, 0.75]) {
        const ux = (lx + sx) * scale;
        const uy = (ly + sy) * scale;
        if (sampleLogo128(ux, uy)) hits++;
      }
    }
    if (hits === 0) return bg;
    if (hits === 4) return fg;
    const t = hits / 4;
    return [
      Math.round(bg[0] + (fg[0] - bg[0]) * t),
      Math.round(bg[1] + (fg[1] - bg[1]) * t),
      Math.round(bg[2] + (fg[2] - bg[2]) * t),
    ];
  };
}

const iconPath = path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
fs.writeFileSync(iconPath, encodePNG(1024, 1024, makeIconRenderer(860, 1024)));

const splashDir = path.join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset');
const splashPng = encodePNG(2732, 2732, makeIconRenderer(360, 2732));
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  fs.writeFileSync(path.join(splashDir, name), splashPng);
}

console.log('Generated branded iOS AppIcon (1024x1024) and Splash images (2732x2732).');
