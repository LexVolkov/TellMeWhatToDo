// Command interpreter: which actions are available now (for JEV) and the keyword fallback parser.
// No strategic hints: the hero does not know where the exit or the key is, or what is good or bad.
import { doorDir } from './maze.js';
import { ITEMS, def } from './items.js';
import { t, getLang, ukSteps } from './i18n.js';
import { splitCommand } from './plan.js';

const DIRS4 = ['north', 'east', 'south', 'west'];
const MON_EN = { skeleton: 'skeleton', skeleton2: 'skeleton', vampire: 'vampire mage (casts magic bolts from a distance)', chomper: 'chomper (toothy, chases you)', mimic: 'mimic', boss: 'big demon' };
const MAXK = 5;
const enName = it => ITEMS[it.id].en + (def(it).slot === 'weapon' ? ` (+${def(it).str} damage)` : '');

function rel(h, e) {
  const dx = e.x - h.x, dy = e.y - h.y, p = [];
  if (dy) p.push(`${Math.abs(dy)} ${dy < 0 ? 'north' : 'south'}`);
  if (dx) p.push(`${Math.abs(dx)} ${dx < 0 ? 'west' : 'east'}`);
  return p.join(', ') || 'right here';
}

const D1 = { north: 'N', south: 'S', east: 'E', west: 'W' };
const SIDE = { north: 'upper (north)', south: 'lower (south)', east: 'right (east)', west: 'left (west)' };
// Macro intents that make sense in any room. The algorithm executes them completely.
export function genericActions() {
  const o = {};
  for (const d of DIRS4) o['go_to_room_' + D1[d]] = `MACRO: go to the neighbouring ${SIDE[d]} room: walk all the way to the ${d} door, open it, pass through and stop inside that room. Use for "go to the ${d === 'south' ? 'lower/bottom' : d === 'north' ? 'upper/top' : d === 'east' ? 'right' : 'left'} room", "go ${d}", "go ${d === 'south' ? 'down' : d === 'north' ? 'up' : d === 'east' ? 'right' : 'left'}".`;
  o.go_back = 'MACRO: go back to the previous room (run away / retreat).';
  o.kill_nearest = 'MACRO: approach the nearest enemy and fight it until it is dead.';
  o.open_nearest_chest = 'MACRO: walk to the nearest chest and open it.';
  o.pick_up_nearest = 'MACRO: walk to the nearest item on the floor and pick it up.';
  o.pick_up_all = 'MACRO: walk around and pick up every item lying on the floor of this room.';
  o.find_and_take_potion = 'MACRO: find a potion lying on the floor in this room and pick it up.';
  o.drink_potion = 'Drink a healing (red) potion from the backpack.';
  o.drink_shield = 'Drink a shield (blue) potion from the backpack.';
  o.take_stairs = 'MACRO: walk onto the stairs in this room (stairs down to the next floor, or the exit).';
  o.go_downstairs = 'MACRO: walk onto the stairs leading down and descend to the next floor.';
  o.pull_lever = 'MACRO: walk to the lever in this room and pull it.';
  o.explore_room = 'MACRO: walk to the middle of the room and look around.';
  o.look_around = 'Look around on the spot.';
  o.wait = 'Stop and wait.';
  o.stop = 'Stop what you are doing and stand still.';
  for (const d of DIRS4) { for (let k = 1; k <= MAXK; k++) o[`move_${d}_${k}`] = `ONLY for an explicit step count ("${k} step${k > 1 ? 's' : ''} ${d}"): step exactly ${k} tile${k > 1 ? 's' : ''} ${d}.`; o[`move_${d}_wall`] = `ONLY when explicitly asked to walk ${d} until/to the wall: walk straight ${d} until a wall.`; }
  return o;
}
// Concrete intents in the current room
export function roomActions(game) {
  const h = game.hero, room = h.room, o = {};
  for (const d of game.doorsOfRoom(room)) {
    const dir = doorDir(game.m, d, room);
    o['go_to_room_' + D1[dir]] = `MACRO: go to the ${SIDE[dir]} room through the ${dir} door (door is ${d.lever && d.locked ? 'barred - opened by a lever somewhere else' : d.color && d.locked ? 'locked with a ' + d.color + ' lock' : d.locked ? 'locked' : d.open ? 'open' : 'closed'}): walk to it, open, pass through, stop inside.`;
  }
  for (const e of game.ents) {
    if (e.room !== room) continue;
    if (e.kind === 'monster' && e.alive) o['kill_' + e.id] = `MACRO: approach and kill the ${MON_EN[e.type]} at ${rel(h, e)}.`;
    if (e.kind === 'chest' && !e.opened) o['open_chest_' + e.id] = `MACRO: walk to the chest at ${rel(h, e)} and open it.`;
    if (e.kind === 'lever' && !e.on) o.pull_lever = `MACRO: walk to the lever at ${rel(h, e)} and pull it.`;
    if (e.kind === 'stairs' && e.down) o.go_downstairs = `MACRO: walk onto the stairs down at ${rel(h, e)} and descend to the next floor.`;
    if (e.kind === 'item' && !e.taken) o['pick_up_' + e.id] = `MACRO: walk to the ${enName(e.item)} at ${rel(h, e)} and pick it up.`;
  }
  for (const it of h.inv) if (it) {
    if (def(it).slot) o['equip_' + it.uid] = `Put on / wield the ${enName(it)} from the backpack.`;
    o['drop_' + it.uid] = `Drop the ${enName(it)} from the backpack onto the floor.`;
  }
  return o;
}
export function describeState(game, command) {
  return {
    human_command: command,
    hero_facing: game.hero.lastDir,
    hero_weapon: game.hero.equip.weapon ? enName(game.hero.equip.weapon) : 'none (unarmed: 0 damage)',
    floor: game.m.label,
    keys_in_backpack: game.hero.inv.filter(i => i && /^key_/.test(i.id)).map(i => i.id.slice(4)).join(', ') || 'none',
    conventions: 'north = up on the screen, south = down, west = left, east = right. "forward" = the facing direction, "back" = opposite.',
  };
}

// What the hero says when he starts an action
export function sayFor(game, label) {
  let m;
  if ((m = /^go_to_room_([NSEW])$/.exec(label))) return t('do.room', { side: t('side.' + m[1]) });
  if (label === 'go_back') return t('do.back');
  if ((m = /^kill_(.+)$/.exec(label))) label = 'attack_' + m[1];
  if ((m = /^open_chest_(.+)$/.exec(label))) label = 'open_' + m[1];
  if (label === 'pick_up_all') return t('do.all');
  if (label === 'find_and_take_potion') return t('do.potion');
  if (label === 'explore_room') return t('do.explore');
  if (label === 'pick_up_nearest') label = 'pick_nearest';
  else if ((m = /^pick_up_(.+)$/.exec(label))) label = 'pick_' + m[1];
  if ((m = /^go_(north|south|east|west)$/.exec(label))) return t('do.go', { dir: t('dir.' + m[1]) });
  if ((m = /^move_(\w+)_(\d+)$/.exec(label))) { const n = +m[2]; return t('do.steps', { n, word: getLang() === 'en' ? (n === 1 ? 'step' : 'steps') : ukSteps(n), dir: t('dir2.' + m[1]) }); }
  if ((m = /^move_(\w+)_wall$/.exec(label))) return t('do.wall', { dir: t('dir2.' + m[1]) });
  if (label.startsWith('attack_')) { const e = game.ent(label.slice(7)); return e && e.type ? t('do.attack', { mon: t('monAcc.' + e.type) }) : t('do.fight'); }
  if (label.startsWith('open_')) return t('do.open');
  if (label.startsWith('pick_')) { const e = game.ent(label.slice(5)); return e && e.item ? t('do.pick', { item: ITEMS[e.item.id].name.toLowerCase() }) : t('do.pick0'); }
  if (label.startsWith('equip_')) { const it = game.invItem(label.slice(6)); return it ? t('do.equip', { item: ITEMS[it.id].name.toLowerCase() }) : t('do.equip0'); }
  if (label.startsWith('drop_')) { const it = game.invItem(label.slice(5)); return it ? t('do.drop', { item: ITEMS[it.id].name.toLowerCase() }) : t('do.drop0'); }
  const K = { pull_lever: 'do.lever', go_downstairs: 'do.down', drink_heal: 'do.drink', drink_potion: 'do.drink', look_around: 'do.look', stop: 'do.stop', drink_shield: 'do.shield', flee_back: 'do.flee', take_stairs: 'do.stairs', wait: 'do.wait', look: 'do.look' };
  return t(K[label] || 'do.ok');
}

// ---- keyword fallback without a key (Ukrainian + English) ----
const RX = {
  north: /півн|верх|вгору|угору|догори|north|\bup\b|top|upper/i, south: /півд|низ|нижн|донизу|south|down|bottom|lower/i,
  east: /схід|східн|прав|east|right/i, west: /захід|західн|лів|west|left/i,
  fwd: /вперед|прямо|forward|ahead/i, back: /назад|back/i,
  step: /крок|клітин|step|tile/i, wall: /стін|упор|wall/i,
  door: /двер|door/i, attack: /атак|вбий|убий|бий|руби|kill|attack|fight|\bhit\b|скелет|вампір|чаклун|маг|кусак|демон|мімік|skeleton|vampire|mage|chomper|demon|mimic/i,
  chest: /скрин|chest/i, pick: /підбер|підніми|збер|візьми|забери|collect|pick|take|grab/i,
  equip: /одягни|одягн|вдягни|вдягн|надінь|озбро|equip|wear|wield|put on/i, drink: /випий|пий|drink/i,
  drop: /викинь|кинь|drop|throw/i, flee: /тікай|втікай|біжи|відступ|flee|run away|retreat/i,
  room: /кімнат|room/i, all: /(^|\s)(все|усе|всі|усі)(\s|$)|everything|\ball\b/i,
  stop: /стоп|чекай|стій|зупин|stop|wait|halt/i, stairs: /сходи|сходах|драбин|вихід|спуст|stairs|exit|descend/i, lever: /важ[іе]л|смикн|потягн|lever|pull/i, look: /огляд|оглянь|озирн|look/i,
  explore: /досліди|обшукай|explore|search/i,
};
const ITEM_RX = [
  [/компас|compass/i, ['compass']], [/ключ|\bkey/i, ['key_white', 'key_yellow', 'key_blue']],
  [/синій|синя|blue/i, ['sword_blue']], [/золот|gold/i, ['sword_gold']], [/червон|red/i, ['sword_red']], [/біл|white/i, ['sword_white']],
  [/меч|sword/i, ['sword_white', 'sword_blue', 'sword_gold', 'sword_red']], [/шолом|helmet/i, ['helmet']], [/чобот|чоботи|boots/i, ['boots']],
  [/рукавиц|gloves/i, ['gloves']], [/обладун|броню|armor|armour/i, ['armor']], [/перстен|кільц|\bring/i, ['ring_str', 'ring_agi', 'ring_sta', 'ring_luck', 'ring_spi']],
  [/щит|shield/i, ['potion_shield']], [/зілл|лікув|potion|heal/i, ['potion_heal', 'potion_shield']],
];
const NUM = { 'один': 1, 'одну': 1, 'раз': 1, 'два': 2, 'дві': 2, 'три': 3, 'чотири': 4, "п'ять": 5, 'п’ять': 5, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
function itemIdsIn(t) { const ids = []; for (const [rx, list] of ITEM_RX) if (rx.test(t)) { ids.push(...list); if (list.length === 1) break; } return ids; }
function dirIn(t, lastDir) {
  for (const d of DIRS4) if (RX[d].test(t)) return d;
  if (RX.fwd.test(t)) return lastDir;
  return null;
}
function parsePart(game, t, first) {
  const h = game.hero, room = h.room;
  if (RX.stop.test(t)) return 'stop';
  if (RX.lever.test(t)) return 'pull_lever';
  if (RX.stairs.test(t)) return 'take_stairs';
  if (RX.flee.test(t) || (RX.back.test(t) && !RX.step.test(t) && !RX.room.test(t))) return 'go_back';
  if (RX.drink.test(t)) return /щит|shield|син|blue/i.test(t) ? 'drink_shield' : 'drink_potion';
  const ids = itemIdsIn(t);
  if (RX.equip.test(t)) { const it = h.inv.find(i => i && def(i).slot && (!ids.length || ids.includes(i.id))); return it ? 'equip_' + it.uid : null; }
  if (RX.drop.test(t)) { const it = h.inv.find(i => i && (!ids.length || ids.includes(i.id))); return it ? 'drop_' + it.uid : null; }
  if (RX.pick.test(t)) {
    if (RX.all.test(t)) return 'pick_up_all';
    if (ids.length && ids.every(i => i.startsWith('potion'))) return 'find_and_take_potion';
    if (first && ids.length) { const e = game.itemsIn(room).find(e => ids.includes(e.item.id)); if (e) return 'pick_up_' + e.id; }
    return 'pick_up_nearest';
  }
  if (RX.chest.test(t)) return 'open_nearest_chest';
  if (RX.attack.test(t)) return 'kill_nearest';
  const dir = dirIn(t, h.lastDir) || (RX.back.test(t) ? { north: 'south', south: 'north', east: 'west', west: 'east' }[h.lastDir] : null);
  if (dir) {
    const num = (/(\d+)/.exec(t) || [])[1] || Object.entries(NUM).find(([w]) => new RegExp('(^|\\s)' + w + '(\\s|$)', 'i').test(t))?.[1];
    if (RX.wall.test(t)) return `move_${dir}_wall`;
    if (RX.step.test(t) || (num && !RX.room.test(t))) return `move_${dir}_${Math.min(MAXK, Math.max(1, +num || 1))}`;
    return 'go_to_room_' + D1[dir];
  }
  if (RX.room.test(t) && RX.look.test(t) || RX.explore.test(t)) return 'explore_room';
  if (RX.look.test(t)) return 'look_around';
  return null;
}
export function keywordInterpret(game, text) {
  const parts = splitCommand(text);
  const steps = [];
  parts.forEach((p, i) => { const l = parsePart(game, p, i === 0); if (l) steps.push(l); });
  return { steps: steps.slice(0, 3), source: t('kw.source'), notUnderstood: !steps.length };
}
