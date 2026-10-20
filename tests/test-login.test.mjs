import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore } from '../lib/postgres-store.mjs';
import { createNeonHandler } from '../lib/neon-api.mjs';
import { digest } from '../lib/shared-api.mjs';
import { DEMO_USERS, createState, normalizeState } from '../public/domain.js';

const origin = 'https://app.example.test', fixedTime = '2026-10-20T13:00:00.000Z';
function caller(handler) {
  return async (path, data, token, requestOrigin = origin) => {
    const response = await handler(new Request('https://api.example.test/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: requestOrigin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data)
    }));
    return { status: response.status, body: await response.json() };
  };
}
async function fixture(t) {
  const pool = await embeddedPostgres(); t.after(() => pool.close());
  const store = createPostgresStore(pool); await store.init();
  const options = { store, verify: async () => { throw Error('Invalid JWT'); }, authUrl: 'https://auth.example.test/auth', origins: [origin], now: () => fixedTime, simulatedHour: 10 };
  return { pool, store, options, call: caller(createNeonHandler({ ...options, testLoginEnabled: true })) };
}

test('Login temporário: nove nomes, sessões no PostgreSQL, permissões e conversa privada', async t => {
  const { store, pool, call } = await fixture(t), sessions = {};
  for (const seed of DEMO_USERS) {
    const login = await call('/auth/test-login', { login: ' ' + seed.username.toUpperCase() + ' ', password: '123', role: 'admin', admin: true });
    assert.equal(login.status, 200, seed.username);
    assert.match(login.body.token, /^mvp-test-[a-f0-9]{64}$/);
    sessions[seed.id] = login.body.token;
    const state = await call('/state', undefined, login.body.token);
    assert.equal(state.status, 200); assert.equal(state.body.user.id, seed.id);
    assert.equal(state.body.user.role, seed.role); assert.equal(state.body.user.admin, false);
    assert.equal(state.body.user.email, `${seed.username}@teste.com`);
    assert.equal(state.body.admin, null);
    assert.equal(state.body.config.testLoginEnabled, true);
    const emailLogin = await call('/auth/test-login', { login: ' ' + seed.email.toUpperCase() + ' ', password: '123' });
    assert.equal(emailLogin.status, 200, seed.email);
    assert.equal((await call('/state', undefined, emailLogin.body.token)).body.user.id, seed.id);
  }
  const rows = (await pool.query('SELECT token FROM mvp_test_sessions')).rows;
  assert.equal(rows.length, 18);
  assert.ok(rows.some(r => r.token === digest(sessions.cliente)));
  assert.ok(rows.every(r => !r.token.startsWith('mvp-test-')));
  const payload = { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Teste do login simplificado', description: 'Computador fictício para validar cliente e especialista em sessões independentes.', agreed: true };
  const created = await call('/action', { action: 'createTicket', payload }, sessions.cliente);
  assert.equal(created.status, 200); const ticketId = created.body.result.ticketId;
  assert.equal((await call('/action', { action: 'accept', payload: { ticketId } }, sessions.bruno)).status, 200);
  assert.equal((await call('/action', { action: 'message', payload: { ticketId, text: 'Mensagem privada de demonstração.' } }, sessions.bruno)).status, 200);
  const restored = await call('/state', undefined, sessions.cliente);
  assert.ok(restored.body.tickets[0].threads[0].messages.some(m => m.text === 'Mensagem privada de demonstração.'));
  assert.equal((await call('/state', undefined, sessions.tayane)).body.tickets.length, 0);
  assert.equal((await call('/state', undefined, sessions.kleber)).body.tickets.length, 0);
  assert.equal((await call('/action', { action: 'toggleProfessional', payload: { id: 'kleber' } }, sessions.bruno)).status, 403);
  assert.equal((await call('/action', { action: 'profile', payload: { name: 'Bruno Teste', city: 'Recife', admin: true } }, sessions.bruno)).status, 200);
  assert.equal((await store.read()).users.find(u => u.id === 'bruno').name, 'Bruno Teste');
  assert.equal((await call('/state', undefined, sessions.bruno)).body.user.admin, false);
  assert.equal((await call('/auth/logout', {}, sessions.cliente)).status, 200);
  assert.equal((await call('/state', undefined, sessions.cliente)).status, 401);
  const again = await call('/auth/test-login', { login: 'user', password: '123' });
  assert.notEqual(again.body.token, sessions.cliente);
  assert.equal((await call('/state', undefined, again.body.token)).body.tickets[0].id, ticketId);
});

test('Login temporário: desativado por padrão, expiração, suspensão e identidade real vinculada', async t => {
  const { pool, options, call } = await fixture(t);
  const disabled = caller(createNeonHandler(options));
  assert.equal((await disabled('/auth/test-login', { login: 'user', password: '123' })).status, 403);
  const login = await call('/auth/test-login', { login: 'bruno', password: '123' });
  assert.equal((await disabled('/state', undefined, login.body.token)).status, 401);
  const expired = caller(createNeonHandler({ ...options, testLoginEnabled: true, now: () => '2026-10-20T21:00:00.000Z' }));
  assert.equal((await expired('/state', undefined, login.body.token)).status, 401);
  await pool.query('INSERT INTO mvp_neon_identities(subject,user_id) VALUES($1,$2)', ['real-subject', 'bruno']);
  assert.equal((await call('/auth/test-login', { login: 'bruno', password: '123' })).status, 401);
  assert.equal((await call('/auth/test-login', { login: 'bruno@teste.com', password: '123' })).status, 401);
  assert.equal((await call('/state', undefined, login.body.token)).status, 401, 'existing test sessions cannot bypass a real identity');
  await options.store.transaction(state => { state.users.find(u => u.id === 'tayane').active = false; });
  assert.equal((await call('/auth/test-login', { login: 'tayane', password: '123' })).status, 401);
});

test('Login temporário: senha exata, nomes permitidos, token fabricado, CORS e limite de tentativas', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/auth/test-login', { login: 'user', password: 123 })).status, 401);
  assert.equal((await call('/auth/test-login', { login: 'user@example.test', password: '123' })).status, 401);
  assert.equal((await call('/auth/test-login', { login: 'administrador', password: '123' })).status, 401);
  assert.equal((await call('/auth/test-login', { login: 'user', password: '123' }, undefined, 'https://evil.example.test')).status, 403);
  assert.equal((await call('/state', undefined, 'mvp-test-' + 'a'.repeat(64))).status, 401);
  assert.equal((await call('/state', undefined, 'forged-jwt')).status, 401);
  for (let i = 0; i < 9; i++) assert.equal((await call('/auth/test-login', { login: i % 2 ? 'user@teste.com' : 'user', password: 'wrong' })).status, 401);
  assert.equal((await call('/auth/test-login', { login: 'user', password: '123' })).status, 429);
});

test('E-mails demonstrativos: migra os valores antigos e preserva cadastros e contatos personalizados', () => {
  const state = createState();
  for (const user of state.users) user.email = `${user.username}@example.test`;
  normalizeState(state);
  for (const user of state.users) assert.equal(user.email, `${user.username}@teste.com`);
  const bruno = state.users.find(u => u.id === 'bruno');
  bruno.email = 'titular@empresa.example'; bruno.contactEmail = 'contato@empresa.example';
  state.users.push({ id: 'outro-cliente', name: 'Outro', email: 'outro@example.test', role: 'client', active: true });
  const saved = JSON.stringify(normalizeState(state));
  assert.equal(bruno.email, 'titular@empresa.example'); assert.equal(bruno.contactEmail, 'contato@empresa.example');
  assert.equal(state.users.find(u => u.id === 'outro-cliente').email, 'outro@example.test');
  assert.equal(JSON.stringify(normalizeState(state)), saved);
});
