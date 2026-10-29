import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { digest } from './shared-api.mjs';
import { passwordCredentials, passwordMatches } from './passwords.mjs';
import { projectState, businessOpen, requireThat, fail, DEMO_USERS, DEMO_PASSWORD } from '../public/domain.js';

export function neonVerifier({ authUrl, jwksUrl }) {
  const keys = createRemoteJWKSet(new URL(jwksUrl)), issuer = new URL(authUrl).origin;
  return async token => (await jwtVerify(token, keys, { issuer, algorithms: ['EdDSA'] })).payload;
}
export function createNeonHandler({ store, verify, authUrl, origins, now = () => new Date().toISOString(), simulatedHour = null, testLoginEnabled = false, live = null }) {
  const allowed = new Set(origins);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
  async function body(request) {
    requireThat((request.headers.get('content-type') || '').startsWith('application/json'), 'Use JSON.', 415);
    const reader = request.body?.getReader(), chunks = []; let size = 0;
    if (reader) for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 3000000) { await reader.cancel(); fail('Conteúdo maior que o permitido.', 413); }
      chunks.push(Buffer.from(value));
    }
    try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); requireThat(data && typeof data === 'object' && !Array.isArray(data), 'JSON inválido.'); return data; }
    catch { fail('JSON inválido.'); }
  }
  return async function handle(request) {
    const origin = request.headers.get('origin');
    const cors = origin && allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, content-type, x-csrf-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' } : {};
    const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...headers, ...cors, ...extra } });
    try {
      requireThat(!origin || allowed.has(origin), 'Origem não permitida.', 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, ...cors } });
      requireThat(['GET', 'POST'].includes(request.method), 'Método não permitido.', 405);
      const path = new URL(request.url).pathname;
      if (path === '/api/auth/test-login' && request.method === 'POST') {
        requireThat(testLoginEnabled, 'O acesso temporário está desativado.', 403);
        // A shared limit also covers unknown usernames and persists across instances.
        await store.throttle(digest('test-login:global'), 120, Date.parse(now()));
        const data = await body(request), login = String(data.login || '').trim().toLocaleLowerCase('pt-BR');
        const target = DEMO_USERS.find(u => u.username === login || u.email === login);
        await store.throttle(digest(`test-login:${target?.id || login.slice(0, 128)}`), 10, Date.parse(now()));
        requireThat(target && data.password === DEMO_PASSWORD, 'Usuário ou senha inválidos.', 401);
        const token = 'mvp-test-' + randomBytes(32).toString('hex'), expires = Date.parse(now()) + 8 * 3600000;
        await store.startTestSession(digest(token), target.id, expires);
        return json({ ok: true, token, expiresAt: new Date(expires).toISOString() });
      }
      if (path === '/api/auth/password-login' && request.method === 'POST') {
        await store.throttle(digest('password-login:global'), 120, Date.parse(now()));
        const data = await body(request), login = String(data.login || data.email || '').trim().toLocaleLowerCase('pt-BR');
        await store.throttle(digest(`password-login:${login.slice(0, 128)}`), 10, Date.parse(now()));
        const account = await store.account(login);
        requireThat(passwordMatches(account, data.password), 'Usuário ou senha inválidos.', 401);
        // Checked only after the password, so this never reveals which logins exist.
        requireThat(await store.activeUser(account.user_id), 'Usuário desativado, entre em contato como administrador do sistema.', 403);
        const token = 'mvp-pwd-' + randomBytes(32).toString('hex'), expires = Date.parse(now()) + 12 * 3600000;
        await store.startSession(digest(token), account.user_id, randomBytes(24).toString('hex'), expires);
        return json({ ok: true, token, expiresAt: new Date(expires).toISOString() });
      }
      const authorization = request.headers.get('authorization'); let identity = null, testSession = null, passwordSession = null;
      if (authorization) {
        requireThat(/^Bearer /i.test(authorization), 'Entre na sua conta para continuar.', 401);
        const token = authorization.slice(7);
        if (token.startsWith('mvp-test-')) {
          requireThat(testLoginEnabled && /^mvp-test-[a-f0-9]{64}$/.test(token), 'Sua sessão expirou. Entre novamente.', 401);
          testSession = await store.testSession(digest(token), Date.parse(now()));
        } else if (token.startsWith('mvp-pwd-')) {
          requireThat(/^mvp-pwd-[a-f0-9]{64}$/.test(token), 'Sua sessão expirou. Entre novamente.', 401);
          passwordSession = await store.session(digest(token), Date.parse(now()));
          requireThat(passwordSession, 'Sua sessão expirou. Entre novamente.', 401);
        } else {
          try { identity = await verify(token); requireThat(typeof identity.sub === 'string' && identity.sub, 'Token inválido.', 401); }
          catch { fail('Sua sessão expirou. Entre novamente.', 401); }
        }
      }
      const publicState = path === '/api/state' && request.method === 'GET';
      requireThat(publicState || identity || testSession || passwordSession, 'Entre na sua conta para continuar.', 401);
      // Only the intentionally public catalogue is read before authentication.
      const userId = testSession?.user_id || passwordSession?.user_id || (identity ? await store.neonIdentity(identity.sub) : null);
      if (path === '/api/events' && request.method === 'GET') {
        requireThat(live, 'Atualizações ao vivo ainda não configuradas.', 503);
        await store.throttle(digest(`live:${userId}`), 30, Date.parse(now()));
        return await live.open(request, { userId, headers: { ...headers, ...cors }, authorize: async () => {
          if (testSession) await store.testSession(testSession.token, Date.parse(now()));
          else if (passwordSession) requireThat(await store.session(passwordSession.token, Date.parse(now())), 'Sua sessão expirou.', 401);
          else {
            const renewed = await verify(authorization.slice(7));
            requireThat(renewed.sub === identity.sub && await store.neonIdentity(renewed.sub) === userId, 'Sessão alterada.', 401);
          }
          requireThat(await store.activeUser(userId), 'Sua conta não está disponível.', 401);
        } });
      }
      const state = await store.read(), profile = userId ? state.users.find(u => u.id === userId && u.active) : null;
      const user = profile && testSession ? { ...profile, admin: false } : profile;
      if (identity || testSession || passwordSession) requireThat(user, 'Sua conta não está disponível.', 401);
      if (request.method === 'POST') await store.throttle(digest(`neon:${testSession ? 'test:' + userId : passwordSession ? 'pwd:' + userId : identity.sub}:mutate`), 120, Date.parse(now()));
      await store.cleanup(now());
      if (publicState) {
        // Read after cleanup so expired content is never returned once more.
        const fresh = await store.read();
        return json({ ...projectState(fresh, user, { now: now() }), csrf: testSession ? testSession.token : passwordSession ? passwordSession.token : identity ? digest(`neon:${identity.sub}`) : undefined, config: { mode: 'shared', authProvider: 'neon', authUrl, testLoginEnabled, live: live ? 'sse' : null, simulatedHour, open: businessOpen(new Date(now()), simulatedHour), serverTime: now(), externalNotifications: false, retentionDays: 30 } });
      }
      if (path === '/api/action' && request.method === 'POST') {
        const data = await body(request);
        return json({ ok: true, result: await store.action(user.id, data.action, data.payload, { now: now(), hour: simulatedHour, testSession: !!testSession }) });
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        if (testSession) await store.logoutTestSession(testSession.token);
        if (passwordSession) await store.logout(passwordSession.token);
        return json({ ok: true });
      }
      if (path === '/api/auth/change-password' && request.method === 'POST') {
        // Managed Neon Auth accounts change their password through the provider SDK.
        requireThat(passwordSession, 'Esta conta não possui senha própria neste ambiente.', 409);
        await store.throttle(digest(`change-password:${user.id}`), 10, Date.parse(now()));
        const data = await body(request);
        const account = await store.accountById(user.id);
        requireThat(passwordMatches(account, data.currentPassword), 'A senha atual não confere.', 403);
        requireThat(data.password === data.confirmPassword, 'A confirmação não corresponde à nova senha.');
        requireThat(data.password !== data.currentPassword, 'A nova senha deve ser diferente da atual.');
        await store.setPassword(user.id, passwordCredentials(data.password), { keepSession: passwordSession.token });
        return json({ ok: true });
      }
      if (path.startsWith('/api/files/') && request.method === 'GET') {
        const fresh = await store.read(), id = path.split('/').at(-1); let file;
        for (const ticket of fresh.tickets) for (const thread of ticket.threads) if (ticket.clientId === user.id || thread.professionalId === user.id) file ||= thread.files.find(f => f.id === id);
        requireThat(file, 'Arquivo não encontrado.', 404);
        const data = await store.file(file.id, file.data);
        requireThat(data, 'Arquivo não encontrado.', 404);
        return new Response(data, { headers: { ...headers, ...cors, 'Content-Type': file.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
      }
      fail('Rota não encontrada.', 404);
    } catch (error) {
      if (!error.status) console.error('Neon API failure', error.code || error.name);
      return json({ error: error.status ? error.message : 'Serviço indisponível. Tente novamente.' }, error.status || 503, error.status === 429 ? { 'Retry-After': '60' } : {});
    }
  };
}
