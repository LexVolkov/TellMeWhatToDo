import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgba) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const PAL = [[90, 12, 8], [150, 24, 10], [205, 60, 14], [240, 120, 20], [255, 190, 60], [255, 240, 150]];
const TAU = Math.PI * 2;
mkdirSync(join(ROOT, 'assets/tiles'), { recursive: true });
for (let f = 0; f < 3; f++) {
  const buf = Buffer.alloc(16 * 16 * 4), ph = f / 3 * TAU;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const u = x / 16 * TAU, v = y / 16 * TAU;
    let n = Math.sin(u + ph) + Math.sin(v * 2 - ph) * 0.7 + Math.sin(u + v + ph * 2) * 0.6 + Math.sin(u * 2 - v + ph) * 0.4;
    n = (n + 2.7) / 5.4; // 0..1
    const lvl = Math.max(0, Math.min(5, Math.floor(n * n * 7.2)));
    const c = PAL[lvl], i = (y * 16 + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  writeFileSync(join(ROOT, `assets/tiles/lava_f${f}.png`), png(16, 16, buf));
}
console.log('lava ok');
