import { t } from './i18n.js';
// Items, equipment, hero stats and loot tables. Pure logic.
export const ITEMS = {
  sword_white: { en: 'white sword', slot: 'weapon', str: 1, rarity: 0 },
  sword_blue: { en: 'blue sword', slot: 'weapon', str: 2, rarity: 1 },
  sword_gold: { en: 'gold sword', slot: 'weapon', str: 3, rarity: 2 },
  sword_red: { en: 'red sword', slot: 'weapon', str: 4, rarity: 3 },
  helmet: { en: 'helmet', slot: 'head', def: 2, rarity: 2 },
  boots: { en: 'boots', slot: 'feet', def: 1, rarity: 1 },
  gloves: { en: 'gloves', slot: 'hands', def: 1, rarity: 1 },
  armor: { en: 'body armor', slot: 'body', def: 3, rarity: 3 },
  potion_heal: { en: 'healing potion', use: 'heal', rarity: 0 },
  potion_shield: { en: 'shield potion', use: 'shield', rarity: 1 },
  ring_str: { en: 'ring of strength', ring: 'str', rarity: 2 },
  ring_agi: { en: 'ring of agility', ring: 'agi', rarity: 2 },
  ring_sta: { en: 'ring of stamina', ring: 'sta', rarity: 2 },
  ring_luck: { en: 'ring of luck', ring: 'luck', rarity: 2 },
  ring_spi: { en: 'ring of spirit', ring: 'spi', rarity: 2 },
  key: { en: 'key', rarity: 0 },
  key_white: { en: 'white key', key: 'white', rarity: 0 },
  key_yellow: { en: 'yellow key', key: 'yellow', rarity: 0 },
  key_blue: { en: 'blue key', key: 'blue', rarity: 0 },
  compass: { en: 'compass (points to the nearest key)', artifact: 'compass', rarity: 0 },
};
export const SLOTS = ['weapon', 'head', 'body', 'hands', 'feet'];
export const INV_SIZE = 9;
export const HEAL = 5, SHIELD_AMT = 6, SHIELD_TIME = 30;

let uidN = 0;
export const makeItem = id => ({ uid: 'it' + (++uidN), id });
export const def = it => ITEMS[it.id];
export const bonusOf = it => { const d = def(it); return d.slot === 'weapon' ? d.str : d.def || 0; };
// localized names come from i18n
for (const id of Object.keys(ITEMS)) Object.defineProperty(ITEMS[id], 'name', { get: () => t('item.' + id), enumerable: true });
export const SLOT_NAME = new Proxy({}, { get: (_, k) => t('slot.' + String(k)) });
export const STAT_NAME = new Proxy({}, { get: (_, k) => t('stat.' + String(k)) });
export function describeItem(it) {
  const d = def(it);
  if (d.slot === 'weapon') return t('desc.weapon', { name: d.name, n: d.str });
  if (d.slot) return t('desc.armor', { name: d.name, n: d.def });
  if (d.ring) return t('desc.ring', { name: d.name, stat: t('stat.' + d.ring) });
  if (d.use === 'heal') return t('desc.heal', { name: d.name, n: HEAL });
  if (d.use === 'shield') return t('desc.shield', { name: d.name, n: SHIELD_AMT, s: SHIELD_TIME });
  return d.name;
}
// value for deciding what to drop when the backpack is full
export const valueOf = it => /^key|^compass/.test(it.id) ? 100 : (def(it).rarity * 10 + (def(it).use ? 4 : 0) + bonusOf(it));

// Formulas: damage = Strength (+sword), crit = Luck % (x2), dodge per Agility,
//  max HP = 10 + 5 * Stamina, regen = 0.15 HP/s per Spirit
export function heroStats(h) {
  const s = { ...h.base };
  for (const it of h.inv) if (it && def(it).ring) s[def(it).ring]++;
  const weapon = h.equip.weapon ? def(h.equip.weapon).str : 0;
  let armor = 0; for (const k of SLOTS) if (k !== 'weapon' && h.equip[k]) armor += def(h.equip[k]).def;
  return {
    ...s, dmg: s.str + weapon, weapon, armor,
    maxHp: 10 + 5 * s.sta, dodge: Math.min(0.4, 0.05 * s.agi), crit: s.luck / 100,
    regen: 0.15 * s.spi, reduce: Math.min(0.6, armor * 0.1),
  };
}

// Loot: weight grows with room depth (0..1) and luck for rare items
const TABLE = [['potion_heal', 40], ['potion_shield', 18], ['gold', 30], ['sword_blue', 8], ['sword_gold', 4], ['sword_red', 1.5],
  ['boots', 7], ['gloves', 7], ['helmet', 4], ['armor', 2.5], ['ring_str', 0.8], ['ring_agi', 0.8], ['ring_sta', 0.8], ['ring_luck', 0.8], ['ring_spi', 0.8]];
export function rollLoot(R, depth = 0, luck = 0, table = TABLE) {
  const ws = table.map(([id, w]) => { const r = id === 'gold' || id === 'empty' ? 0 : ITEMS[id].rarity; return [id, w * (1 + (depth * 1.5 + luck * 0.15) * r)]; });
  let t = R() * ws.reduce((a, [, w]) => a + w, 0);
  for (const [id, w] of ws) { if ((t -= w) <= 0) return id; }
  return 'potion_heal';
}
