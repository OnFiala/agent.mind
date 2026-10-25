import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readIndexedSource } from './code-index.mjs';
import { LiveIndex } from './live-index.mjs';
import { projectContext } from './graph-context.mjs';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = new Map([
  ['/', ['visualizer.html', 'text/html']],
  ['/visualizer.js', ['visualizer.js', 'text/javascript']],
  ['/hierarchy.mjs', ['hierarchy.mjs', 'text/javascript']],
  ['/visualizer.css', ['visualizer.css', 'text/css']],
  ['/assets/canvas-paper.webp', ['assets/canvas-paper.webp', 'image/webp']],
  ['/assets/agent-mind-wordmark.webp', ['assets/agent-mind-wordmark.webp', 'image/webp']]
]);

export function sourceExcerpt(root, graph, relative, requestedLine = 1, indexOptions = {}) {
  const node = graph.nodes.find(item => item.path === relative);
  if (!node || !node.hash || !relative || path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error('The file is not in the active index.');
  const source = readIndexedSource(root, node, indexOptions);
  const lines = source.split(/\r?\n/);
  const line = Math.max(1, Math.min(lines.length, Number.isFinite(Number(requestedLine)) ? Math.floor(Number(requestedLine)) : 1));
  const startLine = Math.max(1, line - 8);
  return { path: relative, hash: node.hash, totalLines: lines.length, startLine, lines: lines.slice(startLine - 1, startLine + 70).map((text, offset) => ({ number: startLine + offset, text })) };
}

export function createVisualizer({ root = APP_ROOT, intervalMs = 900, indexOptions = {}, binding = null } = {}) {
  root = fs.realpathSync(root);
  binding?.verify?.();
  const live = new LiveIndex(root, { intervalMs, indexOptions });
  const publicBinding = binding ? Object.fromEntries(Object.entries(binding).filter(([, value]) => typeof value !== 'function')) : null;
  const snapshot = () => ({ ...live.snapshot(), ...(publicBinding ? { binding: publicBinding } : {}) });
  const clients = new Set();
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const port = server.address()?.port;
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!allowed.has(req.headers.host)) return json(res, 403, { error: 'Loopback host required.' });
    if (req.headers.origin && ![...allowed].some(host => req.headers.origin === `http://${host}`)) return json(res, 403, { error: 'Same-origin request required.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Cross-site request rejected.' });
    if (req.method !== 'GET') return json(res, 405, { error: 'Visualizer is read-only. Builder is archived.' });
    try { binding?.verify?.(); }
    catch (error) { return json(res, 409, { error: `Project binding unavailable: ${error.message}` }); }
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); }
    catch { return json(res, 400, { error: 'Invalid request target.' }); }
    if (url.pathname === '/api/graph') return json(res, 200, snapshot());
    if (url.pathname === '/api/context') {
      live.refresh();
      if (live.runtime.status === 'error') return json(res, 503, { error: live.runtime.error });
      try { return json(res, 200, projectContext(snapshot(), url.searchParams.get('block') || url.searchParams.get('path'))); }
      catch (error) { return json(res, 404, { error: error.message }); }
    }
    if (url.pathname === '/api/source') {
      try { return json(res, 200, sourceExcerpt(root, live.graph, url.searchParams.get('path'), url.searchParams.get('line') || 1, indexOptions)); }
      catch (error) { return json(res, 409, { error: error.message }); }
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const asset = ASSETS.get(url.pathname);
    if (asset) {
      try { const bytes = fs.readFileSync(path.join(APP_ROOT, 'public', asset[0])); res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); return res.end(bytes); }
      catch { return json(res, 404, { error: 'Asset missing.' }); }
    }
    return json(res, 404, { error: 'Not found. Check the path and available read-only endpoints.' });
  });
  live.on('state', state => {
    try { binding?.verify?.(); }
    catch { for (const client of clients) client.destroy(); clients.clear(); return; }
    const message = `event: state\ndata: ${JSON.stringify({ ...state, ...(publicBinding ? { binding: publicBinding } : {}) })}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 2 * 1024 * 1024) { client.destroy(); clients.delete(client); }
      else client.write(message);
    }
  });
  const heartbeat = setInterval(() => {
    try { binding?.verify?.(); }
    catch { for (const client of clients) client.destroy(); clients.clear(); return; }
    for (const client of clients) client.write(': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); live.close(); });
  return { server, live, close: () => { for (const client of clients) client.end(); server.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (fs.existsSync(path.join(APP_ROOT, 'artifact.json'))) {
    console.error('Use the installed agent.mind/cli.mjs view command to verify the target project binding.');
    process.exit(1);
  }
  const app = createVisualizer({ root: process.env.AGENT_MIND_PROJECT || APP_ROOT });
  app.server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => {
    console.log(`agent.mind code visualizer: http://127.0.0.1:${app.server.address().port}`);
    console.log(`Read-only project: ${app.live.root}`);
  });
  app.server.on('error', error => { console.error(error.message); app.live.close(); process.exitCode = 1; });
  process.on('SIGTERM', () => app.close());
  process.on('SIGINT', () => app.close());
}
