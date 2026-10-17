import { generate, T } from '../src/maze.js';
import { wallSprites } from '../src/render.js';
import { IMAGES } from '../src/assets.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
// lever preview: off / on sprites at 4x, and the blue lever room of floor -2 as it is generated
const m = generate({ seed: 1, floor: 2 }), TS = 16, S = 4, KEY_RGB = { white: [244, 244, 248], yellow: [255, 213, 42], blue: [58, 140, 255] };
const r = m.rooms.find(r => r.type === 'lever'), lv = m.ents.find(e => e.kind === 'lever');
if (!r || !lv || lv.room !== r.id) throw new Error('no lever in the blue room');
const c = { x0: r.x0 - 1, y0: r.y0 - 2, w: r.w + 2, h: r.h + 3 };
const SW = 2 * TS + 6, W = SW + c.w * TS, H = Math.max(2 * TS + 14, c.h * TS), can = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) can.set([13, 10, 16, 255], i * 4);
const blit = (k, dx, dy, dw = TS, dh = TS) => { const s = img(k); for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const X = dx + x, Y = dy + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const si = ((y * s.h / dh | 0) * s.w + (x * s.w / dw | 0)) * 4; const a = s.px[si + 3] / 255; if (!a) continue; const di = (Y * W + X) * 4; for (let q = 0; q < 3; q++) can[di + q] = s.px[si + q] * a + can[di + q] * (1 - a); } };
const rect = (x, y, w, h, rgb) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < H) can.set([...rgb, 255], (yy * W + xx) * 4); };
// sprites: floor tile + lever off (top) and on (bottom)
blit('floor_1', 2, 2); blit('lever_off', 2, 2); blit('floor_1', 2, TS + 10); blit('lever_on', 2, TS + 10);
blit('lever_off', TS + 4, 2); blit('lever_on', TS + 4, TS + 10);
// the room
const caps = [];
for (let y = c.y0; y < c.y0 + c.h; y++) for (let x = c.x0; x < c.x0 + c.w; x++) {
  if (x < 0 || y < 0 || x >= m.W || y >= m.H) continue;
  const t = m.tiles[y * m.W + x], px = SW + (x - c.x0) * TS, py = (y - c.y0) * TS;
  if (t === T.WALL) { rect(px, py, TS, TS, [30, 22, 34]); for (const [k, oy] of wallSprites(m, x, y)) blit(k, px, py + oy); if (y + 1 < m.H && m.tiles[(y + 1) * m.W + x] !== T.WALL) caps.push([px, py - TS]); }
  else if (t === T.LAVA) blit('lava_' + ((x + y * 2) % 3), px, py);
  else {
    blit('floor_1', px, py);
    if (t === T.DOOR) { const d = m.doors.find(d => d.x === x && d.y === y); blit('door_closed', px, py); if (d.color) { const col = KEY_RGB[d.color]; rect(px + 1, py + 1, TS - 2, 1, col); rect(px + 1, py + TS - 2, TS - 2, 1, col); rect(px + 1, py + 1, 1, TS - 2, col); rect(px + TS - 2, py + 1, 1, TS - 2, col); rect(px + 6, py + 7, 4, 4, col); } }
  }
  for (const e of m.ents) if (e.x === x && e.y === y) { if (e.kind === 'lever') blit(e.on ? 'lever_on' : 'lever_off', px, py); if (e.kind === 'chest') blit('chest_full', px, py); }
}
for (const [x, y] of caps) blit('wall_top', x, y);
const big = Buffer.alloc(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) can.copy(big, (y * W * S + x) * 4, ((y / S | 0) * W + (x / S | 0)) * 4, ((y / S | 0) * W + (x / S | 0)) * 4 + 4);
writeFileSync(join(ROOT, 'tools/lever-preview.png'), encode(W * S, H * S, big));
console.log(`lever-preview: tools/lever-preview.png ${W * S}x${H * S} (left: off/on on floor and bare; right: blue lever room ${r.id}, floor -2, seed 1, lever at ${lv.x},${lv.y}, chests in room: ${m.ents.filter(e => e.kind === 'chest' && e.room === r.id).length})`);