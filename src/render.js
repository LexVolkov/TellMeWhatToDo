import { IMAGES, ENEMY, HERO, EMOTES } from './assets.js';
import { T } from './maze.js';
import { mimicTell } from './game.js';
export const KEY_RGB = { white: '#f4f4f8', yellow: '#ffd52a', blue: '#3a8cff' };
const TS = 16, STEP = 0.22;

export function wallSprites(m, x, y) {
  const open = (xx, yy) => xx >= 0 && yy >= 0 && xx < m.W && yy < m.H && m.tiles[yy * m.W + xx] !== T.WALL;
  let near = false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && open(x + dx, y + dy)) near = true;
  if (!near) return [];
  const out = [['wall_mid', 0]];
  if (!open(x, y + 1)) {
    if (open(x + 1, y)) out.push(['wall_edge_r', 0]);
    if (open(x - 1, y)) out.push(['wall_edge_l', 0]);
    if (open(x, y - 1)) out.push(['wall_top', -12]);
  }
  return out;
}

export class Renderer {
  constructor(canvas, imgs) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.img = imgs; this.bubble = null; this.cam = { x: 0, y: 0, zoom: 3, follow: true, init: false }; this.fitZoom = 1; }
  dpr() { return window.devicePixelRatio || 1; }
  clampZoom() { const c = this.cam; c.zoom = Math.max(Math.min(this.fitZoom * 0.9, 1), Math.min(10 * this.dpr(), c.zoom)); }
  zoomAt(factor, sx, sy) {
    const c = this.cam, d = this.dpr();
    const px = sx == null ? this.c.width / 2 : sx * d, py = sy == null ? this.c.height / 2 : sy * d;
    const wx = (px - this.ox) / this.scale, wy = (py - this.oy) / this.scale;
    c.zoom *= factor; this.clampZoom();
    if (sx != null) { c.follow = false; c.x = wx - (px - this.c.width / 2) / c.zoom; c.y = wy - (py - this.c.height / 2) / c.zoom; }
  }
  pan(dxCss, dyCss) { const c = this.cam, d = this.dpr(); c.follow = false; c.x -= dxCss * d / c.zoom; c.y -= dyCss * d / c.zoom; }
  panWorld(dx, dy) { this.cam.follow = false; this.cam.x += dx; this.cam.y += dy; }
  I(key) { return this.img[IMAGES[key]]; }
  say(text, emote, secs = 3.5, thought = false) { this.bubble = { text, emote, thought, until: performance.now() + secs * 1000 }; }

  draw(game) {
    const { c, ctx } = this, m = game.m, h = game.hero, t = game.time;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const cam = this.cam;
    this.fitZoom = Math.min(c.width / (m.W * TS), c.height / ((m.H + 1) * TS));
    if (!cam.init) { cam.zoom = Math.max(3 * dpr, this.fitZoom); cam.follow = true; cam.init = true; }
    this.clampZoom();
    if (cam.follow) { const [hx, hy] = this.lerpPos(h); cam.x = hx + 8; cam.y = hy + 8; }
    cam.x = Math.max(0, Math.min(m.W * TS, cam.x)); cam.y = Math.max(-TS, Math.min(m.H * TS, cam.y));
    const s = cam.zoom, ox = Math.round(c.width / 2 - cam.x * s), oy = Math.round(c.height / 2 - cam.y * s);
    this.scale = s; this.ox = ox; this.oy = oy;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d0a10'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(s, 0, 0, s, ox, oy); ctx.imageSmoothingEnabled = false;
    const d = (k, x, y, w = TS, hh = TS) => { const i = this.I(k); if (i) ctx.drawImage(i, x, y, w, hh); };
    const caps = [];
    const vx0 = Math.max(0, Math.floor(-ox / s / TS) - 1), vx1 = Math.min(m.W, Math.ceil((c.width - ox) / s / TS) + 1);
    const vy0 = Math.max(0, Math.floor(-oy / s / TS) - 1), vy1 = Math.min(m.H, Math.ceil((c.height - oy) / s / TS) + 2);
    for (let y = vy0; y < vy1; y++) for (let x = vx0; x < vx1; x++) {
      const tt = m.tiles[y * m.W + x], px = x * TS, py = y * TS;
      if (tt === T.WALL) {
        ctx.fillStyle = '#1e1622'; ctx.fillRect(px, py, TS, TS);
        for (const [k, oy2] of wallSprites(m, x, y)) d(k, px, py + oy2);
        if (y > 0 && m.tiles[(y + 1) * m.W + x] !== T.WALL && y + 1 < m.H) caps.push([px, py - TS]);
      } else if (tt === T.LAVA) {
        d('lava_' + ((Math.floor(t * 3) + x + y * 2) % 3), px, py);
      } else {
        const hsh = (x * 73856093 ^ y * 19349663) >>> 0;
        d(hsh % 7 === 0 ? 'floor_' + (2 + hsh % 7) : 'floor_1', px, py);
      }
    }
    for (const [cx, cy] of caps) d('wall_top', cx, cy);
    const tf = 'torch_' + (1 + Math.floor(t * 8) % 4);
    for (const r of m.rooms) if (r.type !== 'lava') { d(tf, (r.x0 + 1) * TS, (r.y0 - 1) * TS); d(tf, (r.x0 + r.w - 2) * TS, (r.y0 - 1) * TS); }
    for (const dr of m.doors) {
      const px = dr.x * TS, py = dr.y * TS;
      if (dr.open) { d('floor_1', px, py); continue; }
      ctx.fillStyle = '#000'; ctx.fillRect(px, py, TS, TS);
      d('door_closed', px, py);
      if (dr.color) { // colored lock, visible to the player
        ctx.strokeStyle = KEY_RGB[dr.color]; ctx.lineWidth = 1.5; ctx.strokeRect(px + 1, py + 1, TS - 2, TS - 2);
        if (dr.locked) { ctx.fillStyle = KEY_RGB[dr.color]; ctx.fillRect(px + 6, py + 7, 4, 4); ctx.fillStyle = '#1a1420'; ctx.fillRect(px + 7.5, py + 8, 1, 2); ctx.strokeStyle = KEY_RGB[dr.color]; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px + 8, py + 7, 1.6, Math.PI, 0); ctx.stroke(); }
      } else if (dr.lever) { // bars: opened by a lever somewhere else
        ctx.fillStyle = '#9aa0ac'; for (let k = 0; k < 4; k++) ctx.fillRect(px + 2 + k * 4, py + 1, 1.5, TS - 2); ctx.fillRect(px + 1, py + 4, TS - 2, 1.5); ctx.fillRect(px + 1, py + 11, TS - 2, 1.5);
      } else if (dr.locked) d('key_1', px + 4, py + 4, 8, 8);
    }
    const spF = e => { if (e.upAt == null) return -1; const k = t - e.upAt; return k < 0.06 ? 1 : k < 0.12 ? 2 : k < 0.85 ? 3 : k < 0.92 ? 2 : k < 1 ? 1 : -1; };
    for (const e of m.ents) {
      const px = e.x * TS, py = e.y * TS;
      if (e.kind === 'spikes') { const f = spF(e); if (f >= 0) d('spikes_' + f, px, py); else { ctx.globalAlpha = 0.4; d('spikes_1', px, py); ctx.globalAlpha = 1; } }
      else if (e.kind === 'stairs') d(e.down ? 'stairs_down' : 'stairs', px, py);
      else if (e.kind === 'lever') d(e.on ? 'lever_on' : 'lever_off', px, py);
      else if (e.kind === 'item' && !e.taken) d('item_' + e.item.id, px + 2, py + 2, 12, 12);
      else if (e.kind === 'chest') { if (!e.opened && e.contents === 'mimic') { const br = Math.sin(t * 2.2 + e.x) * 0.5; d(mimicTell(e, t) ? 'mimic_tell' : 'chest_full', px, py - br, TS, TS + br); } else d(e.opened ? (e.contents === 'empty' ? 'chest_empty_open' : 'chest_full_open') : 'chest_full', px, py); }
    }
    ctx.fillStyle = 'rgba(0,0,10,0.35)';
    for (const r of m.rooms) if (!h.visited.has(r.id)) ctx.fillRect(r.x0 * TS, r.y0 * TS, r.w * TS, r.h * TS);
    for (const e of m.ents) if (e.kind === 'monster') this.drawMonster(e);
    for (const s of game.shots || []) { // magic bolts
      const x = s.x * TS + 8, y = s.y * TS + 8, L = Math.hypot(s.vx, s.vy) || 1;
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#b36bff'; ctx.beginPath(); ctx.arc(x - s.vx / L * 4, y - s.vy / L * 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#e6c8ff'; ctx.beginPath(); ctx.arc(x, y, 2.2 + Math.sin(t * 30) * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (h.shield > 0) { const [sx, sy] = this.lerpPos(h); ctx.strokeStyle = 'rgba(90,170,255,' + (0.5 + 0.3 * Math.sin(t * 6)) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx + 8, sy + 6, 10, 0, Math.PI * 2); ctx.stroke(); }
    this.drawHero(h);
    this.drawCompass(game);
    for (const e of m.ents) if (e.kind === 'monster' && e.alive && e.hp < e.maxHp) {
      ctx.fillStyle = '#300'; ctx.fillRect(e.x * TS + 2, e.y * TS - 6, 12, 2);
      ctx.fillStyle = '#e33'; ctx.fillRect(e.x * TS + 2, e.y * TS - 6, 12 * e.hp / e.maxHp, 2);
    }
    this.drawBubble(h);
    this.drawMinimap(game);
  }
  // compass: a yellow arrow next to the hero pointing at the nearest uncollected key
  drawCompass(game) {
    const tg = game.compassTarget && game.compassTarget(); if (!tg) return;
    const ctx = this.ctx, [hx, hy] = this.lerpPos(game.hero), cx = hx + 8, cy = hy + 6;
    const a = Math.atan2(tg.y * TS + 8 - cy, tg.x * TS + 8 - cx), r = 13, pulse = 0.75 + 0.25 * Math.sin(game.time * 5);
    ctx.save(); ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.rotate(a); ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffd52a'; ctx.strokeStyle = '#5a3a00'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-3, -3); ctx.lineTo(-1.5, 0); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  // minimap (top-right, M toggles, click = move the camera there)
  miniRect(m) { const d = this.dpr(), cell = Math.max(5, Math.min(12, Math.floor(160 / m.cols))) * d; return { x: this.c.width - m.cols * cell - 10 * d, y: 10 * d, cell, w: m.cols * cell, h: m.rows * cell }; }
  drawMinimap(game) {
    if (this.miniOn === false || !game) return;
    const m = game.m, h = game.hero, ctx = this.ctx, R = this.miniRect(m), k = R.cell, d = this.dpr();
    this._mini = { R, m };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(10,8,14,0.75)'; ctx.fillRect(R.x - 3 * d, R.y - 3 * d, R.w + 6 * d, R.h + 6 * d);
    for (const r of m.rooms) {
      const x = R.x + r.cx * k, y = R.y + r.cy * k, seen = h.visited.has(r.id);
      ctx.fillStyle = r.type === 'lava' ? (seen ? '#c43' : '#5a2a22') : r.type === 'exit' || r.type === 'stairs' ? '#b93' : seen ? '#8a8496' : '#3a3442';
      ctx.fillRect(x + 1, y + 1, k - 2, k - 2);
    }
    ctx.fillStyle = '#6b6478';
    for (const dr of m.doors) { const A = m.rooms[dr.a], B = m.rooms[dr.b]; const x = R.x + (A.cx + B.cx + 1) / 2 * k, y = R.y + (A.cy + B.cy + 1) / 2 * k; ctx.fillStyle = dr.color && dr.locked ? KEY_RGB[dr.color] : dr.lever && dr.locked ? '#9aa0ac' : dr.locked ? '#fc4' : dr.open ? '#ddd' : '#6b6478'; ctx.fillRect(x - d, y - d, 2 * d, 2 * d); }
    const hr = m.rooms[h.room]; ctx.fillStyle = '#4f4'; ctx.beginPath(); ctx.arc(R.x + (hr.cx + 0.5) * k, R.y + (hr.cy + 0.5) * k, Math.max(2 * d, k * 0.28), 0, Math.PI * 2); ctx.fill();
    const c = this.cam; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = d;
    const vw = this.c.width / c.zoom, vh = this.c.height / c.zoom; // room = 7x6 tiles of 16 px
    ctx.strokeRect(R.x + (c.x - vw / 2) / (7 * 16) * k, R.y + (c.y - vh / 2) / (6 * 16) * k, vw / (7 * 16) * k, vh / (6 * 16) * k);
  }
  miniClick(cssX, cssY) {
    if (!this._mini || this.miniOn === false) return false;
    const { R, m } = this._mini, d = this.dpr(), x = cssX * d, y = cssY * d;
    if (x < R.x || y < R.y || x > R.x + R.w || y > R.y + R.h) return false;
    this.cam.follow = false; this.cam.x = (x - R.x) / R.cell * 7 * 16; this.cam.y = (y - R.y) / R.cell * 6 * 16; return true;
  }

  smooth(e) {
    const now = performance.now() / 1000;
    if (e._rt === now) return e;
    const dt = Math.min(0.1, e._rt == null ? 0 : now - e._rt); e._rt = now;
    if (e.rx == null || Math.hypot(e.x - e.rx, e.y - e.ry) > 2.5) { e.rx = e.x; e.ry = e.y; e.rv = 0; e.rvx = 0; return e; }
    const dx = e.x - e.rx, dy = e.y - e.ry, dist = Math.hypot(dx, dy);
    const vmax = Math.hypot(e.x - (e.px ?? e.x), e.y - (e.py ?? e.y)) / Math.max(0.12, e.stepDur || STEP) || 1 / (e.stepDur || STEP);
    const moving = (e.moveT || 0) < (e.stepDur || STEP) * 1.05;
    let v = Math.min(vmax * 1.15, (e.rv || 0) + vmax * dt / 0.12);
    if (!moving && dist < 0.35) v = Math.min(v, vmax * Math.max(0.25, dist / 0.35));
    if (dist < 1e-3) { e.rx = e.x; e.ry = e.y; e.rv = 0; e.rvx = 0; return e; }
    const st = Math.min(dist, v * dt);
    e.rx += dx / dist * st; e.ry += dy / dist * st; e.rv = v; e.rvx = dx / dist * v;
    return e;
  }
  lerpPos(e) { this.smooth(e); return [e.rx * TS, e.ry * TS]; }
  rMoving(e) { return (e.rv || 0) > 0.05 && Math.hypot(e.x - e.rx, e.y - e.ry) > 0.02; }
  rFace(e) { return Math.abs(e.rvx || 0) > 0.05 ? Math.sign(e.rvx) : (e.face || 1); }
  sheet(img, fw, t, fps, loop = true) {
    const n = Math.max(1, Math.floor(img.width / fw));
    let f = Math.floor(t * fps); f = loop ? f % n : Math.min(n - 1, f);
    return f;
  }
  drawMonster(e) {
    const ctx = this.ctx;
    if (e.type === 'boss') {
      if (!e.alive) return;
      this.smooth(e); const a = this.rMoving(e) ? 'run' : 'idle';
      const i = this.I(`boss_${a}_${Math.floor(performance.now() / 120) % 4}`); if (!i) return;
      const [x, y] = this.lerpPos(e);
      ctx.save(); ctx.translate(x + 8, y); if (this.rFace(e) < 0) ctx.scale(-1, 1);
      ctx.drawImage(i, -16, -20, 32, 36); ctx.restore(); return;
    }
    if (e.type === 'chomper') {
      if (!e.alive) return;
      this.smooth(e); const a = this.rMoving(e) ? 'run' : 'idle';
      const i = this.I(`chomp_${a}_${Math.floor(performance.now() / 110) % 4}`); if (!i) return;
      const [x, y] = this.lerpPos(e);
      ctx.save(); ctx.translate(x + 8, y); if (this.rFace(e) < 0) ctx.scale(-1, 1);
      ctx.drawImage(i, -8, -8, 16, 24); ctx.restore(); return;
    }
    if (e.type === 'mimic') { const i = this.I('mimic'); if (i && e.alive) ctx.drawImage(i, e.x * TS, e.y * TS, TS, TS); return; }
    const set = ENEMY[e.type]; if (!set) return;
    if (!e.alive && (e.animT || 0) > 3) return;
    this.smooth(e);
    const anim = e.alive ? (e.anim === 'walk' || e.anim === 'idle' || !e.anim ? (this.rMoving(e) ? 'walk' : 'idle') : e.anim) : 'death';
    const img = this.img[set[anim]] || this.img[set.idle]; if (!img) return;
    const f = this.sheet(img, 32, anim === 'idle' || anim === 'walk' ? performance.now() / 1000 : e.animT || 0, 12, e.alive && (anim === 'idle' || anim === 'walk'));
    const [x, y] = this.lerpPos(e);
    ctx.save(); ctx.translate(x + 8, y);
    if (this.rFace(e) < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, f * 32, 0, 32, 32, -16, -16, 32, 32);
    ctx.restore();
  }
  drawHero(h) {
    if (h.burnAt != null) { const ctx = this.ctx, [bx, by] = this.lerpPos(h), k = performance.now() / 80;
      ctx.save(); ctx.globalAlpha = 0.55 + 0.35 * Math.sin(k); ctx.fillStyle = Math.sin(k * 1.7) > 0 ? '#ff7a1a' : '#ffd23a';
      ctx.beginPath(); ctx.ellipse(bx + 8, by + 6, 7 + Math.sin(k) * 1.5, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    const ctx = this.ctx;
    this.smooth(h);
    let anim = h.anim; if (anim === 'walk' || anim === 'idle') anim = this.rMoving(h) ? 'walk' : 'idle';
    const layers = HERO[anim] || HERO.idle;
    const [x, y] = this.lerpPos(h);
    const time = anim === 'idle' || anim === 'walk' ? performance.now() / 1000 : h.animT;
    ctx.save(); ctx.translate(x + 8, y + 8);
    if ((anim === 'walk' ? this.rFace(h) : h.face) < 0) ctx.scale(-1, 1);
    for (const u of layers) {
      const img = this.img[u]; if (!img) continue;
      const f = this.sheet(img, 48, time, anim === 'death' ? 8 : 10, anim === 'idle' || anim === 'walk');
      ctx.drawImage(img, f * 48, 0, 48, 48, -24, -30, 48, 48);
    }
    ctx.restore();
  }
  drawBubble(h) {
    const b = this.bubble; if (!b || performance.now() > b.until) return;
    const ctx = this.ctx, [hx, hy] = this.lerpPos(h);
    const em = b.emote && this.img[EMOTES[b.emote]];
    if (em) ctx.drawImage(em, hx, hy - 30, TS, TS);
    if (!b.text) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = this.ox + (hx + 8) * this.scale, sy = this.oy + (hy - 32) * this.scale;
    const fs = Math.max(14, Math.round(this.scale * 7));
    ctx.font = `${b.thought ? 'italic ' : 'bold '}${fs}px sans-serif`;
    const w = ctx.measureText(b.text).width + fs;
    const bx = Math.min(Math.max(4, sx - w / 2), this.c.width - w - 4), by = sy - fs * 1.8;
    ctx.fillStyle = b.thought ? 'rgba(225,232,250,0.9)' : 'rgba(255,250,235,0.95)'; ctx.strokeStyle = b.thought ? '#6a7090' : '#222'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, fs * 1.6, b.thought ? fs * 0.8 : 6) : ctx.rect(bx, by, w, fs * 1.6); ctx.fill(); ctx.stroke();
    if (b.thought) for (const [k, r] of [[0.35, 0.22], [0.7, 0.13]]) { ctx.beginPath(); ctx.arc(sx - fs * k, by + fs * 1.6 + fs * k * 1.1, fs * r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#222'; ctx.textBaseline = 'middle'; ctx.fillText(b.text, bx + fs / 2, by + fs * 0.8);
  }
}
