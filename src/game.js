import { generate, startPos, roomOfTile, doorDir, otherRoom, T, DIRS, monsterStats, BAL, FLOORS, keyLocations } from './maze.js';
import { astar } from './path.js';
import { ITEMS, INV_SIZE, HEAL, SHIELD_AMT, SHIELD_TIME, makeItem, def, heroStats, rollLoot } from './items.js';

export const STEP = 0.33;
export const BOLT = { speed: 4.5, cd: 2.8, range: 6, keep: 3 }; // mage bolt
const CHOMP_STEP = 0.5, CHOMP_GIVEUP = 6; // chomper chase
const WANDER_STEP = 1.1, ATTACK_CD = 0.6, MON_STEP = 0.7, MON_ATK = 2.3;
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
// idle thoughts are localized in i18n ('thoughts'); the game only emits an index
export const THOUGHT_COUNT = 15;
export const FLOOR_COUNT = FLOORS.length;
// subtle mimic tell for the player (the hero never sees it): a brief 'teeth' frame now and then
export function mimicTell(e, t) { if (e.contents !== 'mimic' || e.opened) return false; let h = 0; for (const c of String(e.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const p = 3.2 + (h % 7) * 0.25, ph = (h % 100) / 100 * p; return ((t + ph) % p) < 0.22; }
// hero autonomy: reacts on his own only while no human plan step is active; any human command interrupts it
export const IDLE_TIMEOUT = { min: 12, max: 20 }; // seconds without commands before he may wander off
export const AUTO = { grace: 2, exploreChance: 0.6, unclearChance: 0.5, fleeHp: 0.4, fleeMin: 2, fleeCd: 5, pickChance: 0.5, weak: ['skeleton', 'skeleton2'] };

export class Game {
  constructor(opts = {}) { this.listeners = []; this.rand = Math.random; this.reset(opts); }
  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { for (const f of this.listeners) f(type, data); }

  reset(opts = {}) {
    this.opts = { ...opts }; delete this.opts.floor; this.floor = Math.min(FLOORS.length - 1, opts.floor || 0); // opts.floor: start deeper (tests)
    this.baseSeed = opts.seed ?? (Date.now() & 0xffffffff);
    this.m = generate({ ...this.opts, seed: this.floorSeed(this.floor), floor: this.floor }); this.floorLog = [{ floor: this.floor, at: 0 }];
    const r0 = this.m.rooms[this.m.start];
    const [sx, sy] = startPos(r0);
    this.hero = { x: sx, y: sy, px: sx, py: sy, hp: 10, gold: 0, lastDir: 'north',
      base: { str: 0, agi: 0, sta: 0, luck: 0, spi: 0 }, inv: Array(INV_SIZE).fill(null),
      equip: { weapon: makeItem('sword_white'), head: null, body: null, hands: null, feet: null }, shield: 0, shieldUntil: 0,
      room: this.m.start, prevRoom: null, visited: new Set([this.m.start]), cd: 0, moveT: 0, face: 1, anim: 'idle', animT: 0,
      looking: 0, dead: false, won: false };
    const h = this.hero;
    Object.defineProperty(h, 'keys', { get: () => h.inv.filter(i => i && /^key/.test(i.id)).length });
    h.keysOf = c => h.inv.filter(i => i && i.id === 'key_' + c).length;
    h.inv[0] = makeItem('potion_heal');
    if (opts.compass) h.inv[1] = makeItem('compass'); // debug flag 'compass'
    h.hp = this.stats().maxHp;
    this.time = 0; this.auto = opts.auto !== false; this.hold = false; this.quietAt = 0; this.idleDue = this.rollIdle(); this.unclearAt = -1; this.boltHitAt = -1; this.fleeAt = -99; this.autoChest = null; this.fledFrom = new Set();
    this.shots = []; this.goal = null; this.queue = []; this.time = 0; this.spikeHitAt = -1; this.thinkAt = 4; this.moves = 0;
    this.emit('reset');
  }
  stats() { return heroStats(this.hero); }
  floorSeed(f) { return f ? (this.baseSeed + f * 104729) | 0 : this.baseSeed; }
  rollIdle() { return (this.time || 0) + IDLE_TIMEOUT.min + (this.rand ? this.rand() : 0.5) * (IDLE_TIMEOUT.max - IDLE_TIMEOUT.min); }
  noteCommand() { this.quietAt = this.time; this.idleDue = this.rollIdle(); this.autoChest = null; this.unclearAt = -1; }
  unclear() { this.unclearAt = this.time; }
  startAuto(spec, kind, extra = {}) { this.goal = { ...spec, label: 'auto_' + kind, auto: true, t: 0 }; this.idleDue = this.rollIdle(); this.emit('auto', { kind, ...extra }); return true; }
  // returns true when it started an autonomous goal this tick
  autonomy() {
    const h = this.hero, cur = this.goal;
    if (this.hold || this.queue.length || (cur && !cur.auto)) return false;
    const mons = this.monstersIn(h.room);
    // 1) hit by a bolt, or low HP among several enemies -> run back the way he came
    if (!(cur && cur.type === 'flee') && this.time - this.fleeAt > AUTO.fleeCd) {
      const bolt = this.boltHitAt >= 0 && this.time - this.boltHitAt < 0.6 && mons.length > 0 && !this.fledFrom.has(h.room); // a bolt scares him once per room; sent back, he trusts you
      const low = h.hp < this.stats().maxHp * AUTO.fleeHp && mons.length >= AUTO.fleeMin;
      this.boltHitAt = -1;
      const d = h.prevRoom == null ? null : this.doorsOfRoom(h.room).find(d => otherRoom(d, h.room) === h.prevRoom);
      if ((bolt || low) && d) { this.fleeAt = this.time; this.fledFrom.add(h.room); return this.startAuto({ type: 'flee', door: d.id }, 'flee', { why: bolt ? 'bolt' : 'hp' }); }
    }
    if (cur || this.time - this.quietAt < AUTO.grace) return false;
    // 2) exactly one weak enemy -> deal with it himself
    if (mons.length === 1 && AUTO.weak.includes(mons[0].type)) return this.startAuto({ type: 'attack', target: mons[0].id }, 'attack', { mon: mons[0].type });
    if (mons.length) return false;
    // 3) chest -> open it, then maybe grab one of the things that fell out
    if (this.autoChest) {
      const c = this.ent(this.autoChest);
      if (!c || c.kind !== 'chest' || c.room !== h.room) this.autoChest = null;
      else if (c.opened) {
        this.autoChest = null;
        const items = (c.spilled || []).map(id => this.ent(id)).filter(e => e && e.kind === 'item' && !e.taken);
        if (items.length && this.rand() < AUTO.pickChance) { const e = items[Math.floor(this.rand() * items.length)]; return this.startAuto({ type: 'pick', target: e.id }, 'pick', { item: e.item.id }); }
      } else return false;
    }
    const chest = this.ents.find(e => e.kind === 'chest' && !e.opened && e.room === h.room);
    if (chest) { this.autoChest = chest.id; return this.startAuto({ type: 'chest', target: chest.id }, 'chest'); }
    // 4) bored (no command for a while) or the last command was not understood -> peek into a neighbouring room
    let go = false;
    if (this.unclearAt >= 0) { this.unclearAt = -1; go = this.rand() < AUTO.unclearChance; }
    if (!go && this.time >= this.idleDue) { this.idleDue = this.rollIdle(); go = this.rand() < AUTO.exploreChance; }
    if (!go) return false;
    const doors = this.doorsOfRoom(h.room), unk = doors.filter(d => !h.visited.has(otherRoom(d, h.room))); // he knows nothing about lava/traps behind them
    const pool = unk.length ? unk : doors; if (!pool.length) return false;
    const d = pool[Math.floor(this.rand() * pool.length)];
    return this.startAuto({ type: 'go', door: d.id, dir: doorDir(this.m, d, h.room) }, 'explore', { dir: doorDir(this.m, d, h.room) });
  }
  get ents() { return this.m.ents; }
  ent(id) { return this.m.ents.find(e => e.id === id) || this.m.doorById[id]; }
  monstersIn(room) { return this.ents.filter(e => e.kind === 'monster' && e.alive && e.room === room); }
  itemsIn(room) { return this.ents.filter(e => e.kind === 'item' && !e.taken && e.room === room); }
  spikeUp(e) { return e.upAt != null && this.time - e.upAt < 1.0; }
  doorsOfRoom(room) { return this.m.rooms[room].doors.map(id => this.m.doorById[id]); }
  tile(x, y) { return this.m.tiles[y * this.m.W + x]; }

  findItem(id) { return this.hero.inv.find(i => i && i.id === id); }
  invItem(uid) { return this.hero.inv.find(i => i && i.uid === uid); }
  removeItem(it) { const h = this.hero, k = h.inv.indexOf(it); if (k >= 0) h.inv[k] = null; this.emit('inv'); }
  floorFree(x, y, room) {
    return this.tile(x, y) === T.FLOOR && roomOfTile(this.m, x, y) === room &&
      !this.ents.some(e => e.x === x && e.y === y && (e.kind !== 'monster' || e.alive) && !(e.kind === 'item' && e.taken));
  }
  freeAround(x, y, room) {
    for (let r = 1; r <= 3; r++) {
      const cand = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.floorFree(x + dx, y + dy, room)) cand.push([x + dx, y + dy]);
      if (cand.length) return cand[Math.floor(this.rand() * cand.length)];
    }
    return null;
  }
  placeOnFloor(it, x, y, room) {
    const p = this.floorFree(x, y, room) ? [x, y] : this.freeAround(x, y, room) || [x, y];
    const e = { id: 'drop' + it.uid, kind: 'item', item: it, x: p[0], y: p[1], room };
    this.ents.push(e); return e;
  }
  putInv(it) {
    const h = this.hero, k = h.inv.indexOf(null);
    if (k < 0) { this.placeOnFloor(it, h.x, h.y, h.room); this.emit('leftItem', { item: it, why: 'full' }); return false; }
    h.inv[k] = it; this.emit('inv'); return true;
  }
  equipItem(it) {
    const h = this.hero, d = def(it); if (!d.slot) return false;
    this.removeItem(it);
    const old = h.equip[d.slot]; h.equip[d.slot] = it;
    this.emit('equip', { item: it, old });
    if (old) this.putInv(old);
    h.hp = Math.min(h.hp, this.stats().maxHp);
    return true;
  }
  drinkItem(it) {
    const h = this.hero, d = def(it);
    this.removeItem(it); h.cd = 0.6;
    if (d.use === 'heal') h.hp = Math.min(this.stats().maxHp, h.hp + HEAL);
    else { h.shield = SHIELD_AMT; h.shieldUntil = this.time + SHIELD_TIME; }
    this.emit('drink', { item: it.id });
  }
  dropItem(it) { this.removeItem(it); const h = this.hero; this.placeOnFloor(it, h.x, h.y, h.room); this.emit('dropped', { item: it }); }

  hitHero(raw, src) {
    const h = this.hero, s = this.stats(); if (h.dead || h.won) return;
    if (this.rand() < s.dodge) { this.emit('dodge', { src }); return; }
    let n = raw * (1 - s.reduce);
    n = Math.floor(n) + (this.rand() < n % 1 ? 1 : 0);
    if (h.shield > 0 && this.time < h.shieldUntil) { const a = Math.min(h.shield, n); h.shield -= a; n -= a; if (a) this.emit('absorb', { a }); }
    if (n <= 0) { this.emit('blocked', { src }); return; }
    this.damageHero(n, src);
  }
  damageHero(n, src) {
    const h = this.hero; if (h.dead || h.won) return;
    if (this.opts.god) { h.anim = 'hurt'; h.animT = 0; this.emit('heroHurt', { n, src, god: true }); return; } // debug flag 'god': effects, no damage
    h.hp = Math.max(0, h.hp - n); h.anim = 'hurt'; h.animT = 0;
    this.emit('heroHurt', { n, src });
    if (h.hp <= 0) { h.dead = true; h.anim = 'death'; h.animT = 0; this.goal = null; this.queue = []; this.emit('heroDead'); }
  }
  attack(mon) {
    const h = this.hero; h.cd = ATTACK_CD; h.anim = 'attack'; h.animT = 0; h.face = mon.x >= h.x ? 1 : -1;
    const s = this.stats(), crit = this.rand() < s.crit, dmg = s.dmg * (crit ? 2 : 1);
    mon.hp -= dmg; mon.anim = 'hurt'; mon.animT = 0;
    this.emit('hit', { target: mon.id, dmg, crit });
    if (mon.hp <= 0) {
      mon.alive = false; mon.anim = 'death'; mon.animT = 0; this.emit('monsterDead', { id: mon.id, type: mon.type });
      const dep = this.m.depth[mon.room] || 0;
      if (mon.carry) { const k = this.placeOnFloor(makeItem(mon.carry), mon.x, mon.y, mon.room); mon.carry = null; this.emit('keyDrop', { item: k.item.id }); }
      if (mon.type === 'boss' || this.rand() < 0.35 + 0.2 * dep + 0.03 * s.luck) {
        const id = rollLoot(this.rand, dep, s.luck, FLOORS[this.floor].loot);
        if (id === 'empty') { /* nothing */ } else if (id === 'gold') { h.gold += 5; this.emit('gold', { n: 5 }); } else this.placeOnFloor(makeItem(id), mon.x, mon.y, mon.room);
      }
    }
  }

  blockedBy(x, y, ignoreId, lavaOk = false) {
    const t = this.tile(x, y);
    if (t === T.WALL || (t === T.LAVA && !lavaOk)) return true;
    if (t === T.DOOR) { const d = this.m.doors.find(d => d.x === x && d.y === y); if (!d.open) return true; }
    return this.ents.some(e => e.id !== ignoreId && e.x === x && e.y === y && ((e.kind === 'monster' && e.alive) || e.kind === 'chest' || e.kind === 'lever'));
  }
  path(targets, ignoreId) {
    const h = this.hero;
    const lv = this.lavaTarget(targets);
    return astar(this.m.W, this.m.H, [h.x, h.y], targets, (x, y) => !this.blockedBy(x, y, ignoreId, lv), () => 1);
  }
  adj(x, y) { return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]; }
  isAdj(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1; }

  stepHeroTo(x, y, speed = 1) {
    const h = this.hero;
    const dx = x - h.x, dy = y - h.y;
    h.lastDir = Math.abs(dx) >= Math.abs(dy) && dx ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
    h.px = h.x; h.py = h.y; if (dx) h.face = dx > 0 ? 1 : -1;
    h.x = x; h.y = y; h.moveT = 0; h.anim = 'walk'; h.cd = STEP * (dx && dy ? 1.414 : 1) / speed; h.stepDur = h.cd; this.moves++;
    this.emit('step');
    if (this.tile(x, y) === T.LAVA) { h.burnAt = this.time; this.emit('burn'); this.damageHero(h.hp, 'lava'); return; }
    const sp = this.ents.find(e => e.kind === 'spikes' && e.x === x && e.y === y);
    if (sp) { sp.upAt = this.time; this.hitHero(2, 'spikes'); this.spikeHitAt = this.time; this.emit('spikeUp', { id: sp.id }); }
    const r = roomOfTile(this.m, x, y);
    if (r !== null && r !== h.room) this.enterRoom(r);
  }
  enterRoom(r) {
    const h = this.hero;
    h.prevRoom = h.room; h.room = r;
    const first = !h.visited.has(r); h.visited.add(r);
    const next = this.queue[0] || '', intent = /^(attack|flee|kill|go_back)/.test(next) || (this.goal && this.goal.type === 'flee');
    this.monstersIn(r).forEach((m, k) => { m.cd = (intent ? 0.9 : 0.25) + k * 0.4 + this.rand() * 0.2; m.wpath = null; }); // staggered group attacks
    if (!intent) { h.cd = 1.2; h.looking = 1.2; }
    this.emit('enterRoom', { room: r, first, intent, monsters: this.monstersIn(r).length });
  }
  lockReason(d) { return d.lever ? 'lever' : d.color ? 'locked_' + d.color : 'locked'; }
  openDoor(d) {
    if (d.locked) {
      if (d.lever) return false; // only its lever opens it
      if (this.goal && this.goal.auto && d.color) return false; // on his own he does not know which key fits
      const k = this.findItem(d.color ? 'key_' + d.color : 'key'); if (!k) return false;
      this.removeItem(k); d.locked = false; this.emit('unlock', { id: d.id, color: d.color || null });
    }
    d.open = true; this.hero.cd = 0.4; this.emit('doorOpen', { id: d.id });
    return true;
  }
  openChest(c) {
    c.opened = true; this.hero.cd = 0.5;
    const dep = this.m.depth[c.room] || 0, luck = this.stats().luck, out = [];
    const table = FLOORS[this.floor].loot;
    if (ITEMS[c.contents]) out.push(c.contents);
    if (c.contents === 'loot') { out.push(rollLoot(this.rand, dep, luck, table)); if (this.rand() < 0.3 + 0.05 * luck) out.push(rollLoot(this.rand, dep, luck, table)); }
    if (c.contents === 'mimic') {
      const ms = monsterStats('mimic', dep);
      c.kind = 'monster'; c.type = 'mimic'; c.hp = ms.hp; c.maxHp = ms.hp; c.dmg = ms.dmg; c.alive = true; c.cd = 0.3;
      this.emit('mimic', { id: c.id }); return;
    }
    const spilled = [];
    for (const id of out) {
      if (id === 'empty') continue;
      if (id === 'gold') { this.hero.gold += 5; this.emit('gold', { n: 5 }); continue; }
      spilled.push(this.placeOnFloor(makeItem(id), c.x, c.y, c.room));
    }
    c.spilled = spilled.map(e => e.id);
    this.emit(spilled.length ? 'spill' : 'chestEmpty', { id: c.id, items: spilled.map(e => e.item) });
  }

  resolve(label) {
    const h = this.hero, room = h.room;
    let m;
    const D1 = { N: 'north', S: 'south', E: 'east', W: 'west' };
    if ((m = /^go_to_room_([NSEW])$/.exec(label))) label = 'go_' + D1[m[1]];
    else if (label === 'go_back') label = 'flee_back';
    else if (label === 'kill_nearest') label = 'attack_nearest';
    else if ((m = /^kill_(.+)$/.exec(label))) label = 'attack_' + m[1];
    else if ((m = /^open_chest_(.+)$/.exec(label))) label = 'open_' + m[1];
    else if (label === 'pick_up_nearest') label = 'pick_nearest';
    else if (label === 'drink_potion') label = 'drink_heal';
    else if (label === 'look_around') label = 'look';
    else if (label === 'stop') label = 'wait';
    if (label === 'pick_up_all') return this.itemsIn(room).length ? { type: 'pickall' } : { error: 'noitem' };
    if (label === 'find_and_take_potion') { const e = this.itemsIn(room).filter(e => /^potion/.test(e.item.id)).sort((a, b) => Math.abs(a.x - h.x) + Math.abs(a.y - h.y) - Math.abs(b.x - h.x) - Math.abs(b.y - h.y))[0]; return e ? { type: 'pick', target: e.id } : { error: 'nopotionfloor' }; }
    if (label === 'explore_room') { const r = this.m.rooms[room]; return { type: 'explore', pts: [[r.x0 + (r.w >> 1), r.y0 + (r.h >> 1)]], duration: 2 }; }
    if ((m = /^pick_up_(.+)$/.exec(label))) label = 'pick_' + m[1];
    const near = list => { let b = null, bd = 1e9; for (const e of list) { const d = Math.abs(e.x - h.x) + Math.abs(e.y - h.y); if (d < bd) { bd = d; b = e; } } return b; };
    if ((m = /^go_(north|south|east|west)$/.exec(label))) {
      const d = this.doorsOfRoom(room).find(d => doorDir(this.m, d, room) === m[1]);
      return d ? { type: 'go', door: d.id, dir: m[1] } : { error: 'nodoor', dir: m[1] };
    }
    if ((m = /^move_(north|south|east|west)_(\d+|wall)$/.exec(label))) return { type: 'move', dir: m[1], left: m[2] === 'wall' ? 99 : +m[2], toWall: m[2] === 'wall' };
    if (label === 'attack_nearest') { const e = near(this.monstersIn(room)); return e ? { type: 'attack', target: e.id } : { error: 'nomonster' }; }
    if ((m = /^attack_(.+)$/.exec(label))) { const e = this.ent(m[1]); return e && e.alive && e.room === room ? { type: 'attack', target: e.id } : { error: 'nomonster' }; }
    if (label === 'open_nearest_chest') { const e = near(this.ents.filter(e => e.kind === 'chest' && !e.opened && e.room === room)); return e ? { type: 'chest', target: e.id } : { error: 'nochest' }; }
    if ((m = /^open_(.+)$/.exec(label))) { const e = this.ent(m[1]); return e && e.kind === 'chest' && !e.opened ? { type: 'chest', target: e.id } : { error: 'nochest' }; }
    if (label === 'pick_nearest') { const e = near(this.itemsIn(room)); return e ? { type: 'pick', target: e.id } : { error: 'noitem' }; }
    if ((m = /^pick_(.+)$/.exec(label))) { const e = this.ent(m[1]); return e && e.kind === 'item' && !e.taken && e.room === room ? { type: 'pick', target: e.id } : { error: 'noitem' }; }
    if ((m = /^equip_(.+)$/.exec(label))) { const it = this.invItem(m[1]); return it && def(it).slot ? { type: 'equip', target: it.uid } : { error: 'noinv' }; }
    if ((m = /^drop_(.+)$/.exec(label))) { const it = this.invItem(m[1]); return it ? { type: 'drop', target: it.uid } : { error: 'noinv' }; }
    if (label === 'drink_heal' || label === 'drink_shield') { const it = this.findItem(label === 'drink_heal' ? 'potion_heal' : 'potion_shield'); return it ? { type: 'drink', target: it.uid } : { error: 'nopotion' }; }
    if (label === 'flee_back') { const d = h.prevRoom === null ? null : this.doorsOfRoom(room).find(d => otherRoom(d, room) === h.prevRoom); return d ? { type: 'flee', door: d.id } : { error: 'noback' }; }
    if (label === 'pull_lever') { const lv = this.ents.find(e => e.kind === 'lever' && e.room === room && !e.on); return lv ? { type: 'lever', target: lv.id } : { error: 'nolever' }; }
    if (label === 'go_downstairs' || label === 'use_stairs') label = 'take_stairs';
    if (label === 'take_stairs') { const s = this.ents.find(e => e.kind === 'stairs' && e.room === room); return s ? { type: 'stairs', target: s.id } : { error: 'nostairs' }; }
    if (label === 'wait') return { type: 'wait', duration: 3 };
    if (label === 'look') return { type: 'look', duration: 2 };
    return { error: 'unknown' };
  }
  abortPlan() {
    const h = this.hero, had = !!this.goal || this.queue.length > 0;
    this.goal = null; this.queue = [];
    if (h.anim === 'walk') { h.px = h.x; h.py = h.y; h.anim = 'idle'; }
    return had;
  }
  pullLever(lv) {
    const h = this.hero, d = this.m.doorById[lv.door];
    lv.on = true; h.cd = 0.6; h.anim = 'attack'; h.animT = 0; h.face = lv.x >= h.x ? 1 : -1;
    if (d) { d.locked = false; d.open = true; }
    this.emit('lever', { id: lv.id, door: lv.door });
  }
  // stairs down: a fresh maze for the next floor; the hero keeps his things
  descend() {
    const h = this.hero; if (this.floor >= FLOOR_COUNT - 1) return;
    this.floor++;
    this.m = generate({ ...this.opts, seed: this.floorSeed(this.floor), floor: this.floor });
    const [sx, sy] = startPos(this.m.rooms[this.m.start]);
    Object.assign(h, { x: sx, y: sy, px: sx, py: sy, room: this.m.start, prevRoom: null, visited: new Set([this.m.start]), anim: 'idle', cd: 1, looking: 1 });
    this.shots = []; this.goal = null; this.queue = []; this.autoChest = null; this.boltHitAt = -1; this.fledFrom = new Set(); this.floorLog.push({ floor: this.floor, at: this.time });
    this.emit('floor', { floor: this.floor, label: this.m.label });
    this.emit('askWhat');
  }
  // compass: nearest uncollected key on this floor (on the floor, in a chest, or carried by an enemy)
  compassTarget() {
    if (!this.findItem('compass')) return null;
    const h = this.hero; let best = null, bd = 1e9;
    for (const c of ['white', 'yellow', 'blue']) for (const e of keyLocations(this.m, 'key_' + c)) { const d = Math.hypot(e.x - h.x, e.y - h.y); if (d < bd) { bd = d; best = { x: e.x, y: e.y, id: e.id, key: 'key_' + c }; } }
    return best;
  }
  setQueue(labels) { this.noteCommand(); this.queue = labels.slice(); this.goal = null; this.next(); }
  next() {
    if (this.hero.dead || this.hero.won) return;
    if (!this.queue.length) { this.goal = null; this.quietAt = this.time; this.idleDue = this.rollIdle(); this.emit('askWhat'); return; }
    const label = this.queue.shift(), spec = this.resolve(label);
    if (spec.error) { this.goal = null; this.emit('cantDo', { label, ...spec, skipped: true }); return this.next(); }
    this.goal = { ...spec, label, t: 0 };
    this.emit('goal', { goal: this.goal });
  }
  finishGoal(ok, reason = '') {
    const g = this.goal; this.goal = null;
    this.emit(ok ? 'goalDone' : 'goalFail', { goal: g, reason, auto: !!g?.auto });
    if (g && g.auto) return; // autonomous goals do not touch the human plan
    if (ok) this.next(); else { this.queue = []; this.emit('askWhat'); }
  }

  runGoal() {
    const g = this.goal, h = this.hero;
    if (!g) return;
    const fail = r => this.finishGoal(false, r), done = () => this.finishGoal(true);
    switch (g.type) {
      case 'go': case 'flee': {
        const d = this.m.doorById[g.door];
        if (g.fromRoom === undefined) g.fromRoom = h.room;
        const dest = otherRoom(d, g.fromRoom);
        if (h.room === dest && roomOfTile(this.m, h.x, h.y) === dest) return done();
        if (!d.open) {
          if (this.isAdj(h, d)) { if (!this.openDoor(d)) return fail(this.lockReason(d)); return; }
          const targets = this.adj(d.x, d.y).filter(([x, y]) => roomOfTile(this.m, x, y) === h.room);
          if (!this.moveToward(targets, undefined, g.type === 'flee' ? 'direct' : 'human')) return fail('nopath');
          return;
        }
        const [dx, dy] = d.vertical ? [1, 0] : [0, 1];
        const beyond = [[d.x + dx, d.y + dy], [d.x - dx, d.y - dy]].filter(([x, y]) => roomOfTile(this.m, x, y) === dest);
        if (!this.moveToward(beyond, undefined, g.type === 'flee' ? 'direct' : 'human')) return fail('nopath');
        return;
      }
      case 'move': {
        if (g.left <= 0) return done();
        const [dx, dy] = DIRS[g.dir], nx = h.x + dx, ny = h.y + dy;
        if (this.tile(nx, ny) === T.DOOR) { const d = this.m.doors.find(d => d.x === nx && d.y === ny); if (!d.open) { if (!this.openDoor(d)) return fail(this.lockReason(d)); return; } }
        if (this.blockedBy(nx, ny, undefined, true)) return g.toWall || g.moved ? done() : fail('blocked');
        g.left--; g.moved = true; this.stepHeroTo(nx, ny);
        return;
      }
      case 'chest': {
        const c = this.ent(g.target); if (!c || c.kind !== 'chest' || c.opened) return done();
        if (!this.moveToward(this.adj(c.x, c.y), undefined, 'human')) return fail('nopath');
        return;
      }
      case 'attack': {
        const mon = this.ent(g.target); if (!mon || !mon.alive) return done();
        if (this.isAdj(h, mon)) return this.attack(mon);
        if (!this.moveToward(this.adj(mon.x, mon.y), undefined, 'direct')) return fail('nopath');
        return;
      }
      case 'pick': {
        const it = this.ent(g.target); if (!it || it.taken) return fail('noitem');
        if (h.x === it.x && h.y === it.y) {
          it.taken = true; this.ents.splice(this.ents.indexOf(it), 1);
          this.emit('pickup', { item: it.item.id, name: ITEMS[it.item.id].name });
          this.putInv(it.item); h.cd = 0.4; return done();
        }
        if (!this.moveToward([[it.x, it.y]], undefined, 'human')) return fail('nopath');
        return;
      }
      case 'stairs': {
        const s = this.ent(g.target);
        if (h.x === s.x && h.y === s.y) { if (s.down) return this.descend(); h.won = true; this.goal = null; this.queue = []; this.emit('win'); return; }
        if (!this.moveToward([[s.x, s.y]], undefined, 'human')) return fail('nopath');
        return;
      }
      case 'pickall': {
        const items = this.itemsIn(h.room).filter(e => !g.skip?.includes(e.id));
        if (!items.length) return done();
        const here = items.find(e => e.x === h.x && e.y === h.y);
        if (here) {
          here.taken = true; this.ents.splice(this.ents.indexOf(here), 1);
          this.emit('pickup', { item: here.item.id, name: ITEMS[here.item.id].name });
          if (!this.putInv(here.item)) return done();
          h.cd = 0.4; return;
        }
        if (!this.moveToward(items.map(e => [e.x, e.y]), undefined, 'human')) return done();
        return;
      }
      case 'explore': {
        if (g.pts.length) { const [x, y] = g.pts[0]; if ((h.x === x && h.y === y) || !this.moveToward([[x, y]], undefined, 'human')) g.pts.shift(); return; }
        if (Math.floor(g.t / 0.5) !== Math.floor((g.t - 0.1) / 0.5)) h.face = -h.face;
        if (g.ls == null) g.ls = g.t; if (g.t - g.ls > g.duration) return done();
        return;
      }
      case 'lever': {
        const lv = this.ent(g.target); if (!lv || lv.on) return done();
        if (this.isAdj(h, lv)) { this.pullLever(lv); return done(); }
        if (!this.moveToward(this.adj(lv.x, lv.y), undefined, 'human')) return fail('nopath');
        return;
      }
      case 'drink': { const it = this.invItem(g.target); if (!it) return fail('nopotion'); this.drinkItem(it); return done(); }
      case 'equip': { const it = this.invItem(g.target); if (!it) return fail('noinv'); this.equipItem(it); h.cd = 0.4; return done(); }
      case 'drop': { const it = this.invItem(g.target); if (!it) return fail('noinv'); this.dropItem(it); h.cd = 0.3; return done(); }
      case 'wait': case 'look': {
        if (g.type === 'look' && Math.floor(g.t / 0.5) !== Math.floor((g.t - 0.1) / 0.5)) h.face = -h.face;
        if (g.t > g.duration) return done();
        return;
      }
    }
  }
  // mage: keeps distance and casts a bolt aimed at where the hero is now (moving dodges it)
  mageAct(mon) {
    const h = this.hero, d = Math.abs(h.x - mon.x) + Math.abs(h.y - mon.y);
    const stepTo = ([x, y]) => { mon.px = mon.x; mon.py = mon.y; if (x !== mon.x) mon.face = x > mon.x ? 1 : -1; mon.x = x; mon.y = y; mon.moveT = 0; mon.cd = MON_STEP; mon.stepDur = MON_STEP; mon.anim = 'walk'; };
    const okTile = ([x, y]) => roomOfTile(this.m, x, y) === mon.room && !this.blockedBy(x, y, mon.id) && !(x === h.x && y === h.y);
    if (d < BOLT.keep) { // too close: back off if possible
      const c = this.adj(mon.x, mon.y).filter(okTile).sort((a, b) => (Math.abs(h.x - b[0]) + Math.abs(h.y - b[1])) - (Math.abs(h.x - a[0]) + Math.abs(h.y - a[1])))[0];
      if (c && Math.abs(h.x - c[0]) + Math.abs(h.y - c[1]) > d) { stepTo(c); return true; }
    }
    if (d <= BOLT.range) { // cast
      const dx = h.x - mon.x, dy = h.y - mon.y, L = Math.hypot(dx, dy) || 1;
      this.shots.push({ x: mon.x, y: mon.y, vx: dx / L * BAL.boltSpeed, vy: dy / L * BAL.boltSpeed, dmg: BAL.boltDmg, t: 0, src: mon.id });
      mon.cd = BAL.boltCd * (0.85 + this.rand() * 0.3); mon.anim = 'attack'; mon.animT = 0; mon.face = dx >= 0 ? 1 : -1;
      this.emit('cast', { id: mon.id });
      return true;
    }
    return false; // too far: walk closer like everyone else
  }
  updateShots(dt) {
    const h = this.hero;
    this.shots = this.shots.filter(s => {
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      const tx = Math.round(s.x), ty = Math.round(s.y), tl = this.tile(tx, ty);
      if (s.t > 3 || tl === T.WALL || (tl === T.DOOR && !this.m.doors.find(d => d.x === tx && d.y === ty)?.open)) return false;
      if (!h.dead && Math.hypot(s.x - h.x, s.y - h.y) < 0.45) { h.attackedAt = this.time; this.boltHitAt = this.time; this.hitHero(s.dmg, 'bolt'); return false; }
      return true;
    });
  }
  // chomper: once it has seen the hero it follows him through open doors; gives up after losing him for a while
  chompFollow(mon, dt) {
    const h = this.hero;
    mon.cd = (mon.cd ?? 0) - dt; if (mon.cd > 0) return;
    const p = astar(this.m.W, this.m.H, [mon.x, mon.y], this.adj(h.x, h.y), (x, y) => !this.blockedBy(x, y, mon.id) && !(x === h.x && y === h.y), () => 1, 1500);
    mon.cd = CHOMP_STEP;
    if (!p || !p.length) return;
    const [x, y] = p[0];
    mon.px = mon.x; mon.py = mon.y; if (x !== mon.x) mon.face = x > mon.x ? 1 : -1; mon.x = x; mon.y = y; mon.moveT = 0; mon.stepDur = CHOMP_STEP; mon.anim = 'walk';
    const r = roomOfTile(this.m, x, y);
    if (r !== null && r !== mon.room) { mon.room = r; mon.wpath = null; if (r === h.room) { mon.cd = 0.4; this.emit('chompIn', { id: mon.id }); } }
  }
  // occupancy of one room (monsters, chests, spikes), built once per wander decision - the map is big now
  roomOcc(room, ignoreId) { const s = new Set(); for (const e of this.ents) if (e.room === room && e.id !== ignoreId && ((e.kind === 'monster' && e.alive) || e.kind === 'chest' || e.kind === 'spikes')) s.add(e.x + ',' + e.y); return s; }
  // passable for a wandering monster (door-adjacent tiles allowed in transit, e.g. a chomper that gave up in a doorway)
  wanderPass(x, y, mon, occ = this.roomOcc(mon.room, mon.id)) { return roomOfTile(this.m, x, y) === mon.room && this.tile(x, y) === T.FLOOR && !occ.has(x + ',' + y) && !(x === this.hero.x && y === this.hero.y); }
  wanderOk(x, y, mon, occ = this.roomOcc(mon.room, mon.id)) {
    if (!this.wanderPass(x, y, mon, occ)) return false;
    return !this.adj(x, y).some(([a, b]) => this.tile(a, b) === T.DOOR);
  }
  wander(mon, dt) {
    mon.wt = (mon.wt ?? this.rand() * 3) - dt;
    if (mon.wt > 0) return;
    if (!mon.wpath || !mon.wpath.length) {
      if (mon.wpath) { mon.wpath = null; mon.wt = 1 + this.rand() * 2; return; }
      const r = this.m.rooms[mon.room], c = [], occ = this.roomOcc(mon.room, mon.id);
      for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (this.wanderOk(x, y, mon, occ)) c.push([x, y]);
      if (!c.length) { mon.wt = 2; return; }
      const t = c[Math.floor(this.rand() * c.length)];
      const esc = !this.wanderOk(mon.x, mon.y, mon, occ); // stuck on a doorway tile (e.g. a chomper that gave up) -> may cross door-adjacent tiles once
      const p = astar(this.m.W, this.m.H, [mon.x, mon.y], [t], (x, y) => esc ? this.wanderPass(x, y, mon, occ) : this.wanderOk(x, y, mon, occ), () => 1, 400);
      mon.wesc = esc;
      if (!p || !p.length) { mon.wt = 1 + this.rand() * 2; return; }
      mon.wpath = p;
    }
    const [x, y] = mon.wpath[0];
    if (!(mon.wesc ? this.wanderPass(x, y, mon) : this.wanderOk(x, y, mon))) { mon.wpath = null; mon.wt = 0.5; return; }
    mon.wpath.shift();
    mon.px = mon.x; mon.py = mon.y; if (x !== mon.x) mon.face = x > mon.x ? 1 : -1;
    mon.x = x; mon.y = y; mon.moveT = 0; mon.stepDur = WANDER_STEP; mon.anim = 'walk'; mon.wt = WANDER_STEP;
  }
  diagOk(x, y, dx, dy, ignoreId) {
    const T2 = (a, b) => this.tile(a, b) === T.DOOR;
    if (T2(x, y) || T2(x + dx, y + dy) || T2(x + dx, y) || T2(x, y + dy)) return false;
    return !this.blockedBy(x + dx, y, ignoreId) && !this.blockedBy(x, y + dy, ignoreId);
  }
  moveToward(targets, ignoreId, mode) {
    const h = this.hero;
    if (!mode) { const p = this.path(targets, ignoreId); if (!p) return false; if (p.length) this.stepHeroTo(p[0][0], p[0][1]); return true; }
    const trap = this.m.rooms[h.room] && this.m.rooms[h.room].type === 'trap';
    if (mode === 'human' && !trap && this.goal) return this.humanStep(targets, ignoreId);
    const p = this.path8(targets, ignoreId);
    if (!p) return false;
    if (p.length) this.stepHeroTo(p[0][0], p[0][1]);
    return true;
  }
  lavaTarget(targets) { return targets.some(([x, y]) => this.tile(x, y) === T.LAVA); }
  path8(targets, ignoreId, cost = () => 1, from) {
    const h = this.hero, s = from || [h.x, h.y], lv = this.lavaTarget(targets);
    return astar(this.m.W, this.m.H, s, targets, (x, y) => !this.blockedBy(x, y, ignoreId, lv), cost, 5000, (x, y, dx, dy) => this.diagOk(x, y, dx, dy, ignoreId));
  }
  humanStep(targets, ignoreId) {
    const h = this.hero, g = this.goal, key = targets.map(t => t.join(',')).join(';');
    let tr = g.trip;
    const nxt = tr && tr.route[0];
    if (!tr || tr.key !== key || !nxt || Math.max(Math.abs(nxt[0] - h.x), Math.abs(nxt[1] - h.y)) !== 1 || this.blockedBy(nxt[0], nxt[1], ignoreId)
      || (nxt[0] !== h.x && nxt[1] !== h.y && !this.diagOk(h.x, h.y, nxt[0] - h.x, nxt[1] - h.y, ignoreId))) {
      const seed = Math.floor(this.rand() * 1e9), W = this.m.W;
      const noise = (x, y) => { let n = (x * 73856093) ^ (y * 19349663) ^ seed; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
      const wall = (x, y) => this.adj(x, y).some(([a, b]) => this.tile(a, b) === T.WALL);
      const cost = (x, y) => 1 + noise(x, y) * 0.6 + (wall(x, y) ? 0.35 : 0);
      let route = this.path8(targets, ignoreId, cost);
      if (!route) return false;
      if (route.length > 3 && this.rand() < 0.35) {
        const r = this.m.rooms[h.room], c = [];
        for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) {
          if (this.tile(x, y) !== T.FLOOR || this.blockedBy(x, y, ignoreId)) continue;
          const d1 = Math.max(Math.abs(x - h.x), Math.abs(y - h.y)), e = route[route.length - 1], d2 = Math.max(Math.abs(x - e[0]), Math.abs(y - e[1]));
          if (d1 >= 2 && d1 + d2 <= route.length * 1.5 + 2) c.push([x, y]);
        }
        if (c.length) {
          const wp = c[Math.floor(this.rand() * c.length)], a = this.path8([wp], ignoreId, cost), b = a && this.path8(targets, ignoreId, cost, wp);
          if (a && b) route = a.concat(b);
        }
      }
      tr = g.trip = { key, route, speed: tr ? tr.speed : 0.85 + this.rand() * 0.25, pauseAt: !tr && route.length > 4 && this.rand() < 0.1 ? Math.floor(route.length / 2) : -1, n: tr ? tr.n : 0 };
      if (!route.length) return true;
    }
    if (tr.n === tr.pauseAt) { tr.pauseAt = -1; const d = 0.6 + this.rand() * 0.6; h.cd = d; h.looking = d; this.emit('think', { text: null, emote: 'dots3' }); return true; }
    const [x, y] = tr.route.shift(); tr.n++;
    this.stepHeroTo(x, y, tr.speed);
    return true;
  }

  idle(dt) {
    const h = this.hero;
    if (this.time < this.thinkAt) return;
    this.thinkAt = this.time + 5 + this.rand() * 6;
    const r = this.rand();
    if (r < 0.08) {
      const items = this.itemsIn(h.room), inv = h.inv.filter(Boolean);
      const acts = [];
      if (items.length) acts.push(() => { const e = items[Math.floor(this.rand() * items.length)]; this.emit('curious', { what: 'pick', item: e.item.id }); this.queue = []; this.goal = { type: 'pick', target: e.id, label: 'curious', t: 0 }; });
      const eq = inv.filter(i => def(i).slot); if (eq.length) acts.push(() => { const it = eq[Math.floor(this.rand() * eq.length)]; this.emit('curious', { what: 'equip', item: it.id }); this.equipItem(it); });
      const po = inv.filter(i => def(i).use); if (po.length) acts.push(() => { const it = po[Math.floor(this.rand() * po.length)]; this.emit('curious', { what: 'drink', item: it.id }); this.drinkItem(it); });
      if (acts.length) return acts[Math.floor(this.rand() * acts.length)]();
    }
    if (r < 0.45) { h.face = -h.face; this.emit('think', { text: null, emote: this.rand() < 0.5 ? 'question' : 'dots3' }); return; }
    this.emit('think', { key: Math.floor(this.rand() * THOUGHT_COUNT), emote: null });
  }

  update(dt) {
    this.time += dt;
    const h = this.hero;
    h.animT += dt; h.moveT += dt;
    if (h.anim === 'walk' && h.moveT > STEP * 1.5) h.anim = 'idle';
    if ((h.anim === 'hurt' || h.anim === 'attack') && h.animT > 0.4 && !h.dead) h.anim = 'idle';
    for (const e of this.ents) if (e.kind === 'monster') {
      e.animT = (e.animT || 0) + dt; e.moveT = (e.moveT || 0) + dt;
      if (e.alive && (e.anim === 'hurt' || e.anim === 'attack') && e.animT > 0.5) e.anim = 'idle';
    }
    if (h.dead || h.won) return;
    const st = this.stats();
    if (st.regen > 0 && h.hp < st.maxHp) h.hp = Math.min(st.maxHp, h.hp + st.regen * dt);
    if (h.shield > 0 && this.time >= h.shieldUntil) { h.shield = 0; this.emit('shieldGone'); }
    for (const mon of this.monstersIn(h.room)) {
      mon.cd = (mon.cd ?? 1) - dt;
      if (mon.kind === 'monster' && mon.type === 'chomper') mon.seenAt = this.time;
      if (mon.cd > 0) continue;
      if (mon.type === 'vampire' && this.mageAct(mon)) continue;
      if (this.isAdj(mon, h)) { mon.cd = MON_ATK * (0.85 + this.rand() * 0.3); mon.anim = 'attack'; mon.animT = 0; mon.face = h.x >= mon.x ? 1 : -1; h.attackedAt = this.time; this.hitHero(mon.dmg || 2, mon.id); continue; }
      const p = astar(this.m.W, this.m.H, [mon.x, mon.y], this.adj(h.x, h.y),
        (x, y) => roomOfTile(this.m, x, y) === mon.room && !this.blockedBy(x, y, mon.id) && !(x === h.x && y === h.y), () => 1, 800);
      mon.cd = mon.type === 'chomper' ? CHOMP_STEP : MON_STEP;
      if (p && p.length) { mon.px = mon.x; mon.py = mon.y; if (p[0][0] !== mon.x) mon.face = p[0][0] > mon.x ? 1 : -1; mon.x = p[0][0]; mon.y = p[0][1]; mon.moveT = 0; mon.stepDur = mon.cd; mon.anim = 'walk'; }
    }
    this.updateShots(dt);
    for (const mon of this.ents) if (mon.kind === 'monster' && mon.alive && mon.room !== h.room) {
      if (mon.type === 'chomper' && mon.seenAt != null && this.time - mon.seenAt < CHOMP_GIVEUP) this.chompFollow(mon, dt); else this.wander(mon, dt);
    }
    if (this.goal) this.goal.t += dt;
    if (h.looking > 0) { const before = h.looking; h.looking -= dt; if (Math.floor(before / 0.4) !== Math.floor(h.looking / 0.4)) h.face = -h.face; }
    h.cd -= dt;
    if (h.cd > 0) return;
    const chest = this.ents.find(e => e.kind === 'chest' && !e.opened && e.room === h.room && this.isAdj(e, h));
    if (chest && (!this.goal || (this.goal.type === 'chest' && this.goal.target === chest.id))) return this.openChest(chest); // no longer pops chests just walking by
    const adjMon = this.monstersIn(h.room).find(m => this.isAdj(m, h));
    if (adjMon && !(this.goal && this.goal.type === 'flee')) {
      if (!this.goal || this.goal.type !== 'attack') this.emit('selfDefense', { id: adjMon.id });
      return this.attack(adjMon);
    }
    if (this.auto) this.autonomy();
    if (this.goal) this.runGoal(); else this.idle(dt);
    if (h.cd <= 0) h.cd = 0.1;
  }
}

export { doorDir, otherRoom, roomOfTile, DIRS, OPP };
