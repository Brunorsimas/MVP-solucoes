// Isolated local preview of the actual Neon API handler. Never reads DATABASE_URL.
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from 'esbuild';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore } from '../lib/postgres-store.mjs';
import { createNeonHandler } from '../lib/neon-api.mjs';
import { createLiveEvents, LIVE_CHANNEL } from '../lib/live-events.mjs';
import { sendNodeResponse } from '../lib/node-response.mjs';

const port = 4190, origin = `http://127.0.0.1:${port}`;
const authUrl = process.env.NEON_AUTH_BASE_URL;
if (!authUrl) throw Error('A URL pública do Neon Auth é necessária para gerar a interface.');
await mkdir('data', { recursive: true }); await mkdir('artifacts/test-login-preview', { recursive: true });
const pool = await embeddedPostgres(resolve('data/test-login-preview'));
const store = createPostgresStore(pool); await store.init();
const live = createLiveEvents({ subscribe: callback => pool.listen(LIVE_CHANNEL, callback) });
const handle = createNeonHandler({ store, live, authUrl, origins: [origin], testLoginEnabled: true, simulatedHour: 10, verify: async () => { throw Error('Esta prévia utiliza somente contas de demonstração.'); } });
const bundle = resolve('artifacts/test-login-preview/app.js');
await build({ entryPoints: ['public/app.js'], outfile: bundle, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', define: { __NEON_PUBLIC_CONFIG__: JSON.stringify({ authUrl, apiUrl: origin + '/' }) } });
const root = resolve('public'), authOrigin = new URL(authUrl).origin;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      const abort = new AbortController(); res.once('close', () => abort.abort());
      const response = await handle(new Request(url, { signal: abort.signal, method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) }));
      sendNodeResponse(response, res); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) throw Error();
    let content = await readFile(path === '/app.js' ? bundle : file);
    if (path === '/index.html') content = content.toString().replace('<html lang="pt-BR">', '<html lang="pt-BR" data-mode="shared">');
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ${authOrigin}; frame-src ${authOrigin}; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404); res.end('Página não encontrada.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Prévia isolada com PostgreSQL local: ${origin}/#/entrar`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { live.close(); server.closeAllConnections(); server.close(async () => { await pool.close(); process.exit(0); }); });
