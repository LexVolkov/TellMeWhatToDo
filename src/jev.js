// JEV: turns a voice command into a small plan. Called only when a command arrives.
// One request: for each available action a noul "does the player ask for it" + a score "which part of the command".
import { buildPlanQuestions, selectPlan, splitCommand } from './plan.js';
import { t, getLang } from './i18n.js';
import { huhQuestion, HUH_KEY, HUH_CATS } from './huh.js';
const DIRECT = 'https://api.typesafe.ai/v1/systemone';

export async function jevInterpret({ key, useProxy, state, roomActs, generic }) {
  // every direction is always offered (later in the plan the hero is in another room; validity is checked at execution)
  const actions = { ...roomActs, ...generic };
  const lang = getLang();
  const parts = splitCommand(state.human_command, lang);
  state = { human_command: state.human_command, command_language: lang === 'en' ? 'English' : 'Ukrainian', command_parts: parts, ...state };
  const questions = buildPlanQuestions(actions, parts, lang);
  questions[HUH_KEY] = huhQuestion(); // speculative: used only if the plan comes out empty
  const res = await fetch(useProxy ? '/api/decide' : DIRECT, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = [400, 401, 402, 502].includes(res.status) ? t('jev.' + res.status) : t('jev.err');
    throw new Error(`JEV ${res.status}: ${msg}${body.error ? ' - ' + (typeof body.error === 'string' ? body.error : JSON.stringify(body.error)) : ''}`);
  }
  const plan = selectPlan(body.answers || {}, actions);
  const kind = body.answers?.[HUH_KEY]?.choice;
  return {
    steps: plan.map(s => s.label), plan, notUnderstood: !plan.length, source: 'JEV', huhKind: HUH_CATS[kind] && kind !== 'other' ? kind : null,
    cost: body.usage?.cost_usd ?? (body.usage?.input_tokens != null ? body.usage.input_tokens * 42e-9 : undefined),
  };
}