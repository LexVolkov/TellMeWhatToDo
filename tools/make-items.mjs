import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];

const K = '#1a1420';
const METAL = { k: K, w: '#ffffff', l: '#c0c8d4', m: '#8890a0', d: '#5a6070', b: '#7a4a2a', g: '#e8b830', r: '#d03030' };
const ART = {
  sword: [
    '................', '............kkk.', '...........klwk.', '..........klwmk.', '.........klwmk..', '........klwmk...', '.......klwmk....', '..kk..klwmk.....',
    '..kgkklwmk......', '...kgkwmk.......', '....kgmk........', '....khkgk.......', '...khk.kgk......', '..khk...kk......', '.kpk............', '..k.............'],
  helmet: [
    '................', '.......kk.......', '......krrk......', '.....kkkkkk.....', '....kwllllmk....', '...kwlllllllmk..', '...klllllllllk..', '...kmkkkkkkkmk..',
    '...kmk.k.k.kmk..', '...kmkkkkkkkmk..', '...klllllllllk..', '...kmmmmmmmmmk..', '....kdddddddk...', '.....kkkkkkk....', '................', '................'],
  boots: [
    '................', '................', '................', '...kkkk..kkkk...', '...klmk..klmk...', '...klmk..klmk...', '...klmk..klmk...', '...klmk..klmk...',
    '...klmk..klmk...', '...kbbk..kbbk...', '...klmkk.klmkk..', '...klllmkklllmk.', '...kmmmmkkmmmmk.', '...kkkkkkkkkkkk.', '................', '................'],
  gloves: [
    '................', '................', '.....k.k.k......', '....klklklk.....', '....klklklk.k...', '....klklklkklk..', '....kllllllllk..', '....kllllllmk...',
    '....kllllllmk...', '....kmmmmmmmk...', '...kbbbbbbbbbk..', '...kdddddddddk..', '...kkkkkkkkkkk..', '................', '................', '................'],
  armor: [
    '................', '................', '...kkk....kkk...', '..kwlmk..kwlmk..', '.kwlllmkkwlllmk.', '.kllllllllllllk.', '.kmlllllllllmmk.', '..kklllgglllkk..',
    '...klllgglllk...', '...kllllllllk...', '...kmmmmmmmmk...', '...kbbbbbbbbk...', '...kmmmmmmmmk...', '...kkkkkkkkkk...', '................', '................'],
  potion: [
    '................', '......kkkk......', '......kcck......', '.......kk.......', '.......kgk......', '......kgggk.....', '.....kgwgggk....', '....kgwllllgk...',
    '....kwllllllk...', '....klllllllk...', '....kmllllllk...', '....kmmlllmmk...', '.....kmmmmmk....', '......kkkkk.....', '................', '................'],
  ring: [
    '................', '................', '.......kk.......', '......kGGk......', '.....kGWGGk.....', '.....kGGGGk.....', '....kykGGkyk....', '...kyk.kk.kyk...',
    '..kyk......kyk..', '..kyk......kyk..', '..kyk......kyk..', '...kyk....kyk...', '....kyykkyyk....', '.....kkkkkk.....', '................', '................'],
  key: [
    '................', '................', '................', '................', '..kkkk..........', '.kyyyyk.........', 'kyk..kykkkkkkkk.', 'ky....yyyyyyyyyk',
    'kyk..kykkkykkyk.', '.kyyyyk...kk.kk.', '..kkkk..........', '................', '................', '................', '................', '................'],
  compass: [
    '................', '.....kkkkkk.....', '....kbbbbbbk....', '...kbwwwwwwbk...', '..kbwwwrwwwwbk..', '..kbwwwrrwwwbk..', '..kbwwwrrwwwbk..', '..kbwwwkkwwwbk..',
    '..kbwwwddwwwbk..', '..kbwwwddwwwbk..', '..kbwwwwdwwwbk..', '...kbwwwwwwbk...', '....kbbbbbbk....', '.....kkkkkk.....', '................', '................'],
  slot: [
    '.kkkkkkkkkkkkkk.', ...Array(14).fill('kffffffffffffffk'), '.kkkkkkkkkkkkkk.'],
};
ART.slot[1] = 'kffffffffffffffk'.replace(/f/g, 'e').replace(/^ke/, 'kf').replace(/ek$/, 'fk');
const SWORDS = { white: ['#ffffff', '#e8ecf2', '#a8b0bc'], blue: ['#e0f4ff', '#7cc4ff', '#2f6fd0'], gold: ['#fffbd0', '#ffd84a', '#c08a10'], red: ['#ffe0e0', '#ff7070', '#c01c1c'] };
const RINGS = { str: '#e03030', agi: '#40c040', sta: '#e08020', luck: '#a050e0', spi: '#40d0e0' };
const ICONS = {};
for (const [n, [w, l, m]] of Object.entries(SWORDS)) ICONS['sword_' + n] = ['sword', { k: K, w, l, m, g: '#c89a3a', h: '#6a4022', p: '#c89a3a' }];
for (const n of ['helmet', 'boots', 'gloves', 'armor']) ICONS[n] = [n, METAL];
ICONS.potion_heal = ['potion', { k: K, c: '#8a5a30', g: '#cfe8ef', w: '#ffffff', l: '#e83a3a', m: '#9a1c2a' }];
ICONS.potion_shield = ['potion', { k: K, c: '#8a5a30', g: '#cfe8ef', w: '#ffffff', l: '#3aa0ff', m: '#1c4a9a' }];
for (const [n, c] of Object.entries(RINGS)) ICONS['ring_' + n] = ['ring', { k: K, y: '#e8b830', G: c, W: '#ffffff' }];
ICONS.key = ['key', { k: K, y: '#e8b830' }];
ICONS.key_white = ['key', { k: K, y: '#f4f4f8' }];
ICONS.key_yellow = ['key', { k: K, y: '#ffd52a' }];
ICONS.key_blue = ['key', { k: K, y: '#3a8cff' }];
ICONS.compass = ['compass', { k: K, b: '#c08a10', w: '#f2ead8', r: '#e03030', d: '#5a6070' }];
ICONS.slot = ['slot', { k: '#3a2c44', f: '#1d1724', e: '#2a2133' }];

function render(art, pal) {
  if (art.length !== 16) throw new Error('rows ' + art.length);
  const buf = Buffer.alloc(16 * 16 * 4);
  art.forEach((row, y) => {
    if (row.length !== 16) throw new Error(`row ${y} len ${row.length}: ${row}`);
    [...row].forEach((ch, x) => { if (ch === '.') return; const c = pal[ch]; if (!c) throw new Error('no color ' + ch); buf.set(hex(c), (y * 16 + x) * 4); });
  });
  return buf;
}
mkdirSync(join(ROOT, 'assets/items'), { recursive: true });
const names = Object.keys(ICONS), bufs = {};
for (const n of names) { const [a, p] = ICONS[n]; bufs[n] = render(ART[a], p); writeFileSync(join(ROOT, 'assets/items', n + '.png'), png(16, 16, bufs[n])); }
const S = 8, cols = 6, cell = 20 * S, rows = Math.ceil(names.length / cols);
const W = cols * cell, H = rows * cell, out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) out.set([40, 32, 48, 255], i * 4);
names.forEach((n, i) => {
  const ox = (i % cols) * cell + 2 * S, oy = Math.floor(i / cols) * cell + 2 * S, b = bufs[n];
  for (let y = 0; y < 16 * S; y++) for (let x = 0; x < 16 * S; x++) {
    const si = ((y / S | 0) * 16 + (x / S | 0)) * 4; if (b[si + 3] === 0) continue;
    out.set(b.subarray(si, si + 4), ((oy + y) * W + ox + x) * 4);
  }
});
writeFileSync(join(ROOT, 'tools/items-preview.png'), png(W, H, out));
console.log('icons:', names.length, names.join(', '));
