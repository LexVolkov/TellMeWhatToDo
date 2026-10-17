// Shared headless simulation: a guide (oracle) that speaks `delay` s after the hero has no human plan, or no guide at all.
import { Game } from '../src/game.js';
import { oracle } from './oracle.mjs';
export function runSim(seed, { guide = true, delay = 3, maxT = 2000, auto = true, on } = {}) {
  const g = new Game({ seed, auto }); if (on) g.on((ty, d) => on(g, ty, d));
  let quiet = 0, cmds = 0;
  for (let i = 0; i < maxT / 0.05 && !g.hero.won && !g.hero.dead; i++) {
    g.update(0.05);
    if (!guide) continue;
    const free = (!g.goal || g.goal.auto) && !g.queue.length;
    quiet = free ? quiet + 0.05 : 0;
    if (free && quiet >= delay && !g.hero.dead && !g.hero.won) { g.setQueue(oracle(g)); cmds++; quiet = 0; }
  }
  return { g, won: g.hero.won, dead: g.hero.dead, time: g.time, cmds };
}