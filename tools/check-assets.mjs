import { allAssetUrls } from '../src/assets.js';
const base = process.argv[2] || 'http://localhost:8080/';
const urls = ['', 'src/main.js', 'src/game.js', 'src/maze.js', 'src/path.js', 'src/agent.js', 'src/jev.js', 'src/speech.js', 'src/render.js', 'src/assets.js', 'src/audio.js', ...new Set(allAssetUrls())];
let bad = 0;
for (const u of urls) {
  const r = await fetch(base + encodeURI(u));
  const b = Buffer.from(await r.arrayBuffer());
  const dim = u.endsWith('.png') && r.ok ? ` ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : '';
  if (!r.ok) bad++;
  if (!r.ok || process.argv.includes('-v')) console.log(r.status, u + dim);
}
console.log(`${urls.length - bad}/${urls.length} OK`);
process.exit(bad ? 1 : 0);
