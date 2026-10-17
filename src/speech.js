import { t } from './i18n.js';
// Web Speech push-to-talk: hold Space to record, release to send.
export function initSpeech({ statusEl, finalEl, interimEl, langEl, onCommand }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const IDLE = () => t('sp.idle');
  if (!SR) { statusEl.textContent = t('sp.nosupport'); return; }
  const r = new SR(); r.continuous = true; r.interimResults = true;
  let active = false;
  r.onresult = e => { if (!active) return; let f = '', i = ''; for (const res of e.results) { (res.isFinal ? (f += res[0].transcript) : (i += res[0].transcript)); } finalEl.textContent = f; interimEl.textContent = i; };
  r.onerror = e => { if (e.error === 'aborted') return; statusEl.textContent = t('sp.error') + e.error; };
  r.onend = () => { active = false; statusEl.classList.remove('on'); statusEl.textContent = IDLE(); };
  const typing = () => { const t = document.activeElement; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); };
  addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || typing()) return; e.preventDefault(); if (active) return;
    r.lang = langEl.value; finalEl.textContent = ''; interimEl.textContent = '';
    try { r.start(); active = true; statusEl.classList.add('on'); statusEl.textContent = t('sp.listening'); } catch (_) { }
  });
  addEventListener('keyup', e => {
    if (e.code === 'Space' && active) {
      e.preventDefault(); active = false; r.abort(); statusEl.classList.remove('on'); statusEl.textContent = IDLE();
      const text = (finalEl.textContent + ' ' + interimEl.textContent).trim();
      finalEl.textContent = text; interimEl.textContent = '';
      if (text) onCommand(text);
    }
  });
  statusEl.textContent = IDLE();
}
