// Funny "didn't understand" replies. The phrase banks live in i18n ('huh.<category>' arrays, uk/en).
// With an API key the SAME JEV request also carries one choice question "what kind of thing did the player say?"
// (speculative fan-out: asked on every command, used only when the plan comes out empty). Without a key: any phrase.
import { t, getLang } from './i18n.js';
export const HUH_CATS = {
  gibberish: 'Gibberish, noise, random sounds or a misheard fragment that means nothing',
  rude: 'Rude words, an insult or swearing at the hero',
  compliment: 'A compliment or praise for the hero',
  world: 'A question about the world, the dungeon, its monsters or its story',
  impossible: 'A request for something the hero cannot do in this game, like flying, dancing, singing or magic',
  ambiguous: 'An unclear or ambiguous direction, like "over there" or "that way", without saying which way',
  food: 'Food, eating, hunger or drinks (not potions)',
  greeting: 'A greeting or goodbye, like hello or hi',
  philosophy: 'A philosophical or deep question about life, meaning or the self',
  too_long: 'A very long or rambling command with too many things in it',
  other: 'Something else',
};
export const HUH_KEY = 'huh__kind';
export function huhQuestion() {
  return { type: 'choice', instructions: 'The hero could not turn `human_command` into a game action. What kind of thing did the player say?', criteria: { ...HUH_CATS } };
}
export const huhPhrases = (cat, lang = getLang()) => { const v = t('huh.' + cat, {}, lang); return Array.isArray(v) ? v : []; };
export const allHuh = (lang = getLang()) => Object.keys(HUH_CATS).flatMap(c => huhPhrases(c, lang));
// a random phrase of the category (unknown / 'other' / no category -> all phrases); never one of the last 3 said
export function pickHuh(cat, { lang = getLang(), recent = [], R = Math.random, keep = 3 } = {}) {
  const base = cat && huhPhrases(cat, lang).length ? huhPhrases(cat, lang) : allHuh(lang);
  let pool = base.filter(p => !recent.includes(p));
  if (!pool.length) pool = allHuh(lang).filter(p => !recent.includes(p));
  const p = pool[Math.floor(R() * pool.length) % pool.length];
  recent.push(p); while (recent.length > keep) recent.shift();
  return p;
}
