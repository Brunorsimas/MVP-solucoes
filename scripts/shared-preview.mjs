import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore, connectPostgres } from '../lib/postgres-store.mjs';
import { createSharedHandler, passwordCredentials } from '../lib/shared-api.mjs';

mkdirSync('data', { recursive: true });
const database = process.env.DATABASE_URL ? await connectPostgres() : await embeddedPostgres(resolve('data/shared-preview'));
const store = database.store || createPostgresStore(database); await store.init();
if (!process.env.DATABASE_URL) {
  const path = 'data/shared-preview-access.json';
  const access = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : Object.fromEntries(['bruno', 'tayane', 'kleber'].map(id => [id, randomBytes(15).toString('base64url')]));
  writeFileSync(path, JSON.stringify(access, null, 2));
  for (const [id, password] of Object.entries(access)) if (!await store.account(id)) await store.provision(id, `${id}@preview.example.test`, passwordCredentials(password));
  console.log('Acessos individuais da prévia salvos em data/shared-preview-access.json (fora do Git). Clientes: use Criar conta.');
}
const handler = createSharedHandler({ store, secure: false, simulatedHour: 10 });
const root = resolve('public');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: req, duplex: 'half' } : {}) });
      const response = await handler(request, { ip: req.socket.remoteAddress });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) throw Error();
    let content = readFileSync(file);
    if (extname(file) === '.html') content = content.toString().replace('<html lang="pt-BR">', '<html lang="pt-BR" data-mode="shared">');
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end('Não encontrado.'); }
});
const port = Number(process.env.PORT || 4188);
server.listen(port, '127.0.0.1', () => console.log(`Prévia compartilhada local: http://127.0.0.1:${port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(async () => { await database.close(); process.exit(0); }); });
