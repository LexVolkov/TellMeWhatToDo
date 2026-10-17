import { generate, T } from '../src/maze.js';
import { wallSprites } from '../src/render.js';
import { IMAGES } from '../src/assets.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
for (let seed = 1; seed <= 50; seed++) {
  const m = generate({ seed });
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    if (m.tiles[y * m.W + x] !== T.WALL) continue;
    let near = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((dx || dy) && xx >= 0 && yy >= 0 && xx < m.W && yy < m.H && m.tiles[yy * m.W + xx] !== T.WALL) near = true; }
    const sp = wallSprites(m, x, y);
    if (sp.some(([k]) => !IMAGES[k])) { bad++; console.log('missing asset', sp); }
    if (near && !sp.some(([k]) => k === 'wall_mid')) { bad++; if (bad < 10) console.log(`seed ${seed}: wall without a solid sprite ${x},${y}`); }
  }
}
function decode(file) {
  const b = readFileSync(file); let p = 8, idat = [], w, h, ct;
  while (p < b.length) { const l = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8); if (t === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); ct = b[p + 17]; } if (t === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + l)); p += 12 + l; }
  if (ct !== 6) throw new Error('expected RGBA: ' + file);
  const raw = inflateSync(Buffer.concat(idat)), st = w * 4 + 1, px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) { const f = raw[y * st]; for (let x = 0; x < w * 4; x++) { const r = raw[y * st + 1 + x], a = x >= 4 ? px[y * w * 4 + x - 4] : 0, u = y ? px[(y - 1) * w * 4 + x] : 0, c = y && x >= 4 ? px[(y - 1) * w * 4 + x - 4] : 0; let v; if (f === 0) v = r; else if (f === 1) v = r + a; else if (f === 2) v = r + u; else if (f === 3) v = r + ((a + u) >> 1); else { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? u : c); } px[y * w * 4 + x] = v & 255; } }
  return { w, h, px };
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function encode(w, h, px) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); const ih = Buffer.alloc(13); ih.writeUInt32BE(w); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const cache = {}; const img = k => cache[k] || (cache[k] = decode(join(ROOT, IMAGES[k])));
const m = generate({ seed: 1 }), TW = 22, TH = 19, TS = 16, S = 4, W = TW * TS, H = TH * TS, can = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) can.set([13, 10, 16, 255], i * 4);
const blit = (k, dx, dy, dw = TS, dh = TS) => { const s = img(k); for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const X = dx + x, Y = dy + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const si = ((y * s.h / dh | 0) * s.w + (x * s.w / dw | 0)) * 4; const a = s.px[si + 3] / 255; if (!a) continue; const di = (Y * W + X) * 4; for (let c = 0; c < 3; c++) can[di + c] = s.px[si + c] * a + can[di + c] * (1 - a); } };
const caps = [];
for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
  const t = m.tiles[y * m.W + x], px = x * TS, py = y * TS;
  if (t === T.WALL) {
    for (let yy = 0; yy < TS; yy++) for (let xx = 0; xx < TS; xx++) can.set([30, 22, 34, 255], ((py + yy) * W + px + xx) * 4);
    for (const [k, oy] of wallSprites(m, x, y)) blit(k, px, py + oy);
    if (y + 1 < m.H && m.tiles[(y + 1) * m.W + x] !== T.WALL) caps.push([px, py - TS]);
  } else { blit('floor_1', px, py); if (t === T.DOOR) blit('door_closed', px, py); }
}
for (const [x, y] of caps) blit('wall_top', x, y);
const big = Buffer.alloc(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) can.copy(big, (y * W * S + x) * 4, ((y / S | 0) * W + (x / S | 0)) * 4, ((y / S | 0) * W + (x / S | 0)) * 4 + 4);
writeFileSync(join(ROOT, 'tools/walls-preview.png'), encode(W * S, H * S, big));
console.log('preview: tools/walls-preview.png');
console.log(bad ? `RESULT: ${bad} problems` : 'RESULT: every wall next to the floor (8-neighbourhood) gets a solid sprite');
process.exit(bad ? 1 : 0);
