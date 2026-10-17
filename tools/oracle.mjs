// A good guide: sees the map (and the mimic tell), not the future. Plays all floors: keys -> weapon vault -> lever -> stairs / boss.
import { astar } from '../src/path.js';
import { roomOfTile, doorDir, otherRoom, keyLocations, keyColorsOf } from '../src/maze.js';
import { def, bonusOf } from '../src/items.js';

export function oracle(g) {
  const h = g.hero, s = g.stats(), room = h.room, m = g.m;
  if (h.hp <= s.maxHp * 0.45 && g.findItem('potion_heal')) return ['drink_heal'];
  for (const it of h.inv) if (it && def(it).slot) { const cur = h.equip[def(it).slot]; if (!cur || bonusOf(it) > bonusOf(cur)) return ['equip_' + it.uid]; }
  const mons = g.monstersIn(room);
  if (mons.length) {
    if (mons.some(x => x.type === 'boss') && g.findItem('potion_shield') && h.shield <= 0) return ['drink_shield'];
    return ['attack_nearest'];
  }
  const wanted = it => { const d = def(it); if (/^key_|^compass/.test(it.id) || d.use || d.ring) return true; if (d.slot) { const cur = h.equip[d.slot]; return !cur || bonusOf(it) > bonusOf(cur); } return false; };
  const items = g.itemsIn(room).filter(e => wanted(e.item) && (h.inv.includes(null) || /^key_/.test(e.item.id)));
  if (items.length) {
    if (!h.inv.includes(null)) { const junk = h.inv.find(i => !/^key_|^compass/.test(i.id)); if (junk) return ['drop_' + junk.uid, 'pick_' + items[0].id]; }
    return [...safeMovesTo(g, [[items[0].x, items[0].y]]), 'pick_' + items[0].id];
  }
  const chest = g.ents.find(e => e.kind === 'chest' && !e.opened && e.room === room && e.contents !== 'mimic'); // the guide sees the mimic tell
  if (chest) { const mv = safeMovesTo(g, g.adj(chest.x, chest.y).filter(([x, y]) => !g.blockedBy(x, y))); return mv.length ? mv : ['open_' + chest.id]; }
  if (g.ents.some(e => e.kind === 'stairs' && e.room === room)) return ['take_stairs'];
  if (g.ents.some(e => e.kind === 'lever' && e.room === room && !e.on)) return ['pull_lever'];
  // what next: missing keys (nearest first), then the weapon vault, then the lever room, then the goal
  const canPass = d => !d.locked || (d.color && h.keysOf(d.color) > 0);
  const par = new Map([[room, null]]), q = [room];
  while (q.length) { const c = q.shift(); for (const id of m.rooms[c].doors) { const d = m.doorById[id]; if (!canPass(d)) continue; const o = otherRoom(d, c); if (m.rooms[o].type === 'lava') continue; if (!par.has(o)) { par.set(o, d); q.push(o); } } }
  const hops = r => { let n = 0; while (par.get(r)) { r = otherRoom(par.get(r), r); n++; } return n; };
  const targets = [];
  const vaultDoor = m.doorById[m.rooms[m.special.weapon].doors[0]], vaultChest = g.ents.find(e => e.kind === 'chest' && e.room === m.special.weapon && !e.opened);
  for (const c of keyColorsOf(m.floor)) {
    if (h.keysOf(c)) continue;
    const door = m.doors.find(d => d.color === c && d.locked); if (!door) continue;
    if (c === 'yellow' && !vaultChest) continue;
    for (const e of keyLocations(m, 'key_' + c)) if (par.has(e.room)) targets.push(e.room);
  }
  if (targets.length) targets.sort((a, b) => hops(a) - hops(b));
  else if (vaultChest && par.has(m.special.weapon)) targets.push(m.special.weapon);
  else if (m.special.lever != null && m.doorById[m.lockDoorId].locked && par.has(m.special.lever)) targets.push(m.special.lever);
  else if (par.has(m.exit)) targets.push(m.exit);
  const target = targets[0];
  if (target == null || target === room) return ['wait'];
  let r = target, d = null; while (par.get(r)) { d = par.get(r); const prev = otherRoom(d, r); if (prev === room) break; r = prev; }
  if (!d) return ['wait'];
  const dir = doorDir(m, d, room);
  const inside = g.adj(d.x, d.y).filter(([x, y]) => roomOfTile(m, x, y) === room);
  return [...safeMovesTo(g, inside), 'go_' + dir];
}
function safeMovesTo(g, targets) {
  const h = g.hero, m = g.m;
  const spike = (x, y) => g.ents.some(e => e.kind === 'spikes' && e.x === x && e.y === y);
  const p = astar(m.W, m.H, [h.x, h.y], targets, (x, y) => !g.blockedBy(x, y) && !spike(x, y) && roomOfTile(m, x, y) === h.room);
  if (!p || !p.length) return [];
  const out = []; let px = h.x, py = h.y, cur = null, k = 0;
  for (const [x, y] of p) {
    const dir = x > px ? 'east' : x < px ? 'west' : y > py ? 'south' : 'north';
    if (dir === cur && k < 5) k++; else { if (cur) out.push(`move_${cur}_${k}`); cur = dir; k = 1; }
    px = x; py = y;
  }
  if (cur) out.push(`move_${cur}_${k}`);
  return out;
}