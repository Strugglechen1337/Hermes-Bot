#!/usr/bin/env node
/**
 * Generates original Hermes Bots cute robot-head PNG app icons
 * (180x180 for iOS apple-touch-icon, 512x512 for PWA manifest)
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
    raw[y * (stride + 1)] = 0;
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

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
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

function coverage(dist, aa) {
  return Math.max(0, Math.min(1, 0.5 - dist / aa));
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const aa = 2.0 / s;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const idx = (y * size + x) * 4;

      // Dark obsidian-navy gradient backdrop
      rgba[idx] = Math.round(23 * (1 - t) + 9 * t);
      rgba[idx + 1] = Math.round(28 * (1 - t) + 11 * t);
      rgba[idx + 2] = Math.round(43 * (1 - t) + 16 * t);
      rgba[idx + 3] = 255;

      const gx = (x + 0.5) / s;
      const gy = (y + 0.5) / s;

      // Warm subtle amber radial glow behind antenna/head
      const glowDist = Math.hypot(gx - 256, gy - 148) / 220;
      if (glowDist < 1) {
        const gAlpha = 0.25 * (1 - glowDist) * (1 - glowDist);
        blendPixel(rgba, idx, 245, 158, 11, gAlpha);
      }

      // Antenna stem
      const dStem = sdSegment(gx, gy, 256, 164, 256, 118) - 9;
      if (dStem < aa) blendPixel(rgba, idx, 203, 213, 225, coverage(dStem, aa));

      // Antenna amber orb + specular highlight
      const dOrb = sdCircle(gx, gy, 256, 102, 26);
      if (dOrb < aa) {
        const gt = Math.max(0, Math.min(1, (gy - 76) / 52));
        blendPixel(
          rgba,
          idx,
          Math.round(252 * (1 - gt) + 245 * gt),
          Math.round(211 * (1 - gt) + 158 * gt),
          Math.round(77 * (1 - gt) + 11 * gt),
          coverage(dOrb, aa)
        );
      }
      const dOrbHi = sdCircle(gx, gy, 248, 94, 7);
      if (dOrbHi < aa) blendPixel(rgba, idx, 255, 251, 235, 0.85 * coverage(dOrbHi, aa));

      // Side ear pods + amber accents
      const dEarL = sdRoundRect(gx, gy, 103, 280, 21, 42, 21);
      const dEarR = sdRoundRect(gx, gy, 409, 280, 21, 42, 21);
      const dEar = Math.min(dEarL, dEarR);
      if (dEar < aa) blendPixel(rgba, idx, 203, 213, 225, coverage(dEar, aa));

      const dEarAccentL = sdRoundRect(gx, gy, 99, 280, 6, 20, 6);
      const dEarAccentR = sdRoundRect(gx, gy, 413, 280, 6, 20, 6);
      const dEarAccent = Math.min(dEarAccentL, dEarAccentR);
      if (dEarAccent < aa) blendPixel(rgba, idx, 245, 158, 11, coverage(dEarAccent, aa));

      // Rounded cute robot head shell (white -> soft cool silver gradient)
      const dHead = sdRoundRect(gx, gy, 256, 278, 142, 118, 86);
      if (dHead < aa) {
        const ht = Math.max(0, Math.min(1, (gy - 160) / 236));
        blendPixel(
          rgba,
          idx,
          Math.round(255 * (1 - ht) + 219 * ht),
          Math.round(255 * (1 - ht) + 226 * ht),
          Math.round(255 * (1 - ht) + 240 * ht),
          coverage(dHead, aa)
        );
      }

      // Dark expressive visor screen
      const dVisor = sdRoundRect(gx, gy, 256, 277, 108, 71, 52);
      if (dVisor < aa) {
        const vt = Math.max(0, Math.min(1, (gy - 206) / 142));
        blendPixel(
          rgba,
          idx,
          Math.round(20 * (1 - vt) + 9 * vt),
          Math.round(25 * (1 - vt) + 11 * vt),
          Math.round(38 * (1 - vt) + 16 * vt),
          coverage(dVisor, aa)
        );
      }

      // Friendly glowing amber eyes + bright catchlights
      const dEyeL = sdCircle(gx, gy, 208, 268, 24);
      const dEyeR = sdCircle(gx, gy, 304, 268, 24);
      const dEye = Math.min(dEyeL, dEyeR);
      if (dEye < aa) blendPixel(rgba, idx, 251, 191, 36, coverage(dEye, aa));

      const dHiL = sdCircle(gx, gy, 200, 260, 7);
      const dHiR = sdCircle(gx, gy, 296, 260, 7);
      const dHi = Math.min(dHiL, dHiR);
      if (dHi < aa) blendPixel(rgba, idx, 255, 255, 255, coverage(dHi, aa));

      // Cute curved smile (circular arc centered at (256, 286), radius 36, lower arc)
      if (gy > 304 && gx >= 224 && gx <= 288) {
        const dArc = Math.abs(Math.hypot(gx - 256, gy - 285) - 36) - 5.5;
        const dCapL = sdCircle(gx, gy, 228, 310, 5.5);
        const dCapR = sdCircle(gx, gy, 284, 310, 5.5);
        const dSmile = Math.min(dArc, dCapL, dCapR);
        if (dSmile < aa) blendPixel(rgba, idx, 251, 191, 36, coverage(dSmile, aa));
      }
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.resolve(process.cwd(), "public");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-180.png"), renderIcon(180));
fs.writeFileSync(path.join(outDir, "icon-512.png"), renderIcon(512));
console.log("Generated cute robot-head public/icon-180.png and public/icon-512.png");
