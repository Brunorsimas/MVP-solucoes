import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore } from '../lib/postgres-store.mjs';
import { createNeonHandler } from '../lib/neon-api.mjs';
import { passwordCredentials } from '../lib/passwords.mjs';

const origin = 'https://app.example.test', fixedTime = '2026-10-20T13:00:00.000Z';
function caller(handler) {
  return async (path, data, token) => {
    const response = await handler(new Request('https://api.example.test/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data)
    }));
    return { status: response.status, body: await response.json() };
  };
}

test('Neon: senha própria entra, troca a senha e conta desativada é avisada', async t => {
  const pool = await embeddedPostgres(); t.after(() => pool.close());
  const store = createPostgresStore(pool); await store.init();
  await store.provision('bruno', 'bruno@team.example.test', passwordCredentials('senha-bruno-individual'));
  const call = caller(createNeonHandler({ store, verify: async () => { throw Error('Invalid JWT'); }, authUrl: 'https://auth.example.test/auth', origins: [origin], now: () => fixedTime, simulatedHour: 10, testLoginEnabled: true }));

  // Wrong credentials never reveal whether the login exists.
  assert.equal((await call('/auth/password-login', { login: 'bruno@team.example.test', password: 'errada' })).status, 401);
  assert.equal((await call('/auth/password-login', { login: 'ninguem@team.example.test', password: 'senha-bruno-individual' })).status, 401);
  const login = await call('/auth/password-login', { login: 'bruno@team.example.test', password: 'senha-bruno-individual' });
  assert.equal(login.status, 200);
  assert.match(login.body.token, /^mvp-pwd-[a-f0-9]{64}$/);
  const token = login.body.token;

  // Unlike the shared test password, a real password keeps the admin capabilities.
  const view = await call('/state', undefined, token);
  assert.equal(view.body.user.id, 'bruno');
  assert.equal(view.body.user.admin, true);
  assert.ok(view.body.admin.users.length);

  // A fabricated token of the right shape is rejected.
  assert.equal((await call('/state', undefined, 'mvp-pwd-' + 'a'.repeat(64))).status, 401);

  // The administration creates a user, which then signs in and changes its password.
  const created = await call('/action', { action: 'createUser', payload: { name: 'Ana Nova', email: 'ana.nova@teste.com', role: 'client', password: 'senha-inicial-ana' } }, token);
  assert.equal(created.status, 200);
  const ana = await call('/auth/password-login', { login: 'ana.nova@teste.com', password: 'senha-inicial-ana' });
  assert.equal(ana.status, 200);
  assert.equal((await call('/state', undefined, ana.body.token)).body.user.mustChangePassword, true);
  assert.equal((await call('/action', { action: 'readNotifications', payload: {} }, ana.body.token)).status, 403);
  assert.equal((await call('/auth/change-password', { currentPassword: 'errada', password: 'senha-propria-ana', confirmPassword: 'senha-propria-ana' }, ana.body.token)).status, 403);
  assert.equal((await call('/auth/change-password', { currentPassword: 'senha-inicial-ana', password: 'senha-propria-ana', confirmPassword: 'diferente-daqui' }, ana.body.token)).status, 400);
  assert.equal((await call('/auth/change-password', { currentPassword: 'senha-inicial-ana', password: 'senha-propria-ana', confirmPassword: 'senha-propria-ana' }, ana.body.token)).status, 200);
  assert.equal((await call('/state', undefined, ana.body.token)).body.user.mustChangePassword, false);
  assert.equal((await call('/action', { action: 'readNotifications', payload: {} }, ana.body.token)).status, 200);
  assert.equal((await call('/auth/password-login', { login: 'ana.nova@teste.com', password: 'senha-inicial-ana' })).status, 401);

  // The temporary test session never changes a password.
  const temporary = await call('/auth/test-login', { login: 'bruno', password: '123' });
  assert.equal((await call('/auth/change-password', { currentPassword: '123', password: 'senha-nova-bruno', confirmPassword: 'senha-nova-bruno' }, temporary.body.token)).status, 409);
  assert.equal((await call('/auth/password-login', { login: 'bruno@team.example.test', password: 'senha-bruno-individual' })).status, 200);

  // A suspended account is told to contact the administration.
  assert.equal((await call('/action', { action: 'toggleProfessional', payload: { id: 'kleber' } }, token)).status, 200);
  await store.provision('kleber', 'kleber@team.example.test', passwordCredentials('senha-kleber-individual'));
  const blocked = await call('/auth/password-login', { login: 'kleber@team.example.test', password: 'senha-kleber-individual' });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /Usuário desativado, entre em contato como administrador do sistema/);

  // Signing out ends the session.
  assert.equal((await call('/auth/logout', {}, token)).status, 200);
  assert.equal((await call('/state', undefined, token)).status, 401);
});
