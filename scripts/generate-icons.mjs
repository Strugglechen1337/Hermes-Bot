#!/usr/bin/env node
/**
 * Generates original PNG app icons (180x180 for iOS apple-touch-icon, 512x512 for PWA manifest)
 * with zero external dependencies using Node's built-in zlib.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = wx * vx + wy * vy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function blendPixel(rgba, idx, r, g, b, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  const inv = 1 - a;
  rgba[idx] = Math.round(r * a + rgba[idx] * inv);
  rgba[idx + 1] = Math.round(g * a + rgba[idx + 1] * inv);
  rgba[idx + 2] = Math.round(b * a + rgba[idx + 2] * inv);
  rgba[idx + 3] = 255;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 512;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const idx = (y * size + x) * 4;
      // Dark obsidian gradient background
      rgba[idx] = Math.round(20 * (1 - t) + 9 * t);
      rgba[idx + 1] = Math.round(25 * (1 - t) + 11 * t);
      rgba[idx + 2] = Math.round(38 * (1 - t) + 16 * t);
      rgba[idx + 3] = 255;

      const gx = x / s;
      const gy = y / s;

      // Subtle gradient color for the H pillars
      const gt = Math.max(0, Math.min(1, (gx + gy - 200) / 520));
      const ar = Math.round(245 * (1 - gt) + 129 * gt);
      const ag = Math.round(158 * (1 - gt) + 140 * gt);
      const ab = Math.round(11 * (1 - gt) + 248 * gt);

      // Left vertical bar
      const dLeft = distToSegment(gx, gy, 158, 136, 158, 376);
      if (dLeft < 21) blendPixel(rgba, idx, ar, ag, ab, Math.min(1, (21 - dLeft) / 2.2));

      // Right vertical bar
      const dRight = distToSegment(gx, gy, 354, 136, 354, 376);
      if (dRight < 21) blendPixel(rgba, idx, ar, ag, ab, Math.min(1, (21 - dRight) / 2.2));

      // Center horizontal crossbar
      const dMid = distToSegment(gx, gy, 158, 256, 354, 256);
      if (dMid < 18) blendPixel(rgba, idx, 248, 250, 252, Math.min(1, (18 - dMid) / 2.2));

      // Top-right warm amber signal dot
      const dDot = Math.hypot(gx - 354, gy - 136);
      if (dDot < 26) blendPixel(rgba, idx, 245, 158, 11, Math.min(1, (26 - dDot) / 2.2));
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.resolve(process.cwd(), "public");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-180.png"), renderIcon(180));
fs.writeFileSync(path.join(outDir, "icon-512.png"), renderIcon(512));
console.log("Generated public/icon-180.png and public/icon-512.png");
