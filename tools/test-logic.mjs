// Headless logic tests: maze, special rooms, commands, idle hero, i18n, guide simulation.
import { generate, roomOfTile, startPos, doorDir, T, FLOORS, keyLocations, keyColorsOf, solvable } from '../src/maze.js';
import { mimicTell } from '../src/game.js';
import { astar } from '../src/path.js';
import { Game, IDLE_TIMEOUT } from '../src/game.js';
import { runSim } from './sim.mjs';
import { roomActions, genericActions, keywordInterpret } from '../src/agent.js';
import { makeItem } from '../src/items.js';
import { oracle } from './oracle.mjs';
import { buildPlanQuestions, selectPlan, makeCommandGate, splitCommand } from '../src/plan.js';
import { setLang, t } from '../src/i18n.js';
import { describeItem } from '../src/items.js';
import { sayFor } from '../src/agent.js';
import fs from 'fs';
import { T as TT } from '../src/maze.js';
let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
let lavaN = 0, trapN = 0, deadEnds = 0, compassN = 0;
for (let seed = 1; seed <= 200; seed++) for (let floor = 0; floor < FLOORS.length; floor++) {
  const m = generate({ seed, floor });
  const live = m.rooms.filter(r => r.type !== 'lava');
  const isLava = id => m.rooms[id].type === 'lava';
  const seen = new Set([m.start]), q = [m.start];
  while (q.length) { const c = q.shift(); for (const id of m.rooms[c].doors) { const d = m.doorById[id]; const o = d.a === c ? d.b : d.a; if (!seen.has(o) && !isLava(o)) { seen.add(o); q.push(o); } } }
  ok(seen.size === live.length, `seed ${seed}: all non-lava rooms are connected without lava (${seen.size}/${live.length})`);
  ok(!isLava(m.exit) && !isLava(m.keyRoom) && !isLava(m.start), `seed ${seed}: start/key/exit are not lava rooms`);
  for (const r of m.rooms.filter(r => r.type === 'lava')) {
    lavaN++;
    ok(r.doors.length >= 1, `seed ${seed}: lava room ${r.id} has an entrance`);
    ok(!m.ents.some(e => e.room === r.id), `seed ${seed}: no entities in lava rooms`);
    let lavaT = 0;
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (m.tiles[y * m.W + x] === T.LAVA) lavaT++;
    ok(lavaT === r.w * r.h, `seed ${seed}: lava room is all lava (${lavaT}/${r.w * r.h})`);
    ok(r.doors.length === 1, `seed ${seed}: lava room is a dead end`);
  }
  deadEnds += live.filter(r => r.doors.length === 1).length;
  const boss = m.ents.filter(e => e.type === 'boss'), last = !!FLOORS[floor].boss, F = `seed ${seed} floor ${m.label}`;
  ok(last ? boss.length === 1 && boss[0].room === m.exit : boss.length === 0, `${F}: boss only in the exit room of the last floor`);
  const st = m.ents.filter(e => e.kind === 'stairs');
  ok(st.length === 1 && st[0].room === m.exit && (last ? st[0].exit : st[0].down), `${F}: one staircase (down, or the exit on the last floor)`);
  const gd = m.doorById[m.lockDoorId];
  ok(gd.locked && (last ? gd.lever && !gd.color : gd.color === 'white') && m.rooms[m.exit].doors.length === 1, `${F}: goal room is a dead end behind a ${last ? 'lever' : 'white'} door`);
  for (const c of keyColorsOf(floor)) { ok(keyLocations(m, 'key_' + c).length === 1, `${F}: one ${c} key`); ok(m.doors.filter(d => d.color === c).length === 1, `${F}: one ${c} door`); }
  ok(solvable(m), `${F}: solvable - every key reachable without locked doors (never behind its own door), goal reachable after`);
  ok(last ? m.doors.filter(d => d.color === 'blue').length === 1 : !m.doors.some(d => d.color === 'blue') && !keyLocations(m, 'key_blue').length && !m.rooms.some(r => r.type === 'treasure' || r.type === 'lever'), `${F}: blue door/key only on floor -2`);
  if (last) { const br = m.rooms.find(r => r.type === 'lever'); ok(br && m.ents.some(e => e.kind === 'lever' && e.room === br.id) && !m.ents.some(e => e.kind === 'chest' && e.room === br.id), `${F}: the blue room holds the lever (no bonus chests)`); }
  { const lv = m.ents.filter(e => e.kind === 'lever'); ok(last ? lv.length === 1 && lv[0].door === m.lockDoorId && m.doorById[m.rooms[lv[0].room].doors[0]].color === 'blue' : lv.length === 0, `${F}: lever behind the blue door opens the boss door`); }
  { const v = m.ents.find(e => e.kind === 'chest' && e.vault); ok(v && v.contents === FLOORS[floor].weapon && m.doorById[m.rooms[v.room].doors[0]].color === 'yellow', `${F}: yellow door guards the ${FLOORS[floor].weapon} chest`); }
  if (floor === 0) { const c = m.ents.filter(e => (e.kind === 'item' && e.item.id === 'compass') || (e.kind === 'chest' && e.contents === 'compass')); ok(c.length === 1, `${F}: compass on floor 1`); compassN += c.length; }
  const types = new Set(m.ents.filter(e => e.kind === 'monster' && m.rooms[e.room].type === 'normal' && e.room !== m.special.ante).map(e => e.type));
  ok([...types].every(ty => FLOORS[floor].mix.includes(ty)), `${F}: enemy types match the floor (${[...types]})`);
  ok(floor === 2 || !m.ents.some(e => e.kind === 'chest' && e.contents === 'mimic'), `${F}: mimics only on the last floor`);
  for (const r of m.rooms.filter(r => r.type === 'trap')) {
    trapN++;
    const safe = new Set(r.safe), spikes = new Set(m.ents.filter(e => e.kind === 'spikes' && e.room === r.id).map(e => e.x + ',' + e.y));
    ok(safe.size + spikes.size === r.w * r.h, `seed ${seed}: trap: spikes everywhere except the path`);
    ok(safe.size <= r.w * r.h * 0.6, `seed ${seed}: path is narrow (${safe.size}/${r.w * r.h})`);
    const ins = r.doors.map(id => { const d = m.doorById[id]; return d.vertical ? [d.x < r.x0 ? d.x + 1 : d.x - 1, d.y] : [d.x, d.y < r.y0 ? d.y + 1 : d.y - 1]; });
    for (const b of ins.slice(1)) { const p = astar(m.W, m.H, ins[0], [b], (x, y) => safe.has(x + ',' + y)); ok(p, `seed ${seed}: safe path between trap entrances`); }
  }
}
console.log(`3 floors x 200 seeds: lava ${(lavaN / 600).toFixed(1)} rooms, traps ${(trapN / 600).toFixed(1)} rooms, dead ends ${(deadEnds / 600).toFixed(1)} per floor; compass on floor 1 in ${compassN}/200`);
// ordered into a lava room, the hero walks in and burns
{
  let n = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = new Game({ seed, floor: 2 }), r = g.m.rooms.find(r => r.type === 'lava'); if (!r) continue;
    const d = g.m.doorById[r.doors[0]], o = d.a === r.id ? d.b : d.a; d.locked = false;
    for (const e of g.ents) if (e.kind === 'monster' && e.room === o) e.alive = false;
    const [ex, ey] = g.adj(d.x, d.y).find(([x, y]) => roomOfTile(g.m, x, y) === o);
    g.hero.x = ex; g.hero.y = ey; g.hero.room = o; g.hero.cd = 0; let burn = 0; g.on(ty => { if (ty === 'burn') burn++; });
    const dir = doorDir(g.m, d, o); g.setQueue(['go_to_room_' + dir[0].toUpperCase()]);
    for (let i = 0; i < 200 && !g.hero.dead; i++) g.update(0.05);
    ok(g.hero.dead && burn === 1, `seed ${seed}: ordered into lava, the hero burns`); n++;
  }
  ok(n > 0, 'lava check ran');
}
// damage: base Strength 0, swords +1..+4, unarmed 0
{
  const g = new Game({ seed: 3 }), h = g.hero;
  ok(h.base.str === 0 && h.equip.weapon?.id === 'sword_white' && g.stats().dmg === 1, 'start: Strength 0, white sword, damage 1');
  ok(Object.values(h.base).every(v => v === 0) && g.stats().maxHp === 10 && h.hp === 10 && g.stats().dodge === 0, 'start: all base stats 0, HP 10');
  h.base.sta = 2; ok(g.stats().maxHp === 20, 'HP = 10 + 5 * Stamina'); h.base.sta = 0;
  const exp = { sword_white: 1, sword_blue: 2, sword_gold: 3, sword_red: 4 };
  for (const [id, n] of Object.entries(exp)) { h.equip.weapon = makeItem(id); ok(g.stats().dmg === n, `${id} gives damage ${n}`); }
  h.equip.weapon = null; ok(g.stats().dmg === 0, 'no sword: damage 0');
}
// a chest spills items onto the floor
{
  const g = new Game({ seed: 2 }), h = g.hero;
  const c = g.ents.find(e => e.kind === 'chest' && /^key_/.test(e.contents)) || (() => { const x = g.ents.find(e => e.kind === 'chest'); x.contents = 'key_white'; return x; })();
  g.openChest(c);
  const k = g.ents.find(e => e.kind === 'item' && e.item.id === c.contents);
  ok(k && k.room === c.room && Math.max(Math.abs(k.x - c.x), Math.abs(k.y - c.y)) <= 3 && g.tile(k.x, k.y) === T.FLOOR, 'key spilled next to the chest');
  ok(h.keys === 0, 'key did not go into the backpack by itself');
}
// idle hero: stands still, makes no decisions, does not win
{
  let moved = 0, jevLike = 0, asks = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = new Game({ seed, auto: false }); const x0 = g.hero.x, y0 = g.hero.y; // autonomy has its own tests
    g.on(t => { if (t === 'goal') jevLike++; if (t === 'askWhat') asks++; });
    for (let i = 0; i < 2400; i++) g.update(0.05);
    if (g.hero.x !== x0 || g.hero.y !== y0) moved++;
    ok(!g.hero.won, 'idle hero does not win');
  }
  ok(moved === 0, `with autonomy off the hero does not walk without commands (moved in ${moved}/20)`);
  ok(jevLike === 0, 'no goals appear without commands');
}
// commands (keyword fallback, Ukrainian)
{
  const g = new Game({ seed: 7 });
  const ra = roomActions(g), ga = genericActions();
  console.log('actions in the start room:', Object.keys(ra).join(', '), `+ ${Object.keys(ga).length} generic`);
  setLang('uk');
  const kw = t => keywordInterpret(g, t).steps.join(' → ') || '(not understood)';
  for (const t of ['йди на схід', 'три кроки ліворуч, потім вгору до стіни', 'випий зілля', 'стоп', 'бла бла', 'йди в нижню кімнату', 'збери все', 'атакуй скелета', 'підбери меч', 'йди на північ, потім на схід']) console.log(`«${t}» → ${kw(t)}`);
  ok(keywordInterpret(g, 'три кроки ліворуч, потім вгору до стіни').steps.join() === 'move_west_3,move_north_wall', 'uk: step sequence');
  ok(keywordInterpret(g, 'йди в праву кімнату, потім вниз, потім атакуй').steps.join() === 'go_to_room_E,go_to_room_S,kill_nearest', 'uk: three macros in a row');
  ok(keywordInterpret(g, 'бла бла').notUnderstood, 'gibberish -> not understood');
  const x0 = g.hero.x; g.setQueue(['move_west_2']); for (let i = 0; i < 60; i++) g.update(0.05);
  ok(g.hero.x === x0 - 2, 'steps are executed exactly');
  let asked = 0; g.on(t => { if (t === 'askWhat') asked++; }); g.setQueue(['wait']); for (let i = 0; i < 100; i++) g.update(0.05);
  ok(asked === 1, 'after a command the hero asks what to do');
}
// macros
{
  let tested = 0;
  for (let seed = 1; seed <= 40 && tested < 5; seed++) {
    const g = new Game({ seed }), h = g.hero;
    const d = g.doorsOfRoom(h.room).find(d => doorDir(g.m, d, h.room) === 'south' && !d.locked); if (!d) continue;
    const dest = d.a === h.room ? d.b : d.a; tested++; for (const e of g.ents) if (e.kind === 'monster' && e.room === dest) e.alive = false;
    const k = keywordInterpret(g, 'йди в нижню кімнату'); ok(k.steps.join() === 'go_to_room_S', 'lower room -> go_to_room_S');
    let asks = 0; g.on(t => { if (t === 'askWhat') asks++; });
    g.setQueue(k.steps); for (let i = 0; i < 400 && g.goal; i++) g.update(0.05);
    ok(h.room === dest && roomOfTile(g.m, h.x, h.y) === dest && g.moves > 1, `seed ${seed}: reached the lower room (${g.moves} steps)`);
    ok(asks === 1, 'asked what to do once, after the macro');
  }
  ok(tested > 0, 'found a start room with a south door');
  let killed = 0, n = 0;
  for (let seed = 1; seed <= 40 && n < 5; seed++) {
    const g = new Game({ seed }), mon = g.ents.find(e => e.kind === 'monster' && e.type !== 'boss' && g.m.rooms[e.room].type === 'normal'); if (!mon) continue;
    n++; const r = g.m.rooms[mon.room], h = g.hero;
    h.room = r.id; [h.x, h.y] = g.freeAround(mon.x, mon.y, r.id) || [mon.x, mon.y + 1]; h.base.sta = 10; h.hp = g.stats().maxHp;
    g.setQueue(['kill_' + mon.id]); for (let i = 0; i < 600 && g.goal; i++) g.update(0.05);
    if (!mon.alive) killed++;
  }
  ok(n > 0 && killed === n, `kill macro kills the enemy (${killed}/${n})`);
  {
    const g = new Game({ seed: 3 }), h = g.hero, d0 = g.doorsOfRoom(h.room)[0], dir = doorDir(g.m, d0, h.room);
    g.setQueue(['go_to_room_' + dir[0].toUpperCase()]); for (let i = 0; i < 4; i++) g.update(0.05);
    g.setQueue(['stop']);
    ok(g.goal && g.goal.type === 'wait', 'a new command replaces the current macro');
    const x = h.x, y = h.y; for (let i = 0; i < 40; i++) g.update(0.05);
    ok(h.x === x && h.y === y && h.room === g.m.start, 'after interruption the hero does not continue the old macro');
  }
}
// trap: walking straight through hurts, the guide does not
{
  let hurtDirect = 0, n = 0;
  for (let seed = 1; seed <= 30 && n < 10; seed++) {
    const g = new Game({ seed, floor: 2 }), tr = g.m.rooms.find(r => r.type === 'trap'); if (!tr) continue;
    n++; const [sx, sy] = tr.safe[0].split(',').map(Number); g.hero.x = sx; g.hero.y = sy; g.hero.room = tr.id;
    g.hero.cd = 0; g.hero.base.agi = 0; const hp0 = g.hero.hp;
    const d = g.doorsOfRoom(tr.id).map(d => ({ d, dist: Math.abs(d.x - sx) + Math.abs(d.y - sy) })).sort((a, b) => b.dist - a.dist)[0].d;
    g.goal = { type: 'go', door: d.id, label: 'test', t: 0 }; for (let i = 0; i < 300 && g.goal; i++) g.update(0.05);
    if (g.hero.hp < hp0) hurtDirect++;
  }
  console.log(`trap: walking straight hurt the hero in ${hurtDirect}/${n} cases`);
  ok(hurtDirect >= n * 0.5, 'naive trap crossing usually hurts');
}

// ---- JEV plan: selection (noul) and order (score) on a mocked answer, both languages ----
{
  const acts = { go_to_room_S: 'MACRO: go south', kill_m1: 'MACRO: kill', pick_up_all: 'MACRO: pick all', wait: 'wait', look_around: 'look', drink_potion: 'drink', explore_room: 'explore' };
  const q = buildPlanQuestions(acts, ['йди на південь', 'вбий скелета'], 'uk');
  ok(Object.keys(q).length === 14, 'plan: 2 questions per action');
  ok(Object.keys(buildPlanQuestions(acts, ['go south'], 'en')).length === 7, 'plan: one part -> no score');
  ok(q.ord__kill_m1.criteria[1].includes('вбий скелета') && q.ask__go_to_room_S.instructions.action.includes('нижню') && q.ask__go_to_room_S.instructions.action.includes('lower'), 'plan uk: levels = command parts, Ukrainian + English descriptions');
  { const e = buildPlanQuestions(acts, ['go south', 'kill the skeleton'], 'en'); ok(e.ord__kill_m1.criteria[1].includes('kill the skeleton') && !/[\u0400-\u04FF]/.test(JSON.stringify(e)), 'plan en: English only'); }
  ok(JSON.stringify(splitCommand('Йди в нижню кімнату а потім у праву', 'uk')) === JSON.stringify(['Йди в нижню кімнату', 'у праву']), 'split uk: а потім');
  ok(splitCommand('Йди в праву кімнату і зупинись', 'uk').length === 2 && splitCommand('йди вниз й атакуй', 'uk').length === 2 && splitCommand('спочатку вниз, затим вправо', 'uk').length === 2 && splitCommand('стоп', 'uk').length === 1, 'split uk: і / й / затим / one part');
  ok(JSON.stringify(splitCommand('Go to the lower room and then the right one', 'en')) === JSON.stringify(['Go to the lower room', 'the right one']), 'split en: and then');
  ok(splitCommand('go right and stop', 'en').length === 2 && splitCommand('go down, then attack', 'en').length === 2 && splitCommand('stop', 'en').length === 1, 'split en: and / then / one part');
    { const s = selectPlan({ ask__stop: { noul: 0.69 }, ask__wait: { noul: 0.76 }, ord__stop: { score: 1 }, ord__wait: { score: 1 } }, { stop: '', wait: '' }); ok(s.length === 1 && s[0].label === 'wait', 'plan: stop/wait are synonyms'); }
  ok(q.ask__kill_m1.type === 'noul' && q.ord__kill_m1.type === 'score' && q.ord__kill_m1.criteria.length === 2 && !q.ask__kill_m1.instructions.action.includes('MACRO'), 'plan: noul/score question shape');
  const A = (p, s) => ({ noul: p, score: s });
  const ans = { ask__go_to_room_S: { noul: 0.9 }, ord__go_to_room_S: { score: 1.2 }, ask__kill_m1: { noul: 0.8 }, ord__kill_m1: { score: 2.5 },
    ask__pick_up_all: { noul: 0.6 }, ord__pick_up_all: { score: 2.5 }, ask__wait: { noul: 0.5 }, ord__wait: { score: 0 },
    ask__look_around: { noul: 0.2 }, ord__look_around: { score: 0 } };
  const p = selectPlan(ans, acts).map(s => s.label);
  ok(JSON.stringify(p) === JSON.stringify(['go_to_room_S', 'kill_m1', 'pick_up_all']), 'plan: threshold 0.5, sort by score, ties by noul: ' + p);
  const many = {}; const big = {};
  for (let i = 0; i < 8; i++) { big['a' + i] = 'x'; many['ask__a' + i] = { noul: 0.55 + i * 0.05 }; many['ord__a' + i] = { score: i }; }
  const p2 = selectPlan(many, big).map(s => s.label);
  ok(p2.length === 5 && p2[0] === 'a3' && p2[4] === 'a7', 'plan: at most 5, most confident kept: ' + p2);
  ok(selectPlan({}, acts).length === 0, 'plan: empty if nothing selected');
}
// ---- a new command interrupts the plan; stale answers are discarded ----
{
  const gate = makeCommandGate(); const a1 = gate.begin(), a2 = gate.begin();
  ok(!gate.isCurrent(a1) && gate.isCurrent(a2), 'stale JEV answer is discarded');
  const g = new Game({ seed: 3 });
  g.setQueue(['explore_room', 'look_around', 'wait']);
  for (let i = 0; i < 10; i++) g.update(0.05);
  ok(g.goal && g.goal.label === 'explore_room', 'plan runs');
  ok(g.abortPlan() === true && !g.goal && !g.queue.length && g.hero.anim !== 'walk', 'abortPlan clears the macro and the rest of the plan');
  ok(g.abortPlan() === false, 'abortPlan without a plan -> false');
  g.setQueue(['look_around']); ok(g.goal && g.goal.label === 'look_around', 'a new plan is built after interruption');
  g.setQueue(['kill_nobody', 'open_chest_nothing', 'wait']);
  ok(g.goal && g.goal.label === 'wait', 'invalid plan steps are skipped');
}
// ---- enemy counts per floor: start room empty, none in lava/trap, spaced; floor caps; boss alone; lever door guarded ----
{
  let bad = 0; const hist = FLOORS.map(() => [0, 0, 0, 0, 0, 0]);
  for (let seed = 1; seed <= 200; seed++) for (let floor = 0; floor < 3; floor++) {
    const m = generate({ seed, floor });
    for (const r of m.rooms) {
      const ms = m.ents.filter(e => e.kind === 'monster' && e.room === r.id);
      if (r.type === 'normal' && r.id !== m.start && r.id !== m.special.ante) hist[floor][Math.min(5, ms.length)]++;
      if ((r.id === m.start || r.type === 'lava' || r.type === 'trap') && ms.length) bad++;
      if (r.id === m.exit && floor === 2 && (ms.length !== 1 || ms[0].type !== 'boss')) bad++;
      if (r.id === m.special.ante && floor === 2 && ms.map(e => e.type).sort().join() !== 'chomper,skeleton,skeleton,skeleton,vampire') bad++;
      if (!(floor === 2 && r.id === m.special.ante)) for (const a of ms) for (const b of ms) if (a !== b && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < 2) bad++;
      for (const a of ms) if (r.doors.some(id => { const d = m.doorById[id]; return Math.abs(d.x - a.x) + Math.abs(d.y - a.y) < 2; })) bad++;
    }
  }
  hist.forEach((h, f) => { const tot = h.reduce((a, b) => a + b, 0); console.log(`floor ${FLOORS[f].label}: enemies per room 0..5:`, h.map(x => Math.round(100 * x / tot) + '%').join(' ')); });
  ok(bad === 0, 'enemy placement rules (' + bad + ')');
  ok(hist[0].slice(2).every(x => x === 0) && hist[1].slice(3).every(x => x === 0) && hist[2].slice(4).every(x => x === 0) && hist[2][3] > 0, 'floor caps: 1 / 2 / 3 enemies per room');
}
// ---- group attacks are staggered ----
{
  let n = 0, same = 0;
  for (let seed = 1; seed <= 60 && n < 10; seed++) { const g = new Game({ seed, floor: 1 }); const r = g.m.rooms.find(r => r.type === 'normal' && g.monstersIn(r.id).length >= 2); if (!r) continue; n++; g.enterRoom(r.id); const cds = g.monstersIn(r.id).map(m => m.cd); if (new Set(cds.map(c => c.toFixed(2))).size < cds.length) same++; }
  ok(n > 0 && same === 0, 'group attack timers are staggered');
}
// ---- enemies wander inside their room ----
{
  let moved = 0, bad = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = new Game({ seed }); g.rand = Math.random;
    const mons = g.ents.filter(e => e.kind === 'monster' && e.room !== g.hero.room);
    const start = new Map(mons.map(e => [e.id, e.x + ',' + e.y]));
    for (let i = 0; i < 600; i++) {
      g.setQueue(['wait']); g.update(0.05);
      for (const e of mons) {
        if (start.get(e.id) === e.x + ',' + e.y) continue;
        if (roomOfTile(g.m, e.x, e.y) !== e.room || g.tile(e.x, e.y) !== TT.FLOOR || g.ents.some(s => s.kind === 'spikes' && s.x === e.x && s.y === e.y)
          || g.adj(e.x, e.y).some(([a, b]) => g.tile(a, b) === TT.DOOR)) bad++;
      }
    }
    moved += mons.filter(e => start.get(e.id) !== e.x + ',' + e.y).length;
  }
  ok(moved > 10, 'enemies wander (moved ' + moved + ')');
  ok(bad === 0, 'wandering enemies stay in the room, off spikes/lava/doorways (' + bad + ')');
}

// ---- human-like movement: diagonals without corner cutting, varied routes; spikes only when stepped on ----
{
  let diag = 0, cut = 0, steps = 0; const routes = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const g = new Game({ seed }); let px = g.hero.x, py = g.hero.y;
    g.on(ty => { if (ty === 'floor') { px = g.hero.x; py = g.hero.y; return; } if (ty !== 'step') return; const h = g.hero, dx = h.x - px, dy = h.y - py; steps++;
      if (dx && dy) { diag++; const bad = (x, y) => [TT.WALL, TT.LAVA, TT.DOOR].includes(g.tile(x, y)); if (bad(px + dx, py) || bad(px, py + dy) || bad(px, py) || bad(h.x, h.y)) cut++; }
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) cut++;
      px = h.x; py = h.y; });
    for (let i = 0; i < 20000 && !g.hero.won && !g.hero.dead; i++) { g.update(0.05); if (!g.goal && !g.queue.length) g.setQueue(oracle(g)); }
  }
  for (let k = 0; k < 6; k++) { const g = new Game({ seed: 5 }); const r = g.m.rooms[g.hero.room]; const tr = []; g.on(ty => { if (ty === 'step') tr.push(g.hero.x + ',' + g.hero.y); });
    g.setQueue(['explore_room']); { const h = g.hero, c = [[r.x0, r.y0], [r.x0 + r.w - 1, r.y0], [r.x0, r.y0 + r.h - 1], [r.x0 + r.w - 1, r.y0 + r.h - 1]].filter(([x, y]) => g.tile(x, y) === TT.FLOOR && !g.blockedBy(x, y)).sort((a, b) => Math.hypot(b[0] - h.x, b[1] - h.y) - Math.hypot(a[0] - h.x, a[1] - h.y)); g.goal.pts = [c[0]]; } for (let i = 0; i < 200 && g.goal; i++) g.update(0.05); routes.add(tr.join(' ')); }
  ok(diag > 10, 'the hero walks diagonally (' + diag + ' of ' + steps + ')');
  ok(cut === 0, 'diagonals do not cut walls/lava/doors (' + cut + ')');
  ok(routes.size >= 2, 'routes across a room differ (' + routes.size + ' variants of 6)');
  const g = new Game({ seed: 2 }), sp = g.ents.find(e => e.kind === 'spikes');
  if (sp) { let hurt = 0; g.on(ty => { if (ty === 'heroHurt') hurt++; }); g.hero.x = sp.x; g.hero.y = sp.y; g.hero.room = sp.room;
    for (let i = 0; i < 100; i++) g.update(0.05); ok(hurt === 0 && !g.spikeUp(sp), 'spikes are hidden and do not hit by themselves');
    g.hero.x = sp.x - 1; g.stepHeroTo(sp.x, sp.y); ok(hurt + (g.hero.shield ? 1 : 0) >= 0 && g.spikeUp(sp), 'spikes spring up when stepped on');
    for (let i = 0; i < 25; i++) g.update(0.05); ok(!g.spikeUp(sp), 'spikes retract after ~1 s'); }
}
// ---- English keyword fallback ----
{
  const g = new Game({ seed: 7 }); setLang('en');
  const kw = x => keywordInterpret(g, x).steps.join();
  ok(kw('three steps left, then up to the wall') === 'move_west_3,move_north_wall', 'en: step sequence');
  ok(kw('go to the right room, then down, then attack') === 'go_to_room_E,go_to_room_S,kill_nearest', 'en: three macros in a row');
  ok(kw('go to the lower room') === 'go_to_room_S' && kw('drink the potion') === 'drink_potion' && kw('stop') === 'stop' && kw('collect everything') === 'pick_up_all', 'en: basic commands');
  ok(keywordInterpret(g, 'blah blah').notUnderstood && keywordInterpret(g, 'stop').source === 'keywords', 'en: gibberish not understood, source label');
  setLang('uk'); ok(keywordInterpret(g, 'стоп').source === 'ключові слова', 'uk: source label');
}
// ---- i18n: both dictionaries complete, texts switch, no Russian anywhere ----
{
  const src = fs.readFileSync('src/i18n.js', 'utf8');
  const keys = [...src.matchAll(/'([a-zA-Z0-9]+\.[a-zA-Z0-9_]+)':/g)].map(m => m[1]);
  const missing = [...new Set(keys)].filter(k => t(k, {}, 'uk') === k || t(k, {}, 'en') === k);
  ok(missing.length === 0, 'i18n: every key exists in uk and en (' + missing.join(',') + ')');
  const g = new Game({ seed: 3 }); const it = g.hero.equip.weapon;
  setLang('en'); const en = [describeItem(it), sayFor(g, 'go_to_room_S'), sayFor(g, 'move_west_3'), t('say.what')];
  setLang('uk'); const uk = [describeItem(it), sayFor(g, 'go_to_room_S'), sayFor(g, 'move_west_3'), t('say.what')];
  ok(en.join('|') === 'White sword: damage +1|Going to the lower room|3 steps left|What should I do?', 'en texts: ' + en.join('|'));
  ok(uk.join('|') === 'Білий меч: шкода +1|Іду в нижню кімнату|3 кроки ліворуч|Що мені робити?', 'uk texts: ' + uk.join('|'));
  const RU = /[ыэъёЫЭЪЁ]|(?<!\p{L})(что|это|нет|как|если|когда|потом|или|только|комната|сундук|зелье|лестница|герой погиб|делать)(?!\p{L})/iu;
  const files = ['index.html', ...fs.readdirSync('src').map(f => 'src/' + f), ...fs.readdirSync('tools').filter(f => /\.m?js$/.test(f)).map(f => 'tools/' + f), 'server.js'];
  const bad = [];
  for (const f of files) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (RU.test(l) && !l.includes('RU = /')) bad.push(f + ':' + (i + 1)); });
  ok(bad.length === 0, 'no Russian strings left (' + bad.slice(0, 8).join(', ') + ')');
}
// ---- hero autonomy ----
{
  const setup = (seed = 3) => {
    const g = new Game({ seed }); const h = g.hero, s0 = h.room, d = g.doorsOfRoom(s0).find(d => g.m.rooms[otherR(d, s0)].type !== 'lava'), r = otherR(d, s0);
    d.open = true; d.locked = false;
    for (const e of g.ents) if (e.room === r && (e.kind === 'monster' || e.kind === 'chest' || e.kind === 'spikes')) { e.alive = false; e.kind = e.kind === 'monster' ? 'monster' : 'gone'; }
    const p = startPos(g.m.rooms[r]); h.x = p[0]; h.y = p[1]; h.room = r; h.prevRoom = s0; h.visited.add(r);
    g.time = 30; g.quietAt = 0; g.idleDue = 1e9; g.thinkAt = 1e9; g.rand = () => 0.1;
    const ev = []; g.on((ty, dd) => { if (ty === 'auto') ev.push(dd); });
    const mon = (type, dx, dy, hp = 3) => { const e = { id: 'tm' + Math.random(), kind: 'monster', type, hp, maxHp: hp, dmg: 1, alive: true, x: h.x + dx, y: h.y + dy, room: r, cd: 99 }; g.ents.push(e); return e; };
    return { g, h, r, s0, ev, mon };
  };
  const otherR = (d, r) => d.a === r ? d.b : d.a;
  { const { g, ev, mon } = setup(); mon('vampire', 3, 0); g.boltHitAt = g.time; g.update(0.05);
    ok(g.goal && g.goal.auto && g.goal.type === 'flee' && ev[0]?.kind === 'flee' && ev[0].why === 'bolt', 'autonomy: hit by a bolt -> flees to the door he came from'); }
  { const { g, h, ev, mon } = setup(); mon('skeleton', 2, 0); mon('vampire', -2, 0); h.hp = 2; g.update(0.05);
    ok(g.goal && g.goal.type === 'flee' && ev[0]?.why === 'hp', 'autonomy: HP < 40% with several enemies -> flees'); }
  { const { g, h, ev, mon } = setup(); mon('skeleton', 2, 0); mon('vampire', -2, 0); h.hp = 2; g.setQueue(['wait']); g.update(0.05);
    ok(g.goal && !g.goal.auto && !ev.length, 'autonomy: an active human plan step overrides fleeing'); }
  { const { g, ev, mon } = setup(); const m = mon('skeleton', 2, 0); g.update(0.05);
    ok(g.goal && g.goal.auto && g.goal.type === 'attack' && g.goal.target === m.id && ev[0]?.mon === 'skeleton', 'autonomy: one weak enemy -> attacks it himself'); }
  { const { g, ev, mon } = setup(); mon('skeleton', 2, 0); mon('skeleton', -2, 0); g.update(0.05);
    ok(!ev.some(e => e.kind === 'attack'), 'autonomy: two enemies -> does not pick a fight himself'); }
  { const { g, h, r, ev } = setup(); const c = { id: 'tc1', kind: 'chest', contents: 'potion_heal', opened: false, x: h.x + 2, y: h.y, room: r }; g.ents.push(c);
    g.rand = () => 0.1; for (let i = 0; i < 200 && !ev.some(e => e.kind === 'pick'); i++) g.update(0.05);
    ok(ev[0]?.kind === 'chest' && c.opened, 'autonomy: chest in room -> walks to it and opens it');
    ok(ev.some(e => e.kind === 'pick') && g.goal?.type === 'pick', 'autonomy: after opening, sometimes picks up a dropped item (50%)'); }
  { const { g, ev } = setup(); g.idleDue = g.time + IDLE_TIMEOUT.min; for (let i = 0; i < (IDLE_TIMEOUT.min - 1) / 0.05; i++) g.update(0.05);
    ok(!ev.length, 'autonomy: no wandering before the idle timeout');
    for (let i = 0; i < 2 / 0.05; i++) g.update(0.05);
    ok(ev[0]?.kind === 'explore' && g.goal?.type === 'go' && g.goal.auto, 'autonomy: idle for ' + IDLE_TIMEOUT.min + '-' + IDLE_TIMEOUT.max + ' s -> peeks into a neighbouring room'); }
  { const { g, ev } = setup(); g.unclear(); for (let i = 0; i < 3 / 0.05; i++) g.update(0.05);
    ok(ev[0]?.kind === 'explore', 'autonomy: unclear/empty plan -> sometimes picks a neighbouring room'); }
  { const { g, ev, mon } = setup(); mon('skeleton', 2, 0); g.update(0.05); g.setQueue(['wait']);
    ok(g.goal && !g.goal.auto && g.goal.type === 'wait', 'autonomy: a human command interrupts an autonomous action');
    g.abortPlan(); g.hold = true; g.quietAt = -10; ev.length = 0; g.update(0.05); ok(!ev.length, 'autonomy: paused while a command is being interpreted'); }
  { // he does not know about lava: idle exploration may lead into a lava room
    let lava = 0; for (let seed = 1; seed <= 40; seed++) { const g = new Game({ seed, floor: 2 }); g.rand = Math.random; g.m.doors.forEach(d => d.locked = false); for (let i = 0; i < 1200 / 0.05 && !g.hero.dead; i++) g.update(0.05); if (g.hero.burnAt != null) lava++; }
    ok(lava > 0, 'autonomy: the idle hero is unaware of lava (burned in ' + lava + '/40)'); }
  { const src = fs.readFileSync('src/game.js', 'utf8'); ok(!/autonomy\(\)[\s\S]{0,4000}(T\.LAVA|'lava'|spikes)/.test(src.slice(src.indexOf('  autonomy() {'), src.indexOf('  setQueue('))), 'autonomy code does not use trap/lava knowledge'); }
}
// ---- floors, colored keys, lever, compass, mimic ----
{
  // colored door: with the matching key he opens it (key consumed), without it he can't; on his own he never uses a key
  { const g = new Game({ seed: 4 }), m = g.m, h = g.hero; const d = m.doors.find(d => d.color === 'yellow'); const out = m.doors.find(x => x === d) && (m.rooms[d.a].type === 'vault' ? d.b : d.a);
    const p = g.adj(d.x, d.y).find(([x, y]) => roomOfTile(m, x, y) === out); h.x = p[0]; h.y = p[1]; h.room = out; for (const e of g.ents) if (e.kind === 'monster' && e.room === out) e.alive = false;
    const dir = doorDir(m, d, out)[0].toUpperCase(); let why = ''; g.on((ty, dd) => { if (ty === 'goalFail') why = dd.reason; });
    g.setQueue(['go_to_room_' + dir]); for (let i = 0; i < 40 && g.goal; i++) g.update(0.05);
    ok(why === 'locked_yellow' && d.locked, 'colored door without the key: fails with the lock color');
    h.inv[1] = makeItem('key_white'); g.setQueue(['go_to_room_' + dir]); for (let i = 0; i < 40 && g.goal; i++) g.update(0.05); ok(d.locked && h.keysOf('white') === 1, 'a key of another color does not fit');
    h.inv[2] = makeItem('key_yellow'); g.goal = { type: 'go', door: d.id, auto: true, label: 'auto_explore', t: 0 }; for (let i = 0; i < 40 && g.goal; i++) g.update(0.05); ok(d.locked && h.keysOf('yellow') === 1, 'autonomy does not know which key fits (no key used)');
    g.setQueue(['go_to_room_' + dir]); for (let i = 0; i < 100 && g.goal; i++) g.update(0.05);
    ok(!d.locked && h.keysOf('yellow') === 0 && h.room === m.special.weapon, 'commanded through a colored door with its key: opens it automatically, key consumed'); }
  // stairs: floor 1 -> -1 keeps the backpack; floor -2 exit wins
  { const g = new Game({ seed: 6 }), h = g.hero; const s = g.ents.find(e => e.kind === 'stairs'); h.inv[3] = makeItem('ring_luck'); let fl = null; g.on((ty, d) => { if (ty === 'floor') fl = d.label; });
    h.x = s.x - 1; h.y = s.y; h.room = s.room; for (const e of g.ents) if (e.kind === 'monster' && e.room === s.room) e.alive = false;
    ok(Object.keys(roomActions(g)).includes('go_downstairs'), 'JEV gets go_downstairs next to the stairs');
    g.setQueue(['go_downstairs']); for (let i = 0; i < 60 && g.floor === 0; i++) g.update(0.05);
    ok(g.floor === 1 && fl === -1 && g.m.label === -1 && h.room === g.m.start && h.inv[3]?.id === 'ring_luck' && h.visited.size === 1, 'stairs down: next floor, new maze, things kept');
    g.descend(); ok(g.floor === 2 && g.m.label === -2, 'descends to the last floor'); }
  // lever: opens the boss door from the lever room; keys do not
  { const g = new Game({ seed: 8, floor: 2 }), m = g.m, h = g.hero; const lv = g.ents.find(e => e.kind === 'lever'), bd = m.doorById[m.lockDoorId];
    h.inv[1] = makeItem('key_yellow'); h.inv[2] = makeItem('key_blue'); ok(!g.openDoor(bd) && bd.locked, 'keys do not open the lever door');
    ok(g.resolve('pull_lever').error === 'nolever', 'pull_lever only in the lever room');
    const p = g.freeAround(lv.x, lv.y, lv.room); h.x = p[0]; h.y = p[1]; h.room = lv.room; let ev = 0; g.on(ty => { if (ty === 'lever') ev++; });
    ok(Object.keys(roomActions(g)).includes('pull_lever'), 'JEV gets pull_lever in the lever room');
    g.setQueue(['pull_lever']); for (let i = 0; i < 100 && g.goal; i++) g.update(0.05);
    ok(lv.on && !bd.locked && bd.open && ev === 1, 'pulling the lever opens the boss door elsewhere'); }
  // compass: arrow target = nearest uncollected key; none without the compass
  { const g = new Game({ seed: 9 }), h = g.hero; ok(g.compassTarget() === null, 'no compass, no arrow'); h.inv[1] = makeItem('compass');
    const near = c => { let b = null, bd = 1e9; for (const col of ['white', 'yellow', 'blue']) for (const e of keyLocations(g.m, 'key_' + col)) { const d = Math.hypot(e.x - h.x, e.y - h.y); if (d < bd) { bd = d; b = e; } } return b; };
    const t1 = g.compassTarget(); ok(t1 && t1.id === near().id, 'compass points to the nearest key');
    const e = g.ent(t1.id); if (e.kind === 'chest') e.opened = true; else if (e.kind === 'monster') e.alive = false; else e.taken = true;
    const t2 = g.compassTarget(); ok(t2 && t2.id !== t1.id && t2.id === near().id, 'collected keys are no longer targeted'); }
  // mimic: the player sees a brief tell, the hero gets no hint; opening it starts a fight
  { const g = new Game({ seed: 5, floor: 2 }), h = g.hero; const mc = g.ents.find(e => e.kind === 'chest' && e.contents === 'mimic'), lc = g.ents.find(e => e.kind === 'chest' && e.contents === 'loot');
    let on = 0; for (let t = 0; t < 20; t += 0.05) if (mimicTell(mc, t)) on++; let lon = 0; for (let t = 0; t < 20; t += 0.05) if (lc && mimicTell(lc, t)) lon++;
    ok(on > 3 && on < 60 && lon === 0, 'mimic tell is brief and only on mimics (' + on + ' of 400 frames)');
    h.room = mc.room; const p = g.freeAround(mc.x, mc.y, mc.room); h.x = p[0]; h.y = p[1];
    const ra = roomActions(g), act = Object.entries(ra).find(([k]) => k === 'open_chest_' + mc.id); ok(act && !/mimic/i.test(act[1]), 'JEV/hero see the mimic as an ordinary chest');
    for (const e of g.ents) if (e.kind === 'monster' && e.room === mc.room && e !== mc) e.alive = false;
    let hurt = 0; g.on((ty, d) => { if (ty === 'heroHurt' && d.src === mc.id) hurt++; }); h.base.sta = 10; h.hp = g.stats().maxHp;
    g.setQueue(['open_chest_' + mc.id]); for (let i = 0; i < 200; i++) g.update(0.05);
    ok(mc.kind === 'monster' && mc.type === 'mimic' && hurt > 0, 'opened mimic turns into an enemy and bites'); }
  // keywords
  { const g = new Game({ seed: 3 }); setLang('uk'); ok(keywordInterpret(g, 'потягни важіль').steps.join() === 'pull_lever' && keywordInterpret(g, 'спустись сходами').steps.join() === 'take_stairs', 'uk keywords: lever, stairs');
    setLang('en'); ok(keywordInterpret(g, 'pull the lever').steps.join() === 'pull_lever' && keywordInterpret(g, 'go downstairs').steps.join() === 'take_stairs', 'en keywords: lever, stairs'); setLang('uk'); }
}
// ---- funny "didn't understand" replies ----
{
  const { HUH_CATS, HUH_KEY, huhQuestion, huhPhrases, allHuh, pickHuh } = await import('../src/huh.js');
  const cats = Object.keys(HUH_CATS).filter(c => c !== 'other');
  for (const L of ['uk', 'en']) {
    const all = allHuh(L);
    ok(all.length >= 30 && all.length <= 45 && new Set(all).size === all.length, L + ': 30-45 unique huh phrases (' + all.length + ')');
    ok(cats.every(c => huhPhrases(c, L).length >= 3), L + ': every huh category has >= 3 phrases');
    ok(!huhPhrases('other', L).length, L + ": 'other' has no own phrases (falls back to all)");
    for (const c of cats) { const r = []; let good = true; for (let i = 0; i < 30; i++) { const p = pickHuh(c, { lang: L, recent: r }); if (!huhPhrases(c, L).includes(p)) good = false; } ok(good, L + ': pickHuh(' + c + ') stays in its category'); }
    const r = [], seq = []; for (let i = 0; i < 300; i++) seq.push(pickHuh(i % 3 ? null : 'food', { lang: L, recent: r }));
    ok(seq.every((p, i) => !seq.slice(Math.max(0, i - 3), i).includes(p)), L + ': no huh phrase repeats within the last 3');
    ok(r.length === 3, L + ': recent list keeps 3');
    const seen = new Set(); for (let i = 0; i < 400; i++) seen.add(pickHuh(undefined, { lang: L, recent: [] }));
    ok(seen.size === all.length, L + ': without a category any phrase can come up (' + seen.size + '/' + all.length + ')');
    ok(all.includes(pickHuh('nonsense_cat', { lang: L })), L + ': unknown category falls back to all phrases');
  }
  const q = huhQuestion();
  ok(q.type === 'choice' && typeof q.instructions === 'string' && Object.keys(q.criteria).join() === Object.keys(HUH_CATS).join(), 'huh choice question lists all categories');
  // the category question rides in the SAME JEV request (no extra call)
  const { jevInterpret } = await import('../src/jev.js'); const realFetch = globalThis.fetch; let calls = 0, sent;
  for (const [kind, want] of [['food', 'food'], ['other', null], ['bogus', null]]) {
    globalThis.fetch = async (url, o) => { calls++; sent = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ answers: { [HUH_KEY]: { choice: kind } }, usage: { input_tokens: 100 } }) }; };
    const g = new Game({ seed: 3 });
    const res = await jevInterpret({ key: 'k', useProxy: true, state: { human_command: 'хочу млинців' }, roomActs: roomActions(g), generic: genericActions() });
    ok(sent.questions[HUH_KEY]?.type === 'choice' && Object.keys(sent.questions).some(k => k.startsWith('ask__')), 'huh question sent together with the plan questions');
    ok(!res.steps.length && res.huhKind === want, 'JEV huh category ' + kind + ' -> ' + want);
  }
  ok(calls === 3, 'one JEV call per command (' + calls + ')');
  globalThis.fetch = realFetch;
}
// ---- debug URL flags: near / god / compass ----
{
  let bad = 0;
  for (let seed = 1; seed <= 60; seed++) for (let f = 0; f < 3; f++) {
    const m = generate({ seed, floor: f, near: true }), adj = id => m.rooms[m.start].doors.some(d => { const D = m.doorById[d]; return D.a === id || D.b === id; });
    if (!(adj(m.exit) && (f < 2 || adj(m.special.lever)) && solvable(m) && m.ents.some(e => e.kind === 'item' && e.room === m.start && e.item.id === (f < 2 ? 'key_white' : 'key_blue'))
      && !m.ents.some(e => e.kind === 'monster' && e.room === m.start) && m.rooms.filter(r => r.type === 'lava').every(r => r.doors.length === 1))) bad++;
  }
  ok(bad === 0, 'debug near: stairs / lever / boss rooms next to the start, needed key in the start room, still solvable (' + bad + ')');
  const normal = generate({ seed: 5, floor: 2 }); ok(normal.start === 0, 'normal generation unchanged (start room 0)');
  const g = new Game({ seed: 3, god: true, compass: true }), h = g.hero, hp = h.hp; let hurt = 0; g.on(ty => { if (ty === 'heroHurt') hurt++; });
  g.damageHero(5, 'test'); g.damageHero(h.hp, 'lava'); ok(h.hp === hp && !h.dead && hurt === 2, 'debug god: effects shown, no damage, no death');
  ok(g.findItem('compass') && g.compassTarget(), 'debug compass: compass in the backpack from the start');
  ok(!new Game({ seed: 3 }).findItem('compass'), 'no compass at start without the flag');
}
// simulation: a good guide
let burns = 0, wins = 0, deaths = 0, N = 100, tw = 0, cmds = 0;
let iw = 0, idd = 0; const reached = [0, 0, 0], diedOn = [0, 0, 0];
for (let seed = 1; seed <= N; seed++) {
  const r = runSim(seed, { maxT: 5000, on: (g, ty) => { if (ty === 'burn' && !g.goal?.auto) burns++; } }); cmds += r.cmds; // guide answers ~3 s after the hero runs out of orders
  for (let k = 0; k <= r.g.floor; k++) reached[k]++; if (r.dead) diedOn[r.g.floor]++;
  if (r.won) { wins++; tw += r.time; } else if (r.dead) deaths++;
  const q = runSim(seed, { guide: false, maxT: 1500 }); if (q.won) iw++; else if (q.dead) idd++;
}
console.log(`idle hero (no commands): wins ${iw}/${N}, deaths ${idd}`);
console.log(`guide per floor: reached 1/-1/-2 = ${reached.join('/')}, died on 1/-1/-2 = ${diedOn.join('/')}`);
console.log(`with guide: wins ${wins}/${N}, deaths ${deaths}, avg ${(tw / Math.max(1, wins) / 60).toFixed(1)} min game time, ~${Math.round(cmds / N)} commands per game`);
ok(wins >= 30 && wins <= 55, 'with a good guide winning the full 3-floor run is possible but not guaranteed');
ok(burns === 0, 'the guide never leads into lava (' + burns + ')');
console.log(fails ? `RESULT: ${fails} failures` : 'RESULT: all ok');
process.exit(fails ? 1 : 0);
