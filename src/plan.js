// Plan from a voice command: action selection (noul) and order (score). Pure logic, no network.
// Order: the command is split into parts in code, and the score asks "which part of the command asks for this action".
// TypeSafe score levels are judged independently and should describe concrete situations,
// so the levels are the command parts themselves, not abstract "first / last".
import { getLang } from './i18n.js';
const W = s => `(?<!\\p{L})(?:${s})(?!\\p{L})`;
const CONNECT = {
  uk: 'а потім|і потім|й потім|потім|затим|після цього|далі|і|й|та',
  en: 'and then|after that|then|and',
};
const splitRx = l => new RegExp(`\\s*(?:[,;.]|${W(CONNECT[l] || CONNECT.uk)})\\s*`, 'iu');
export function splitCommand(text, lang = getLang()) {
  const parts = String(text).split(splitRx(lang)).map(s => s.trim()).filter(s => s.length > 1);
  return parts.length ? parts.slice(0, 6) : [String(text)];
}
const DIR = {
  uk: { N: 'верхню (північну)', S: 'нижню (південну)', E: 'праву (східну)', W: 'ліву (західну)' },
  en: { N: 'upper / north', S: 'lower / south', E: 'right / east', W: 'left / west' },
};
const DIRM = {
  uk: { north: 'вгору (на північ)', south: 'вниз (на південь)', east: 'праворуч (на схід)', west: 'ліворуч (на захід)' },
  en: { north: 'up / north', south: 'down / south', east: 'right / east', west: 'left / west' },
};
const DESC = {
  uk: {
    go_back: 'повернутися назад, у попередню кімнату, втекти', kill_nearest: 'атакувати й убити ворога', open_nearest_chest: 'відкрити скриню',
    pick_up_nearest: 'підібрати предмет з підлоги', pick_up_all: 'зібрати все, що лежить на підлозі', find_and_take_potion: 'знайти й підібрати зілля з підлоги',
    drink_potion: 'випити червоне зілля лікування', drink_shield: 'випити синє зілля щита', take_stairs: 'стати на сходи (спуск або вихід)', go_downstairs: 'спуститися сходами на наступний поверх', pull_lever: 'потягнути важіль',
    explore_room: 'оглянути, обійти кімнату', look_around: 'озирнутися на місці', wait: 'почекати, перечекати якийсь час (чекай)',
    stop: 'зупинитися й стояти (стоп, зупинись, стій)',
  },
  en: {
    go_back: 'go back to the previous room, retreat', kill_nearest: 'attack and kill the enemy', open_nearest_chest: 'open the chest',
    pick_up_nearest: 'pick up an item from the floor', pick_up_all: 'collect everything on the floor', find_and_take_potion: 'find and pick up a potion from the floor',
    drink_potion: 'drink the red healing potion', drink_shield: 'drink the blue shield potion', take_stairs: 'take the stairs (down or exit)', go_downstairs: 'go down the stairs to the next floor', pull_lever: 'pull the lever',
    explore_room: 'explore the room, walk around it', look_around: 'look around on the spot', wait: 'wait for a while',
    stop: 'stop and stand still (stop, halt, stand)',
  },
};
// short descriptions in the selected language (Ukrainian + English for robustness)
export function planDesc(id, desc, lang = getLang()) {
  const en = enDesc(id, desc);
  if (lang === 'en') return en;
  let m, uk = null;
  if ((m = /^go_to_room_([NSEW])$/.exec(id))) uk = `йти у ${DIR.uk[m[1]]} сусідню кімнату через двері`;
  else if ((m = /^move_(\w+)_(\d+)$/.exec(id))) uk = `зробити рівно ${m[2]} крок(и) ${DIRM.uk[m[1]]}, лише якщо в команді назване число кроків`;
  else if ((m = /^move_(\w+)_wall$/.exec(id))) uk = `йти ${DIRM.uk[m[1]]} до самої стіни`;
  else uk = DESC.uk[id] || null;
  return uk ? `${uk} / ${en}` : en;
}
function enDesc(id, desc) {
  let m;
  if ((m = /^go_to_room_([NSEW])$/.exec(id))) return `go to the ${DIR.en[m[1]]} neighbouring room through the door`;
  if ((m = /^move_(\w+)_(\d+)$/.exec(id))) return `take exactly ${m[2]} step(s) ${DIRM.en[m[1]]}, only if the command names a number of steps`;
  if ((m = /^move_(\w+)_wall$/.exec(id))) return `walk ${DIRM.en[m[1]]} all the way to the wall`;
  return DESC.en[id] || String(desc).replace(/^MACRO:\s*/, '');
}
const Q = {
  uk: {
    ask: 'Чи просить гравець у `human_command` героя зробити цю дію (одразу чи пізніше в тій самій команді)? / Does the player in `human_command` ask the hero to do this action (now or later in the same command)?',
    ord: 'Яка частина команди `command_parts` просить героя зробити цю дію? / Which part of `command_parts` asks the hero to do this action?',
    part: (i, p) => `Частина ${i} команди: «${p}» / Part ${i} of the command: "${p}"`,
  },
  en: {
    ask: 'Does the player in `human_command` ask the hero to do this action (now or later in the same command)?',
    ord: 'Which part of `command_parts` asks the hero to do this action?',
    part: (i, p) => `Part ${i} of the command: "${p}"`,
  },
};
export const SAME = [['stop', 'wait']]; // synonyms: keep the more confident one
// per action: noul "does the player ask for it" + (if more than one part) score "which part of the command asks for it"
export function buildPlanQuestions(actions, parts = [], lang = getLang()) {
  const L = Q[lang] || Q.uk, q = {};
  const levels = parts.map((p, i) => L.part(i + 1, p));
  for (const [id, desc] of Object.entries(actions)) {
    const d = planDesc(id, desc, lang);
    q['ask__' + id] = { type: 'noul', instructions: { question: L.ask, action: d } };
    if (levels.length > 1) q['ord__' + id] = { type: 'score', instructions: { question: L.ord, action: d }, criteria: levels };
  }
  return q;
}
// noul > threshold, at most max, order by score (lower = earlier), ties by noul
export function selectPlan(answers, actions, { threshold = 0.5, max = 5 } = {}) {
  let cand = [];
  for (const id of Object.keys(actions)) {
    const p = answers?.['ask__' + id]?.noul;
    if (typeof p !== 'number' || !(p > threshold)) continue;
    const s = answers?.['ord__' + id]?.score;
    cand.push({ label: id, p, score: typeof s === 'number' ? s : 0 });
  }
  for (const grp of SAME) {
    const g = cand.filter(c => grp.includes(c.label)).sort((a, b) => b.p - a.p);
    if (g.length > 1) cand = cand.filter(c => !g.slice(1).includes(c));
  }
  cand.sort((a, b) => b.p - a.p);
  const top = cand.slice(0, max);
  top.sort((a, b) => a.score - b.score || b.p - a.p);
  return top;
}
// command generation counter: stale JEV answers are discarded
export function makeCommandGate() {
  let gen = 0;
  return { begin: () => ++gen, isCurrent: id => id === gen };
}