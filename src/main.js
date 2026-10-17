import { Game } from './game.js';
import { t, getLang, setLang, onLang, speechLang, LANGS } from './i18n.js';
import { ITEMS, SLOTS, describeItem } from './items.js';
import { itemIcon } from './assets.js';
import { Renderer } from './render.js';
import { loadImages } from './assets.js';
import { audio } from './audio.js';
import { initSpeech } from './speech.js';
import { KEY_RGB } from './render.js';
import { roomActions, genericActions, describeState, keywordInterpret, sayFor } from './agent.js';
import { jevInterpret } from './jev.js';
import { pickHuh } from './huh.js';

const $ = id => document.getElementById(id);
const settings = {
  get key() { return localStorage.getItem('jev_key') || ''; },
  get proxy() { return localStorage.getItem('jev_proxy') !== '0'; },
};
// Debug flags from the URL (presence only): ?near ?god ?compass, combinable (?near&god); ?test = all of them
const QS = new URLSearchParams(location.search), DEBUG_FLAGS = ['near', 'god', 'compass'].filter(f => QS.has(f) || QS.has('test'));
const DEBUG = Object.fromEntries(DEBUG_FLAGS.map(f => [f, true]));
const game = new Game({ ...DEBUG });
if (DEBUG_FLAGS.length) { const b = document.createElement('div'); b.id = 'debugBadge'; b.textContent = '🧪 ' + DEBUG_FLAGS.join(' · '); b.title = 'debug flags (URL)'; b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;background:#5a1a1a;color:#ffd;border:1px solid #c66;border-radius:6px;padding:2px 8px;font:12px monospace;pointer-events:none;opacity:.9'; document.body.append(b); }
let running = false, started = false, renderer, busy = false, totalCost = 0, calls = 0;

function log(html, cls = '') {
  const el = document.createElement('div'); el.className = 'entry ' + cls; el.innerHTML = html;
  $('log').prepend(el); while ($('log').children.length > 80) $('log').lastChild.remove();
}
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clock = () => new Date().toLocaleTimeString('ru-RU');
const say = (...a) => renderer && renderer.say(...a);
const think = (text, emote, secs = 3) => renderer && renderer.say(text, emote, secs, true);

// JEV is called ONLY here, when a voice command arrives
const huhRecent = []; // last 3 'didn't understand' phrases (no repeats)
let gen = 0; // command generation: answers to older commands are discarded
async function onCommand(text) {
  if (game.hero.dead || game.hero.won) return;
  if (!running) { log(t('log.pausedCmd', { text: esc(text) })); return; }
  const my = ++gen;
  if (game.abortPlan()) log(t('log.aborted'), 'refuse');
  game.noteCommand(); game.hold = true; // a human command always interrupts autonomy
  busy = true; $('thinking').hidden = false;
  try {
    let res = null;
    if (settings.key) {
      try {
        res = await jevInterpret({ key: settings.key, useProxy: settings.proxy, state: describeState(game, text), roomActs: roomActions(game), generic: genericActions() });
        calls++; totalCost += res.cost || 0;
      } catch (e) { log(t('log.jevErr', { msg: esc(e.message) }), 'err'); }
    }
    if (my !== gen) { log(t('log.stale', { text: esc(text) })); return; }
    if (!res) res = keywordInterpret(game, text);
    if (!running) { log(t('log.pausedAns')); return; }
    const cost = res.cost != null ? ` · $${res.cost.toFixed(6)}` : '';
    const steps = !res.steps.length ? `<b>${t('log.notUnderstood')}</b>` : res.plan
      ? res.plan.map((s, i) => `${i + 1}. ${esc(s.label)} <span class="t">(${(s.p * 100).toFixed(0)}%, ${t('log.queue')} ${s.score.toFixed(1)})</span>`).join('<br>')
      : res.steps.map((l, i) => `${i + 1}. ${esc(l)}`).join('<br>');
    log(`<span class="t">${clock()}</span> 🎤 «${esc(text)}»<br>${res.source === 'JEV' ? '<span title="JEV">\uD83E\uDDE0</span> ' : ''}<b>${res.source}</b>${cost}:<br>${steps}`, res.steps.length ? '' : 'refuse');
    if (!res.steps.length) { game.unclear(); audio.play('error', 0.3); const huh = pickHuh(res.huhKind, { recent: huhRecent }); log(t('log.huh', { text: esc(huh) }) + (res.huhKind ? ` <span class="t">(${res.huhKind})</span>` : ''), 'auto'); say(huh, 'question', 3.5); return; }
    game.setQueue(res.steps);
    if (res.steps.length > 1) say(res.steps.map((l, i) => `${i + 1}. ${sayFor(game, l).replace(/[!:…]+$/, '')}`).join(' '), 'idea', 4);
  } finally { if (my === gen) { busy = false; game.hold = false; $('thinking').hidden = true; } updateHud(); }
}

const tr = (pre, k) => { const v = t(pre + k); return v === pre + k ? undefined : v; };
const CANT = new Proxy({}, { get: (_, k) => typeof k === 'string' ? tr('cant.', k) : undefined });
const FAIL = new Proxy({}, { get: (_, k) => typeof k === 'string' ? tr('fail.', k) : undefined });
let invSig = '';
function cellHtml(it, emptyTitle, where) {
  if (!it) return `<div class="cell" title="${emptyTitle}"></div>`;
  return `<div class="cell full" data-uid="${it.uid}" data-where="${where}" title="${esc(describeItem(it))}\n${t('cell.tip')}"><img src="${encodeURI(itemIcon(it.id))}"></div>`;
}
function updateHud() {
  const h = game.hero, s = game.stats();
  $('hp').innerHTML = `❤ ${Math.ceil(h.hp)}/${s.maxHp}${h.shield > 0 ? ` <span style="color:#7bf">🛡 ${h.shield}</span>` : ''}<div class="bar"><i style="width:${100 * h.hp / s.maxHp}%"></i></div>`;
  $('stats').innerHTML = [
    [t('stat.str'), s.str, t('st.dmg', { n: s.dmg })], [t('stat.agi'), s.agi, t('st.dodge', { n: Math.round(s.dodge * 100) })], [t('stat.sta'), s.sta, `HP ${s.maxHp}`],
    [t('stat.luck'), s.luck, t('st.crit', { n: Math.round(s.crit * 100) })], [t('stat.spi'), s.spi, t('st.regen', { n: s.regen.toFixed(2) })], [t('st.def'), s.armor, t('st.reduce', { n: Math.round(s.reduce * 100) })],
  ].map(([n, v, x]) => `<div><b>${n}</b> ${v} <span>${x}</span></div>`).join('');
  const sig = JSON.stringify([h.inv.map(i => i && i.uid), SLOTS.map(k => h.equip[k] && h.equip[k].uid)]);
  if (sig !== invSig) {
    invSig = sig;
    $('equip').innerHTML = SLOTS.map(k => cellHtml(h.equip[k], t('cell.slotEmpty', { slot: t('slot.' + k) }), 'eq')).join('');
    $('invgrid').innerHTML = h.inv.map(it => cellHtml(it, t('cell.empty'), 'inv')).join('');
  }
  $('inv').innerHTML = `🏰 ${t('hud.floor', { n: game.m.label })} · 🪙 ${h.gold} · 🔑 ` + ['white', 'yellow', 'blue'].map(c => `<span style="color:${KEY_RGB[c]}">■</span>${h.keysOf(c)}`).join(' ') + (game.findItem('compass') ? ' · 🧭' : '');
  $('rooms').textContent = t('hud.rooms', { a: h.visited.size, b: game.m.rooms.length });
  $('goal').textContent = t('hud.doing') + (game.goal ? game.goal.label : '—') + (game.queue.length ? ' → ' + game.queue.join(' → ') : '');
  $('cost').textContent = settings.key ? t('hud.cost', { n: calls, c: totalCost.toFixed(5) }) : t('hud.nokey');
}

game.on((type, d) => {
  switch (type) {
    case 'step': audio.play('step', 0.15); break;
    case 'doorOpen': audio.play('door', 0.5); break;
    case 'unlock': audio.play('unlock', 0.6); say(t('say.unlock'), 'exclamation', 2); log(d.color ? t('log.unlockC', { color: t('color.' + d.color) }) : t('log.unlock')); break;
    case 'lever': audio.play('unlock', 0.7); say(t('say.lever'), 'exclamation', 2.5); log(t('log.lever')); break;
    case 'floor': audio.play('win', 0.4); say(t('say.floor', { n: d.label }), 'exclamation', 3); log(t('log.floor', { n: d.label }), 'ask'); if (renderer) renderer.cam.follow = true; invSig = ''; updateHud(); break;
    case 'keyDrop': log(t('log.keyDrop', { name: esc(ITEMS[d.item]?.name || '') })); break;
    case 'hit': audio.play('hit', 0.4); if (!d.dmg) say(t('say.noSword'), 'cross', 2); else if (d.crit) say(t('say.crit'), 'stars', 1); break;
    case 'burn': audio.play('hurt', 0.7); say(t('say.burn'), 'anger', 3); log(t('log.burn'), 'err'); break;
    case 'heroHurt': audio.play('hurt', 0.4); if (d.src === 'spikes') say(t('say.spikes'), 'anger', 1.5); else if (d.src === 'bolt') say(t('say.bolt'), 'anger', 1.5); break;
    case 'cast': audio.play('swing', 0.25); break;
    case 'chompIn': say(t('say.chomp'), 'exclamation', 2); break;
    case 'pickup': audio.play(d.item === 'gold' ? 'coin' : 'pickup', 0.5); say((d.item && ITEMS[d.item] ? ITEMS[d.item].name : t('say.got')) + '!', 'cash', 2); log(t('log.pickup', { name: esc(ITEMS[d.item]?.name || d.name) })); break;
    case 'gold': audio.play('coin', 0.5); log(t('log.gold', { n: d.n })); break;
    case 'drink': audio.play('drink', 0.6); log(t('log.drink', { name: esc(ITEMS[d.item].name) })); break;
    case 'equip': log(d.old ? t('log.equipOld', { name: esc(ITEMS[d.item.id].name), old: esc(ITEMS[d.old.id].name) }) : t('log.equip', { name: esc(ITEMS[d.item.id].name) })); break;
    case 'dropped': log(t('log.dropped', { name: esc(ITEMS[d.item.id].name) })); break;
    case 'leftItem': log(t('log.leftItem', { name: esc(ITEMS[d.item.id].name) })); say(t('say.full'), 'cross', 2); break;
    case 'spill': log(t('log.spill', { items: d.items.map(i => esc(ITEMS[i.id].name)).join(', ') })); say(t('say.spill'), 'cash', 2.5); break;
    case 'chestEmpty': say(t('say.empty'), 'faceSad', 2); log(t('log.chestEmpty')); break;
    case 'dodge': say(t('say.dodge'), 'exclamation', 1); break;
    case 'blocked': say(t('say.armor'), null, 1); break;
    case 'shieldGone': log(t('log.shieldGone')); break;
    case 'mimic': audio.play('hurt', 0.6); say(t('say.mimic'), 'exclamation', 2.5); log(t('log.mimic')); break;
    case 'selfDefense': say(t('say.defend'), 'anger', 1.5); break;
    case 'monsterDead': log(d.type === 'boss' ? t('log.bossDead') : t('log.monDead', { name: t('mon.' + d.type) })); if (d.type === 'boss') say(t('say.bossDead'), 'stars', 3); break;
    case 'enterRoom':
      if (d.monsters && !d.intent) { say(t('say.ambush'), 'exclamation', 2); log(t('log.ambush')); }
      else if (d.first) { const rt = t('roomThoughts'); think(rt[Math.floor(Math.random() * rt.length)], 'question', 2.5); }
      break;
    case 'goal': { const l = d.goal.label; say(sayFor(game, l), null, 2); log(`▶ ${esc(sayFor(game, l))} <span class="t">(${esc(l)})</span>`); if (l.startsWith('attack')) audio.play('swing', 0.4); break; }
    case 'cantDo': audio.play('error', 0.3); say(CANT[d.error] || t('say.cant'), 'cross', 2.5); log(t('log.cant', { label: esc(d.label), why: CANT[d.error] || d.error }), 'refuse'); break;
    case 'goalFail': audio.play('error', 0.3); say(FAIL[d.reason] || CANT[d.reason] || t('say.failed'), 'cross', 2.5); log(t('log.failed', { label: esc(d.goal?.label || ''), why: d.reason ? ' (' + esc(FAIL[d.reason] || CANT[d.reason] || d.reason) + ')' : '' }), 'refuse'); break;
    case 'askWhat': setTimeout(() => { if (!game.goal && !game.queue.length && !game.hero.dead && !game.hero.won) { say(t('say.what'), 'question', 4); log(t('log.ask'), 'ask'); } }, 900); break;
    case 'think': if (d.key != null) { const th = t('thoughts'); think(th[d.key % th.length], null, 3); } else if (d.text) think(d.text, null, 3); else say('', d.emote, 1.5); break;
    case 'curious': {
      const n = ITEMS[d.item]?.name.toLowerCase() || '';
      const st = { pick: t('say.curPick'), equip: t('say.curEquip'), drink: t('say.curDrink') }[d.what];
      say(st, 'idea', 2.5); log(t('log.curious', { what: t(d.what === 'pick' ? 'log.curPick' : d.what === 'equip' ? 'log.curEquip' : 'log.curDrink'), name: esc(n) })); break;
    }
    case 'auto': {
      const p = { mon: t('mon.' + d.mon), item: esc((ITEMS[d.item]?.name || '').toLowerCase()), dir: t('dir.' + d.dir), why: t('autoLog.why.' + d.why) };
      say(t('auto.' + d.kind, p), d.kind === 'flee' ? 'exclamation' : d.kind === 'explore' ? 'question' : 'idea', 2.5);
      log(`<span class="t">${clock()}</span> <span title="auto">\uD83E\uDDD2</span> ${t('autoLog.' + d.kind, p)}`, 'auto'); break;
    }
    case 'heroDead': audio.play('death', 0.6); showEnd(t('end.dead')); break;
    case 'win': audio.play('win', 0.6); showEnd(t('end.win')); break;
  }
  if (['heroHurt', 'pickup', 'drink', 'unlock', 'goal', 'inv', 'equip', 'dropped', 'gold'].includes(type)) updateHud();
});

function showEnd(text) { $('endText').textContent = text; $('end').hidden = false; }
function newGame() {
  $('end').hidden = true; game.reset({ ...DEBUG }); $('log').innerHTML = '';
  setRunning(false); started = false; setRunLabel();
  updateHud(); log(t('log.newGame')); if (DEBUG_FLAGS.length) log(t('log.debug', { flags: DEBUG_FLAGS.join(', ') }), 'ask');
}
// --- start / pause: while not running, the simulation is frozen and JEV is not called ---
function setRunLabel() {
  $('btnRun').textContent = t(running ? 'ui.pause' : started ? 'ui.resume' : 'ui.start');
  $('state').textContent = t(running ? 'ui.stRun' : started ? 'ui.stPause' : 'ui.stWait');
  $('state').className = running ? 'run' : 'pause';
}
function setRunning(on, why = '') {
  if (on && (game.hero.dead || game.hero.won)) return;
  if (on === running) return;
  running = on;
  if (on) { const first = !started; started = true; log(t(first ? 'log.start' : 'log.resume')); if (first) game.next(); }
  else if (started) log(t('log.pause') + (why ? ' (' + why + ')' : ''));
  setRunLabel();
}
$('btnRun').onclick = () => { $('btnRun').blur(); setRunning(!running); };
addEventListener('keydown', e => {
  const t = document.activeElement;
  if (e.code !== 'KeyP' || e.repeat || (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  setRunning(!running);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && running) setRunning(false, t('log.tabHidden')); });
// clicking a cell only shows the description; actions are voice-only
function showInfo(e) {
  const c = e.target.closest('.cell.full'); if (!c) { $('itemInfo').hidden = true; return; }
  const h = game.hero, it = [...h.inv, ...SLOTS.map(k => h.equip[k])].find(i => i && i.uid === c.dataset.uid); if (!it) return;
  const d = ITEMS[it.id];
  const what = t(d.slot ? (c.dataset.where === 'eq' ? 'info.equipped' : 'info.inBag') : d.ring ? 'info.ring' : d.use ? 'info.use' : d.artifact ? 'info.compass' : 'info.key');
  $('itemInfo').innerHTML = `<img src="${encodeURI(itemIcon(it.id))}"><div><b>${esc(d.name)}</b> <i>(${t('rarity')[d.rarity] || ''})</i><br>${esc(describeItem(it))}<br><span>${what}</span></div>`;
  $('itemInfo').hidden = false;
}
$('invgrid').addEventListener('click', showInfo);
$('equip').addEventListener('click', showInfo);

// --- settings (left panel) ---
$('keyInput').value = settings.key; $('proxyChk').checked = settings.proxy;
$('keyInput').addEventListener('change', () => { localStorage.setItem('jev_key', $('keyInput').value.trim()); updateHud(); });
$('keyInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('keyInput').blur(); });
$('proxyChk').addEventListener('change', () => { localStorage.setItem('jev_proxy', $('proxyChk').checked ? '1' : '0'); $('proxyChk').blur(); });
const musicLabel = () => { $('btnMusic').textContent = t(audio.musicOn ? 'ui.musicOn' : 'ui.musicOff'); };
$('btnMusic').onclick = () => { audio.toggleMusic(); musicLabel(); $('btnMusic').blur(); };
const sfxLabel = () => { $('btnSfx').textContent = t(audio.sfx ? 'ui.sfxOn' : 'ui.sfxOff'); };
sfxLabel();
// music: if it was on before, start it after the first user gesture (autoplay is blocked)
if (localStorage.getItem('music_on') === '1') { const go = () => { removeEventListener('pointerdown', go); removeEventListener('keydown', go); if (!audio.musicOn) { audio.toggleMusic(); musicLabel(); } }; addEventListener('pointerdown', go); addEventListener('keydown', go); }
$('btnSfx').onclick = () => { audio.sfx = !audio.sfx; localStorage.setItem('sfx_on', audio.sfx ? '1' : '0'); sfxLabel(); $('btnSfx').blur(); };
// language: static texts via data-i18n, dynamic labels re-rendered
function applyLang() {
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const b of document.querySelectorAll('.langbtn')) b.classList.toggle('active', b.dataset.lang === getLang());
  sfxLabel(); musicLabel(); setRunLabel(); invSig = ''; updateHud();
  if (!$('status').classList.contains('on')) $('status').textContent = t('sp.idle');
}
for (const b of document.querySelectorAll('.langbtn')) b.addEventListener('click', () => { setLang(b.dataset.lang); b.blur(); });
onLang(applyLang); applyLang();
$('btnNew').onclick = () => { $('btnNew').blur(); newGame(); };
$('btnAgain').onclick = () => newGame();
// buttons must not capture Space
for (const b of document.querySelectorAll('button')) b.addEventListener('keydown', e => { if (e.code === 'Space') e.preventDefault(); });

initSpeech({
  statusEl: $('status'), finalEl: $('final'), interimEl: $('interim'), langEl: { get value() { return speechLang(); } },
  onCommand: text => { $('itemInfo').hidden = true; onCommand(text); },
});

loadImages().then(imgs => {
  renderer = new Renderer($('view'), imgs);
  newGame();
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (running) game.update(dt); moveCamera(dt); renderer.draw(game);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setInterval(updateHud, 500);
  initCamera();
});

// --- camera: wheel/Q/E zoom, WASD/drag pan, F follows the hero ---
const held = new Set();
const typingNow = () => { const t = document.activeElement; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); };
function moveCamera(dt) {
  if (!renderer) return;
  const sp = 500 / renderer.cam.zoom * (window.devicePixelRatio || 1); // ~500 CSS px/s
  let dx = 0, dy = 0;
  if (held.has('KeyA')) dx -= 1; if (held.has('KeyD')) dx += 1; if (held.has('KeyW')) dy -= 1; if (held.has('KeyS')) dy += 1;
  if (dx || dy) renderer.panWorld(dx * sp * dt, dy * sp * dt);
  const z = (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0);
  if (z) renderer.zoomAt(Math.pow(2.2, z * dt));
}
function initCamera() {
  const cv = $('view');
  addEventListener('keydown', e => {
    if (typingNow() || e.ctrlKey || e.altKey || e.metaKey) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) { held.add(e.code); e.preventDefault(); }
    if (e.code === 'KeyF' && !e.repeat) renderer.cam.follow = true;
    if (e.code === 'KeyM' && !e.repeat) renderer.miniOn = !renderer.miniOn;
  });
  addEventListener('keyup', e => held.delete(e.code));
  addEventListener('blur', () => held.clear());
  cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); renderer.zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null;
  cv.addEventListener('mousedown', e => { const r = cv.getBoundingClientRect(); if (e.button === 0 && renderer.miniClick(e.clientX - r.left, e.clientY - r.top)) return; if (e.button === 0) { drag = [e.clientX, e.clientY]; cv.style.cursor = 'grabbing'; } });
  addEventListener('mousemove', e => { if (!drag) return; renderer.pan(e.clientX - drag[0], e.clientY - drag[1]); drag = [e.clientX, e.clientY]; });
  addEventListener('mouseup', () => { drag = null; cv.style.cursor = ''; });
}
