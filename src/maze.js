export const RW = 7, RH = 6;
export const T = { FLOOR: 0, WALL: 1, DOOR: 2, LAVA: 3 };
export const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

export function rng(seed) {
  let s = (seed >>> 0) || 123456789;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export const MAP = { cols: 12, rows: 8 }; // 96 rooms per floor (was 8x6 = 48)
// Floors: index 0 = floor 1, 1 = floor -1, 2 = floor -2 (last, boss). Loot tables: [id, weight]; 'empty' = nothing.
export const FLOORS = [
  { label: 1, lavaRooms: 0, trapRooms: 0, mix: ['skeleton', 'skeleton2'], weapon: 'sword_blue', chest: 0.22, mimic: 0,
    loot: [['gold', 50], ['potion_heal', 40], ['sword_blue', 6]] },
  { label: -1, lavaRooms: 0, trapRooms: 2, mix: ['skeleton', 'skeleton2', 'vampire', 'vampire'], weapon: 'sword_gold', chest: 0.25, mimic: 0,
    loot: [['gold', 25], ['potion_heal', 35], ['potion_shield', 20], ['sword_gold', 3], ['ring_str', 3], ['ring_agi', 3], ['ring_sta', 3], ['ring_luck', 3], ['ring_spi', 3]] },
  { label: -2, lavaRooms: 6, trapRooms: 4, mix: ['skeleton', 'skeleton', 'skeleton2', 'chomper', 'chomper'], weapon: 'sword_red', chest: 0.35, mimic: 0.25, boss: true,
    loot: [['empty', 12], ['gold', 22], ['potion_heal', 25], ['potion_shield', 12], ['sword_red', 2], ['helmet', 4], ['boots', 5], ['gloves', 5], ['armor', 3],
      ['ring_str', 1.5], ['ring_agi', 1.5], ['ring_sta', 1.5], ['ring_luck', 1.5], ['ring_spi', 1.5]] },
];
export const KEY_COLORS = ['white', 'yellow', 'blue'];
// floors 1/-1: white (stairs) + yellow (weapon vault); last floor: yellow + blue (lever room) - no stairs down, no white key
export const keyColorsOf = floor => FLOORS[floor].boss ? ['yellow', 'blue'] : ['white', 'yellow'];
// retries with a derived seed until the floor has enough dead ends for its special rooms and passes the solvability check
export function generate(opts = {}) {
  const seed = opts.seed ?? (Date.now() & 0xffffffff);
  for (let k = 0; k < 60; k++) { const m = genOnce({ ...opts, seed: (seed + k * 7919) | 0 }); if (m && solvable(m)) { m.seed = seed; m.genTries = k; return m; } }
  throw new Error('maze generation failed for seed ' + seed);
}
// every key reachable from the start without using any locked door; the goal reachable once keys/lever are used
export function solvable(m) {
  const reach = (useKeys) => { const s = new Set([m.start]), q = [m.start]; while (q.length) { const c = q.shift(); for (const id of m.rooms[c].doors) { const d = m.doorById[id]; if (d.locked && !(useKeys && (d.color || d.lever))) continue; const o = d.a === c ? d.b : d.a; if (m.rooms[o].type === 'lava' || s.has(o)) continue; s.add(o); q.push(o); } } return s; };
  const free = reach(false), all = reach(true);
  for (const c of keyColorsOf(m.floor)) { const k = keyLocations(m, 'key_' + c); if (!k.length || !k.every(e => free.has(e.room))) return false; }
  if (m.special.lever != null) { const lv = m.ents.find(e => e.kind === 'lever'); if (!lv || lv.room !== m.special.lever || m.doorById[lv.door] !== m.doorById[m.lockDoorId]) return false; }
  return all.has(m.exit) && !free.has(m.exit);
}
// where a key is: on the floor, in an unopened chest, or carried by a living enemy
export function keyLocations(m, kid) {
  return m.ents.filter(e => (e.kind === 'item' && !e.taken && e.item.id === kid) || (e.kind === 'chest' && !e.opened && e.contents === kid) || (e.kind === 'monster' && e.alive && e.carry === kid));
}
function genOnce({ cols = MAP.cols, rows = MAP.rows, seed, floor = 0, lavaRooms, trapRooms, near = false } = {}) {
  const testMode = !!near; // debug flag 'near': special rooms right next to the start
  const cfg = FLOORS[floor]; lavaRooms ??= cfg.lavaRooms; trapRooms ??= cfg.trapRooms;
  const R = rng(seed), ri = n => Math.floor(R() * n), pick = a => a[ri(a.length)];
  const W = cols * RW + 1, H = rows * RH + 1;
  const tiles = new Uint8Array(W * H).fill(T.WALL);
  const rooms = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const r = { id: rooms.length, cx, cy, x0: cx * RW + 1, y0: cy * RH + 1, w: RW - 1, h: RH - 1, doors: [], type: 'normal' };
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) tiles[y * W + x] = T.FLOOR;
    rooms.push(r);
  }
  const roomId = (cx, cy) => cy * cols + cx;
  const key = (a, b) => a < b ? a + '-' + b : b + '-' + a;
  const lava = new Set();
  const gridNb = id => { const r = rooms[id]; return Object.values(DIRS).map(([dx, dy]) => [r.cx + dx, r.cy + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows).map(([x, y]) => roomId(x, y)); };
  const gridConnected = () => { const s = new Set([0]), q = [0]; while (q.length) { const c = q.shift(); for (const n of gridNb(c)) if (!lava.has(n) && !s.has(n)) { s.add(n); q.push(n); } } return s.size === rooms.length - lava.size; };
  const START = testMode ? roomId(1, 1) : 0; // test mode: an inner start room so special rooms can hang off it
  for (const id of rooms.map(r => r.id).filter(i => i !== START).sort(() => R() - 0.5)) {
    if (lava.size >= lavaRooms) break;
    lava.add(id); if (!gridConnected() || [...lava].some(l => gridNb(l).every(n => lava.has(n)))) lava.delete(id); // every lava room keeps a non-lava neighbour (its only entrance)
  }
  for (const id of lava) { const r = rooms[id]; r.type = 'lava'; for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) tiles[y * W + x] = T.LAVA; }
  const edges = new Set();
  const seen = new Set([0]), stack = [0];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const nb = gridNb(cur).filter(n => !seen.has(n) && !lava.has(n));
    if (!nb.length) { stack.pop(); continue; }
    const n = pick(nb); seen.add(n); edges.add(key(cur, n)); stack.push(n);
  }
  for (const r of rooms) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const x = r.cx + dx, y = r.cy + dy; if (x >= cols || y >= rows) continue;
    const n = roomId(x, y); if (lava.has(r.id) || lava.has(n)) continue;
    if (R() < 0.08) edges.add(key(r.id, n));
  }
  for (const id of lava) { const nb = gridNb(id).filter(n => !lava.has(n)); if (nb.length) edges.add(key(id, pick(nb))); }
  // debug 'near': the goal room (and the lever room on the last floor) become dead ends attached straight to the start room
  let forced = [];
  if (testMode) {
    const nbs = gridNb(START).filter(n => !lava.has(n)).sort(() => R() - 0.5), want = cfg.boss ? 2 : 1;
    if (nbs.length < want + 1) return null;
    forced = nbs.slice(0, want);
    for (const e of [...edges]) { const [a, b] = e.split('-').map(Number); if (forced.includes(a) || forced.includes(b)) edges.delete(e); }
    for (const f of forced) edges.add(key(START, f));
    for (let changed = true; changed;) { // reconnect whatever hung off the forced rooms
      changed = false;
      const nbE = id => [...edges].map(e => e.split('-').map(Number)).filter(([a, b]) => a === id || b === id).map(([a, b]) => a === id ? b : a);
      const reach = new Set([START]), q = [START]; while (q.length) { const c = q.shift(); for (const n of nbE(c)) if (!reach.has(n)) { reach.add(n); if (!lava.has(n) && !forced.includes(n)) q.push(n); } }
      for (const r of rooms) if (!reach.has(r.id) && !(lava.has(r.id) && nbE(r.id).length)) { const n = gridNb(r.id).find(n => reach.has(n) && !lava.has(n) && !forced.includes(n)); if (n != null) { edges.add(key(r.id, n)); changed = true; if (lava.has(r.id)) break; } }
      if (!changed && reach.size < rooms.length) return null;
    }
  }
  const doors = [];
  for (const e of edges) {
    const [a, b] = e.split('-').map(Number);
    const A = rooms[a], B = rooms[b];
    let x, y, vertical;
    if (A.cy === B.cy) { x = (Math.max(A.cx, B.cx)) * RW; y = A.cy * RH + (RH >> 1); vertical = true; }
    else { x = A.cx * RW + (RW >> 1); y = Math.max(A.cy, B.cy) * RH; vertical = false; }
    const d = { id: 'door' + doors.length, kind: 'door', x, y, a, b, vertical, open: false, locked: false };
    tiles[y * W + x] = T.DOOR; doors.push(d); A.doors.push(d.id); B.doors.push(d.id);
  }
  const doorById = Object.fromEntries(doors.map(d => [d.id, d]));
  const other = (d, r) => d.a === r ? d.b : d.a;
  const bfs = (from, blocked) => {
    const dist = new Map([[from, 0]]), par = new Map(), q = [from];
    while (q.length) { const c = q.shift(); for (const id of rooms[c].doors) { const d = doorById[id]; if (blocked && blocked.has(d.id)) continue; const o = other(d, c); if (!dist.has(o)) { dist.set(o, dist.get(c) + 1); par.set(o, d.id); q.push(o); } } }
    return { dist, par };
  };
  const start = START;
  const { dist } = bfs(start);
  const maxD = Math.max(...dist.values()), depth = rooms.map(r => dist.has(r.id) ? dist.get(r.id) / maxD : 0);
  // special rooms are dead ends (one door), so their colored/lever door is the only way in
  const nbOf = r => other(doorById[r.doors[0]], r.id);
  const dead = rooms.filter(r => r.id !== start && !forced.includes(r.id) && !lava.has(r.id) && r.doors.length === 1 && !lava.has(nbOf(r)) && rooms[nbOf(r)].doors.length > 1 && nbOf(r) !== start)
    .sort((x, y) => dist.get(y.id) - dist.get(x.id));
  if (dead.length < (cfg.boss ? 3 : 2)) return null;
  const need = (cfg.boss ? 3 : 2) - forced.length; if (testMode && dead.length < need) return null;
  const goalRoom = testMode ? rooms[forced[0]] : dead[0], rest = (testMode ? dead : dead.slice(1)).sort(() => R() - 0.5), weaponRoom = rest[0], blueRoom = cfg.boss ? (testMode ? rooms[forced[1]] : rest[1]) : null; // blue door/room only on the last floor (lever)
  const lockRoom = (r, how) => { const d = doorById[r.doors[0]]; d.locked = true; if (how === 'lever') d.lever = true; else d.color = how; return d; };
  const goalDoor = lockRoom(goalRoom, cfg.boss ? 'lever' : 'white');
  lockRoom(weaponRoom, 'yellow'); if (blueRoom) { lockRoom(blueRoom, 'blue'); blueRoom.type = 'lever'; }
  goalRoom.type = cfg.boss ? 'exit' : 'stairs'; weaponRoom.type = 'vault';
  const ante = rooms[nbOf(goalRoom)]; // the room in front of the goal door
  const locked = new Set(doors.filter(d => d.locked).map(d => d.id));
  const main = new Set([...bfs(start, locked).dist.keys()].filter(r => !lava.has(r)));

  const ents = []; let nid = 0;
  const occ = new Set();
  const entry = (d, r) => d.vertical ? [d.x < r.x0 ? d.x + 1 : d.x - 1, d.y] : [d.x, d.y < r.y0 ? d.y + 1 : d.y - 1];
  for (const id of lava) rooms[id].ledge = [];
  const trapCand = rooms.filter(r => r.type === 'normal' && r.id !== start && r.id !== ante.id && r.doors.length >= 2).sort(() => R() - 0.5).slice(0, trapRooms);
  for (const r of trapCand) {
    r.type = 'trap';
    const ins = r.doors.map(id => entry(doorById[id], r));
    let safe;
    for (let tries = 0; tries < 30; tries++) {
    safe = new Set([ins[0].join(',')]);
    let cur = ins[0];
    for (const tgt of ins.slice(1)) {
      let [x, y] = cur, guard = 0;
      while ((x !== tgt[0] || y !== tgt[1]) && guard++ < 200) {
        const towards = [], side = [];
        if (x !== tgt[0]) towards.push([Math.sign(tgt[0] - x), 0]); if (y !== tgt[1]) towards.push([0, Math.sign(tgt[1] - y)]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!towards.some(([a, b]) => a === dx && b === dy)) side.push([dx, dy]);
        const [dx, dy] = R() < 0.7 || !side.length ? pick(towards) : pick(side);
        const nx = x + dx, ny = y + dy;
        if (nx < r.x0 || ny < r.y0 || nx >= r.x0 + r.w || ny >= r.y0 + r.h) continue;
        x = nx; y = ny; safe.add(x + ',' + y);
      }
      cur = tgt;
    }
    if (safe.size <= r.w * r.h * 0.55) break;
    }
    r.safe = [...safe];
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) {
      occ.add(x + ',' + y);
      if (!safe.has(x + ',' + y)) ents.push({ id: 'spikes' + (++nid), kind: 'spikes', x, y, room: r.id, always: true });
    }
  }
  const mons = [];
  const free = (r, spaced = false) => {
    for (let t = 0; t < 200; t++) {
      const x = r.x0 + 1 + ri(r.w - 2), y = r.y0 + 1 + ri(r.h - 2);
      if (occ.has(x + ',' + y)) continue;
      if (spaced && mons.some(e => e.room === r.id && Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) < 2)) continue;
      if (r.doors.some(id => { const d = doorById[id]; return Math.abs(d.x - x) + Math.abs(d.y - y) < 2; })) continue;
      occ.add(x + ',' + y); return [x, y];
    }
    return null;
  };
  const add = (kind, r, extra = {}, spaced = kind === 'monster') => { const p = free(r, spaced); if (!p) return null; const e = { id: kind + (++nid), kind, x: p[0], y: p[1], room: r.id, ...extra }; ents.push(e); if (kind === 'monster') mons.push(e); return e; };
  // enemies per room come from the floor's count weights (index = count)
  const fb = BAL.floors[floor];
  const countFor = () => { const w = fb.counts; let r = R() * w.reduce((a, b) => a + b, 0); for (let k = 0; k < w.length; k++) { r -= w[k]; if (r < 0) return k; } return 0; };
  const addMon = (r, type, dep, spaced = true) => { const { hp, dmg } = monsterStats(type, dep, floor); return add('monster', r, { type, hp, maxHp: hp, dmg, alive: true }, spaced); };
  const sp = startPos(rooms[start]); occ.add(sp[0] + ',' + sp[1]);
  if (cfg.boss) {
    add('stairs', goalRoom, { exit: true });
    { const b = monsterStats('boss', 1, floor); add('monster', goalRoom, { type: 'boss', hp: b.hp, maxHp: b.hp, dmg: b.dmg, alive: true }); }
    if (!add('lever', blueRoom, { door: goalDoor.id, on: false })) return null;
    if (!testMode) for (const ty of BAL.guards) if (!addMon(ante, ty, 1, false)) return null; // the lever door is guarded by a tight squad
  } else add('stairs', goalRoom, { down: true });
  add('chest', weaponRoom, { contents: cfg.weapon, opened: false, vault: true });
  for (const r of rooms) {
    if (r.id === start || r.type !== 'normal' || (cfg.boss && r.id === ante.id)) continue;
    const dep = depth[r.id];
    let n = countFor();
    const chest = R() < cfg.chest;
    if (chest && cfg.boss && n === 0) n = 1; // better guarded chests on the last floor
    for (let k = 0; k < n; k++) addMon(r, pick(cfg.mix), dep);
    if (chest) add('chest', r, { contents: R() < cfg.mimic ? 'mimic' : 'loot', opened: false });
    if (R() < 0.1) add('item', r, { item: { uid: 'f' + floor + '_' + (++nid), id: 'potion_heal' } });
    if (floor > 0 && R() < 0.12) add('spikes', r);
  }
  // keys: in the main region (never behind any locked door), in a chest or carried by an enemy (guaranteed drop)
  const keyRooms = [...main].filter(id => id !== start && rooms[id].type === 'normal' && !(cfg.boss && id === ante.id));
  const keyRoomOf = {};
  for (const color of keyColorsOf(floor)) {
    const kid = 'key_' + color;
    if (testMode && (color === 'white' || color === 'blue')) { if (!add('item', rooms[start], { item: { uid: 'f' + floor + '_' + kid, id: kid } })) return null; keyRoomOf[color] = start; continue; } // test mode: key right in the start room
    const carriers = mons.filter(e => keyRooms.includes(e.room) && !e.carry);
    if (carriers.length && R() < 0.4) { const c = pick(carriers); c.carry = kid; keyRoomOf[color] = c.room; continue; }
    let c = null; for (let t = 0; t < 20 && !c; t++) c = add('chest', rooms[pick(keyRooms)], { contents: kid, opened: false });
    if (!c) return null; keyRoomOf[color] = c.room;
  }
  if (floor === 0) { // the compass is always on floor 1, not far from the start
    const near = keyRooms.filter(id => depth[id] < 0.4); let c = null;
    for (let t = 0; t < 20 && !c; t++) { const r = rooms[pick(near.length ? near : keyRooms)]; c = R() < 0.5 ? add('chest', r, { contents: 'compass', opened: false }) : add('item', r, { item: { uid: 'f0_compass', id: 'compass' } }); }
    if (!c) return null;
  }
  return { seed, floor, label: cfg.label, cols, rows, W, H, tiles, rooms, doors, doorById, ents, depth, start, exit: goalRoom.id, lockDoorId: goalDoor.id,
    keyRoom: keyRoomOf[cfg.boss ? 'blue' : 'white'], keyRoomOf, special: { goal: goalRoom.id, weapon: weaponRoom.id, blue: blueRoom ? blueRoom.id : null, lever: cfg.boss ? blueRoom.id : null, ante: ante.id } };
}

export function roomOfTile(m, x, y) {
  const cx = Math.floor((x - 1) / RW), cy = Math.floor((y - 1) / RH);
  if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return null;
  const r = m.rooms[cy * m.cols + cx];
  if (x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h) return r.id;
  return null;
}
export function doorDir(m, d, roomId) {
  const r = m.rooms[roomId];
  if (d.vertical) return d.x < r.x0 ? 'west' : 'east';
  return d.y < r.y0 ? 'north' : 'south';
}
export function otherRoom(d, roomId) { return d.a === roomId ? d.b : d.a; }
export function startPos(r) { return [r.x0 + (r.w >> 1), r.y0 + (r.h >> 1)]; }
// balance knobs (tuned so the guide simulation wins ~40-55%)
export const BAL = { hpAdd: -1, dmgMul: 0.5, bossHp: 18, bossDmg: 3, boltCd: 5.5, boltDmg: 1, boltSpeed: 3.5,
  guards: ['skeleton', 'skeleton', 'skeleton', 'vampire', 'chomper'],
  floors: [ // counts[k] = weight of k enemies in a normal room; hp = extra hp on that floor
    { counts: [55, 45], hp: 0 },
    { counts: [38, 40, 22], hp: 0 },
    { counts: [20, 32, 30, 18], hp: 1 },
  ] };
export function monsterStats(type, dep, floor = 0) {
  if (type === 'boss') return { hp: BAL.bossHp, dmg: BAL.bossDmg };
  const b = { skeleton: [3, 2], skeleton2: [4, 2], vampire: [3, 2], chomper: [4, 2], mimic: [4, 3] }[type];
  return { hp: Math.max(1, b[0] + BAL.hpAdd + (BAL.floors[floor]?.hp || 0) + Math.round(dep * 2)), dmg: Math.max(1, Math.round((b[1] + (dep > 0.7 ? 1 : 0)) * BAL.dmgMul)) };
}
