// Tune BAL: node tools/tune-enemies.mjs '[{"dmgMul":0.6}]'  (array of overrides; or a JSON file path)
import { BAL } from '../src/maze.js';
import { runSim } from './sim.mjs';
const sims = JSON.parse(process.argv[2].startsWith('[') ? process.argv[2] : (await import('fs')).readFileSync(process.argv[2], 'utf8'));
const N = +(process.argv[3] || 80), idle = process.argv.includes('--idle');
for (const o of sims) {
  Object.assign(BAL, o); let wins = 0, iw = 0, deaths = 0;
  for (let seed = 1; seed <= N; seed++) { const r = runSim(seed); if (r.won) wins++; if (r.dead) deaths++; if (idle && runSim(seed, { guide: false, maxT: 1500 }).won) iw++; }
  console.log(JSON.stringify(o), 'guide', Math.round(100 * wins / N) + '%', 'deaths', deaths + (idle ? ' | idle hero ' + Math.round(100 * iw / N) + '%' : ''));
}