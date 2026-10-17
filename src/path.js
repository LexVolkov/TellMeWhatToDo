export function astar(W, H, start, targets, passable, cost = () => 1, maxNodes = 5000, diagOk = null) {
  if (!targets.length) return null;
  const tset = new Set(targets.map(([x, y]) => y * W + x));
  const h = diagOk
    ? (x, y) => Math.min(...targets.map(([tx, ty]) => { const a = Math.abs(tx - x), b = Math.abs(ty - y); return Math.max(a, b) + 0.414 * Math.min(a, b); }))
    : (x, y) => Math.min(...targets.map(([tx, ty]) => Math.abs(tx - x) + Math.abs(ty - y)));
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const s = start[1] * W + start[0];
  if (tset.has(s)) return [];
  const g = new Map([[s, 0]]), came = new Map(), open = [[h(start[0], start[1]), s]];
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, c] = open.splice(bi, 1)[0];
    if (tset.has(c)) { const p = []; let k = c; while (k !== s) { p.push([k % W, (k / W) | 0]); k = came.get(k); } return p.reverse(); }
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of diagOk ? N8 : N4) {
      const dg = dx && dy; if (dg && !diagOk(cx, cy, dx, dy)) continue;
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = y * W + x;
      if (!tset.has(k) && !passable(x, y)) continue;
      const ng = g.get(c) + cost(x, y) * (dg ? 1.414 : 1);
      if (ng < (g.get(k) ?? Infinity)) { g.set(k, ng); came.set(k, c); open.push([ng + h(x, y), k]); }
    }
  }
  return null;
}
