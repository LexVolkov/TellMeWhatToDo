const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.css': 'text/css' };

http.createServer(async (q, r) => {
  if (q.url === '/api/decide' && q.method === 'POST') {
    const chunks = []; for await (const c of q) chunks.push(c);
    try {
      const up = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', headers: { 'Authorization': q.headers['authorization'] || '', 'Content-Type': 'application/json' }, body: Buffer.concat(chunks),
      });
      const txt = await up.text();
      try { let req = {}; try { req = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} let resp = txt; try { resp = JSON.parse(txt); } catch {} fs.writeFileSync(path.join(root, 'tools', 'last-jev.json'), JSON.stringify({ time: new Date().toISOString(), status: up.status, request: req, response: resp }, null, 2)); console.log('JEV', up.status, req.state && req.state.human_command); } catch {}
      r.writeHead(up.status, { 'Content-Type': 'application/json' }); r.end(txt);
    } catch (e) { r.writeHead(502, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ error: 'proxy: ' + e.message })); }
    return;
  }
  let p = path.normalize(path.join(root, decodeURIComponent(q.url.split('?')[0])));
  if (!p.startsWith(root)) { r.writeHead(403); return r.end('403'); }
  if (p.endsWith(path.sep)) p += 'index.html';
  fs.readFile(p, (e, d) => {
    if (e) { r.writeHead(404); return r.end('404'); }
    r.writeHead(200, { 'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); r.end(d);
  });
}).listen(+(process.env.PORT || 9123), () => console.log('http://localhost:' + (process.env.PORT || 9123)));
