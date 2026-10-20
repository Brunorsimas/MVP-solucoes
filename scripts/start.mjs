import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const managed = !!(process.env.NEON_AUTH_BASE_URL && process.env.NEON_FUNCTION_HELLO_BASE_URL);
if (!managed) {
  const { createApp } = await import('../server.mjs');
  const app = createApp({ database: process.env.DATABASE_PATH || resolve('data/mvp.sqlite'), demo: process.env.DEMO_MODE !== '0', simulatedHour: process.env.DEMO_TIME === 'real' ? null : Number(process.env.DEMO_TIME || 10) });
  const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`MVP Soluções: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
} else {
  const root = resolve('dist'), port = Number(process.env.PORT || 4189);
  if (!existsSync(resolve(root, 'index.html'))) throw Error('Execute npm run build antes de npm start.');
  const authOrigin = new URL(process.env.NEON_AUTH_BASE_URL).origin, functionOrigin = new URL(process.env.NEON_FUNCTION_HELLO_BASE_URL).origin;
  const server = http.createServer((request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) throw Error();
      if (!extname(file)) file = resolve(file, 'index.html');
      const content = readFileSync(file);
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ${authOrigin} ${functionOrigin}; frame-src ${authOrigin}; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end('Página não encontrada.'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`MVP Soluções + Neon: http://127.0.0.1:${port}/`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
