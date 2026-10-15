import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createState, normalizeState, demoUser, DEMO_PASSWORD, projectState, purgeExpired, fail, requireThat, uid, businessOpen } from './public/domain.js';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const tokenHash = value => createHash('sha256').update(value).digest('hex');
export function createApp({ database = join(root, 'data', 'mvp.sqlite'), demo = true, simulatedHour = 10, now = () => new Date().toISOString() } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS accounts (user_id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS reset_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);');
  if (!db.prepare('SELECT id FROM app_state WHERE id=1').get()) db.prepare('INSERT INTO app_state VALUES(1,?)').run(JSON.stringify(createState(now())));
  const load = () => normalizeState(JSON.parse(db.prepare('SELECT content FROM app_state WHERE id=1').get().content));
  const save = state => db.prepare('UPDATE app_state SET content=? WHERE id=1').run(JSON.stringify(state));
  function transact(fn) { db.exec('BEGIN IMMEDIATE'); try { const state = load(); const result = fn(state); save(state); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function cleanup() {
    const changed = transact(state => purgeExpired(state, now()));
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('DELETE FROM reset_tokens WHERE expires < ?').run(Date.now());
    if (changed) db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  }
  cleanup();
  const timer = setInterval(cleanup, 60000).unref();
  const attempts = new Map();
  function throttle(req, key, max = 30) {
    const id = `${req.socket.remoteAddress}:${key}`; const time = Date.now();
    const entry = attempts.get(id) || { count: 0, reset: time + 60000 };
    if (entry.reset < time) { entry.count = 0; entry.reset = time + 60000; }
    if (++entry.count > max) fail('Muitas tentativas. Aguarde um minuto.', 429);
    attempts.set(id, entry);
    if (attempts.size > 10000) for (const [k, v] of attempts) if (v.reset < time) attempts.delete(k);
  }
  async function body(req) {
    requireThat((req.headers['content-type'] || '').startsWith('application/json'), 'Use JSON.', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 3000000) fail('Conteúdo maior que o permitido.', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { fail('JSON inválido.'); }
  }
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('mvp_session='))?.slice(12);
    return token ? db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(tokenHash(token), Date.now()) : null;
  }
  const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  function startSession(res, userId) {
    const token = randomBytes(32).toString('hex'); const csrf = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(token), userId, csrf, Date.now() + 12 * 3600000);
    res.setHeader('Set-Cookie', `mvp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
    return csrf;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') {
          requireThat(!req.headers.origin || req.headers.origin === `http://${req.headers.host}` || req.headers.origin === `https://${req.headers.host}`, 'Origem não permitida.', 403);
          requireThat(req.headers['sec-fetch-site'] !== 'cross-site', 'Origem não permitida.', 403);
          throttle(req, 'mutate', 120);
        }
        cleanup();
        const currentSession = session(req); const state = load(); const user = currentSession ? state.users.find(u => u.id === currentSession.user_id && u.active) : null;
        if (req.method === 'GET' && url.pathname === '/api/state') return json(res, { ...projectState(state, user), csrf: currentSession?.csrf, config: { mode: demo ? 'local-demo' : 'local', simulatedHour: demo ? simulatedHour : null, open: businessOpen(new Date(now()), demo ? simulatedHour : null), serverTime: now(), externalNotifications: false, retentionDays: 30 } });
        if (req.method === 'POST' && url.pathname === '/api/auth/register') {
          throttle(req, 'register', 10); const data = await body(req); const email = String(data.email || '').trim().toLowerCase();
          requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 255, 'Informe um e-mail válido.');
          requireThat(typeof data.password === 'string' && data.password.length >= 10 && data.password.length <= 128, 'A senha deve ter de 10 a 128 caracteres.');
          requireThat(String(data.name || '').trim().length >= 2 && data.agreed === true, 'Informe seu nome e aceite os termos.');
          requireThat(!state.users.some(u => u.email === email), 'Não foi possível criar a conta com este e-mail.', 409);
          const id = uid(); const salt = randomBytes(16).toString('hex'); const hash = scryptSync(data.password, salt, 64).toString('hex');
          transact(s => { s.users.push({ id, name: data.name.trim().slice(0, 70), initials: data.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase(), email, role: 'client', active: true, available: true, createdAt: now(), termsAcceptedAt: now() }); db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(id, email, salt, hash); });
          return json(res, { csrf: startSession(res, id), message: 'Conta de teste criada. Verificação externa de e-mail ainda não configurada.' }, 201);
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/login') {
          throttle(req, 'login', 10); const data = await body(req);
          const login = String(data.login || data.email || '').trim().toLowerCase();
          const target = demo ? demoUser(state, login) : null;
          if (target) {
            requireThat(target.active && data.password === DEMO_PASSWORD, 'Usuário ou senha inválidos.', 401);
            return json(res, { csrf: startSession(res, target.id) });
          }
          const account = db.prepare('SELECT * FROM accounts WHERE email=?').get(login);
          const hash = scryptSync(String(data.password || '').slice(0, 128), account?.salt || 'dummy-salt', 64);
          requireThat(account && timingSafeEqual(hash, Buffer.from(account.hash, 'hex')) && state.users.find(u => u.id === account.user_id)?.active, 'E-mail ou senha inválidos.', 401);
          return json(res, { csrf: startSession(res, account.user_id) });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/recover') {
          throttle(req, 'recover', 5); const data = await body(req); const account = db.prepare('SELECT * FROM accounts WHERE email=?').get(String(data.email || '').trim().toLowerCase());
          if (account && demo) { const token = randomBytes(32).toString('hex'); db.prepare('INSERT INTO reset_tokens VALUES(?,?,?)').run(tokenHash(token), account.user_id, Date.now() + 15 * 60000); return json(res, { demoToken: token, message: 'Entrega de e-mail simulada. Use o código abaixo somente nesta demonstração.' }); }
          return json(res, { message: 'Se houver uma conta, a recuperação dependerá da configuração do serviço de e-mail. Nenhuma mensagem externa foi enviada.' });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/reset') {
          throttle(req, 'reset', 10); const data = await body(req); const row = db.prepare('SELECT * FROM reset_tokens WHERE token=? AND expires>?').get(tokenHash(String(data.token || '')), Date.now());
          requireThat(row, 'Código inválido ou expirado.'); requireThat(typeof data.password === 'string' && data.password.length >= 10 && data.password.length <= 128, 'Use de 10 a 128 caracteres.');
          const salt = randomBytes(16).toString('hex'); db.prepare('UPDATE accounts SET salt=?,hash=? WHERE user_id=?').run(salt, scryptSync(data.password, salt, 64).toString('hex'), row.user_id); db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(row.user_id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id); return json(res, { ok: true });
        }
        requireThat(user, 'Entre na sua conta para continuar.', 401);
        if (req.method !== 'GET') requireThat(req.headers['x-csrf-token'] === currentSession.csrf, 'Sua sessão mudou. Atualize a página.', 403);
        if (req.method === 'POST' && url.pathname === '/api/auth/logout') { db.prepare('DELETE FROM sessions WHERE token=?').run(currentSession.token); res.setHeader('Set-Cookie', 'mvp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/api/action') {
          const data = await body(req);
          if (data.action === 'upload') {
            const file = Buffer.from(data.payload?.data || '', 'base64');
            requireThat(file.length <= 2 * 1024 * 1024 && file.length > 0, 'Arquivo maior que 2 MB ou vazio.');
            const type = data.payload?.type;
            requireThat((type === 'application/pdf' && file.subarray(0, 5).toString() === '%PDF-') || (type === 'image/png' && file.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') || (type === 'image/jpeg' && file[0] === 255 && file[1] === 216 && file[2] === 255), 'O conteúdo do arquivo não corresponde ao formato informado.');
          }
          const result = transact(s => act(s, s.users.find(u => u.id === user.id), data.action, data.payload, { now: now(), hour: demo ? simulatedHour : null }));
          return json(res, { ok: true, result });
        }
        if (req.method === 'GET' && url.pathname.startsWith('/api/files/')) {
          const id = url.pathname.split('/').at(-1); let file;
          for (const t of state.tickets) for (const thread of t.threads) if (t.clientId === user.id || thread.professionalId === user.id) file ||= thread.files.find(f => f.id === id);
          requireThat(file, 'Arquivo não encontrado.', 404);
          res.writeHead(200, { 'Content-Type': file.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'no-store' }); return res.end(Buffer.from(file.data, 'base64'));
        }
        fail('Rota não encontrada.', 404);
      }
      requireThat(req.method === 'GET' || req.method === 'HEAD', 'Método não permitido.', 405);
      let pathname = decodeURIComponent(url.pathname);
      let filename = resolve(root, 'public', `.${pathname}`);
      requireThat(filename.startsWith(resolve(root, 'public') + '/') || filename.startsWith(resolve(root, 'public') + '\\') || filename === resolve(root, 'public'), 'Arquivo não encontrado.', 404);
      if (!extname(pathname)) filename = join(root, 'public', 'index.html');
      requireThat(existsSync(filename), 'Página não encontrada.', 404);
      const content = readFileSync(filename);
      res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(res, { error: error.status ? error.message : 'Não foi possível concluir a operação.' }, error.status || 500);
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  return { server, db, load, transact, cleanup, close: () => { clearInterval(timer); server.closeAllConnections(); return new Promise(resolveClose => server.close(() => { db.close(); resolveClose(); })); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = process.env.DEMO_MODE !== '0';
  const simulatedHour = process.env.DEMO_TIME === 'real' ? null : Number(process.env.DEMO_TIME || 10);
  const app = createApp({ demo, simulatedHour, database: process.env.DATABASE_PATH || join(root, 'data', 'mvp.sqlite') });
  const port = Number(process.env.PORT || 4173); const host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`MVP Soluções: http://${host}:${port}\n${demo ? 'Demonstração com dados de teste. Alertas externos simulados.' : 'Modo local. Revisar requisitos de produção antes de exposição pública.'}`));
  process.on('SIGINT', () => app.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
}
