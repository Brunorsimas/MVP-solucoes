import { randomBytes, createHash } from 'node:crypto';
import { passwordCredentials, passwordMatches } from './passwords.mjs';
import { projectState, businessOpen, requireThat, uid, fail, initialsOf } from '../public/domain.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export { passwordCredentials };
const securityHeaders = {
  'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow'
};
export function createSharedHandler({ store, now = () => new Date().toISOString(), simulatedHour = null, secure = true, live = null } = {}) {
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...securityHeaders, ...headers } });
  async function body(req) {
    requireThat((req.headers.get('content-type') || '').startsWith('application/json'), 'Use JSON.', 415);
    requireThat(Number(req.headers.get('content-length') || 0) <= 3000000, 'Conteúdo maior que o permitido.', 413);
    const reader = req.body?.getReader(); const parts = []; let size = 0;
    if (reader) for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 3000000) { await reader.cancel(); fail('Conteúdo maior que o permitido.', 413); }
      parts.push(Buffer.from(value));
    }
    try { const data = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); requireThat(data && typeof data === 'object' && !Array.isArray(data), 'JSON inválido.'); return data; }
    catch { fail('JSON inválido.'); }
  }
  async function startSession(userId) {
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    await store.startSession(digest(token), userId, csrf, Date.parse(now()) + 12 * 3600000);
    return json({ csrf }, 200, { 'Set-Cookie': `mvp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}` });
  }
  return async function handle(req, { ip = 'unknown' } = {}) {
    try {
      const url = new URL(req.url), path = url.pathname.replace(/^\/api/, '');
      requireThat(['GET', 'POST'].includes(req.method), 'Método não permitido.', 405);
      if (req.method === 'POST') {
        requireThat(!req.headers.get('origin') || req.headers.get('origin') === url.origin, 'Origem não permitida.', 403);
        requireThat(req.headers.get('sec-fetch-site') !== 'cross-site', 'Origem não permitida.', 403);
        await store.throttle(digest(`${ip}:mutate`), 120, Date.parse(now()));
      }
      await store.cleanup(now());
      const cookie = (req.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith('mvp_session='))?.slice(12);
      const session = cookie ? await store.session(digest(cookie), Date.parse(now())) : null;
      const state = await store.read(), user = session ? state.users.find(u => u.id === session.user_id && u.active) : null;
      if (req.method === 'GET' && path === '/state') return json({ ...projectState(state, user, { now: now() }), csrf: user ? session.csrf : undefined, config: { mode: 'shared', live: live ? 'sse' : null, simulatedHour, open: businessOpen(new Date(now()), simulatedHour), serverTime: now(), externalNotifications: false, retentionDays: 30 } });
      if (req.method === 'POST' && path === '/auth/register') {
        await store.throttle(digest(`${ip}:register`), 10, Date.parse(now()));
        const data = await body(req), email = String(data.email || '').trim().toLowerCase(), name = String(data.name || '').trim();
        requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 255, 'Informe um e-mail válido.');
        requireThat(name.length >= 2 && data.agreed === true, 'Informe seu nome e aceite os termos.');
        const credentials = { ...passwordCredentials(data.password), login: email }, id = uid();
        await store.register({ id, name: name.slice(0, 70), initials: initialsOf(name), email, role: 'client', active: true, available: true, createdAt: now(), termsAcceptedAt: now() }, credentials);
        const response = await startSession(id);
        return new Response(response.body, { status: 201, headers: response.headers });
      }
      if (req.method === 'POST' && path === '/auth/login') {
        await store.throttle(digest(`${ip}:login`), 10, Date.parse(now()));
        const data = await body(req), login = String(data.login || data.email || '').trim().toLowerCase();
        const account = await store.account(login);
        requireThat(passwordMatches(account, data.password), 'Usuário ou senha inválidos.', 401);
        // Only after the password checks out: otherwise this leaks which logins exist.
        requireThat(state.users.find(u => u.id === account.user_id)?.active, 'Usuário desativado, entre em contato como administrador do sistema.', 403);
        return startSession(account.user_id);
      }
      if (req.method === 'POST' && path === '/auth/recover') {
        await store.throttle(digest(`${ip}:recover`), 5, Date.parse(now())); await body(req);
        return json({ message: 'A recuperação automática ainda não está disponível neste piloto. Solicite ajuda ao administrador. Nenhum e-mail foi enviado.' });
      }
      if (req.method === 'POST' && path === '/auth/reset') fail('A recuperação automática ainda não está disponível. Procure o administrador.', 503);
      requireThat(user, 'Entre na sua conta para continuar.', 401);
      if (req.method === 'GET' && path === '/events') {
        requireThat(live, 'Atualizações ao vivo ainda não configuradas.', 503);
        requireThat(!req.headers.get('origin') || req.headers.get('origin') === url.origin, 'Origem não permitida.', 403);
        await store.throttle(digest(`${user.id}:live`), 30, Date.parse(now()));
        return await live.open(req, { userId: user.id, headers: securityHeaders, authorize: async () => {
          const latest = await store.session(session.token, Date.parse(now()));
          requireThat(latest?.user_id === user.id && await store.activeUser(user.id), 'Sua sessão expirou.', 401);
        } });
      }
      if (req.method === 'POST') requireThat(req.headers.get('x-csrf-token') === session.csrf, 'Sua sessão mudou. Atualize a página.', 403);
      if (req.method === 'POST' && path === '/auth/logout') {
        await store.logout(session.token);
        return json({ ok: true }, 200, { 'Set-Cookie': `mvp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}` });
      }
      if (req.method === 'POST' && path === '/auth/change-password') {
        await store.throttle(digest(`${user.id}:change-password`), 10, Date.parse(now()));
        const data = await body(req);
        const account = await store.accountById(user.id);
        requireThat(account, 'Esta conta não possui senha própria neste ambiente.', 409);
        requireThat(passwordMatches(account, data.currentPassword), 'A senha atual não confere.', 403);
        requireThat(data.password === data.confirmPassword, 'A confirmação não corresponde à nova senha.');
        requireThat(data.password !== data.currentPassword, 'A nova senha deve ser diferente da atual.');
        await store.setPassword(user.id, passwordCredentials(data.password), { keepSession: session.token });
        return json({ ok: true });
      }
      if (req.method === 'POST' && path === '/action') {
        const data = await body(req);
        const result = await store.action(user.id, data.action, data.payload, { now: now(), hour: simulatedHour });
        return json({ ok: true, result });
      }
      if (req.method === 'GET' && path.startsWith('/files/')) {
        const id = path.split('/').at(-1); let file;
        for (const ticket of state.tickets) for (const thread of ticket.threads) if (ticket.clientId === user.id || thread.professionalId === user.id) file ||= thread.files.find(f => f.id === id);
        requireThat(file, 'Arquivo não encontrado.', 404);
        const data = await store.file(file.id, file.data);
        requireThat(data, 'Arquivo não encontrado.', 404);
        return new Response(data, { headers: { ...securityHeaders, 'Content-Type': file.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
      }
      fail('Rota não encontrada.', 404);
    } catch (error) {
      if (error.code === '23505') return json({ error: 'Não foi possível criar a conta com este e-mail.' }, 409);
      if (!error.status) console.error('Falha na API compartilhada.', error.code || error.name);
      return json({ error: error.status ? error.message : 'Não foi possível concluir a operação. Tente novamente.' }, error.status || 500);
    }
  };
}
