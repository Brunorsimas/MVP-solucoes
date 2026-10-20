import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Pool } from 'pg';
import { DEMO_USERS } from '../public/domain.js';

const branch = process.env.NEON_BRANCH, api = process.env.NEON_FUNCTION_HELLO_BASE_URL;
assert.ok(branch && api, 'Informe a configuração da branch a validar.');
const exercise = process.argv.includes('--exercise');
assert.ok(!exercise || branch !== 'production', 'Chamados de teste somente na branch isolada.');
const sessions = [], origin = 'https://stellar-tiramisu-56e571.netlify.app';
async function call(path, payload, token, requestOrigin = origin) {
  const response = await fetch(new URL('api' + path, api), { method: payload === undefined ? 'GET' : 'POST', headers: { Origin: requestOrigin, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  return { status: response.status, body: await response.json() };
}
let clientToken, professionalToken;
try {
  const publicState = await call('/state');
  assert.equal(publicState.status, 200); assert.equal(publicState.body.user, null);
  assert.equal(publicState.body.config.testLoginEnabled, true);
  assert.ok(publicState.body.professionals.every(u => !u.email && !u.phone));
  for (const seed of DEMO_USERS) {
    for (const login of [seed.username, seed.email]) {
      const result = await call('/auth/test-login', { login, password: '123' });
      assert.equal(result.status, 200, seed.username + ': ' + JSON.stringify(result.body));
      const token = result.body.token; sessions.push(token);
      const state = await call('/state', undefined, token);
      assert.equal(state.status, 200); assert.equal(state.body.user.id, seed.id);
      assert.equal(state.body.user.email, seed.email); assert.equal(state.body.user.role, seed.role);
      assert.equal(state.body.user.admin, false); assert.equal(state.body.admin, null);
      assert.equal((await call('/state', undefined, token)).body.user.id, seed.id);
      if (seed.id === 'cliente') clientToken = token;
      if (seed.id === 'bruno') professionalToken = token;
    }
    console.log(`PASS ${branch}: ${seed.username} e ${seed.email}; perfil correto e sessão persistente.`);
  }
  assert.equal((await call('/auth/test-login', { login: 'user@teste.com', password: 'wrong' })).status, 401);
  assert.equal((await call('/action', { action: 'createTicket', payload: {} })).status, 401);
  assert.equal((await call('/state', undefined, 'mvp-test-' + 'a'.repeat(64))).status, 401);
  assert.equal((await call('/auth/test-login', { login: 'user', password: '123' }, undefined, 'https://evil.example.test')).status, 403);
  assert.equal((await call('/action', { action: 'toggleProfessional', payload: { id: 'kleber' } }, professionalToken)).status, 403);
  if (exercise) {
    const created = await call('/action', { action: 'createTicket', payload: { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Validação de e-mails de teste ' + Date.now(), description: 'Chamado fictício da branch isolada para conferir login e conversa privada.', agreed: true } }, clientToken);
    assert.equal(created.status, 200, JSON.stringify(created.body)); const ticketId = created.body.result.ticketId;
    assert.equal((await call('/action', { action: 'accept', payload: { ticketId } }, professionalToken)).status, 200);
    assert.equal((await call('/action', { action: 'message', payload: { ticketId, text: 'Mensagem fictícia da validação remota.' } }, professionalToken)).status, 200);
    assert.ok((await call('/state', undefined, clientToken)).body.tickets.find(t => t.id === ticketId).threads[0].messages.some(m => m.text.includes('validação remota')));
    assert.equal((await call('/action', { action: 'cancel', payload: { ticketId } }, clientToken)).status, 200);
    console.log(`PASS ${branch}: abertura, aceite, chat e cancelamento do chamado fictício.`);
  }
  const connection = new URL(process.env.DATABASE_URL_UNPOOLED); connection.searchParams.set('sslmode', 'verify-full');
  const pool = new Pool({ connectionString: connection.toString(), connectionTimeoutMillis: 15000 });
  try {
    const state = (await pool.query('SELECT content FROM mvp_state WHERE id=1')).rows[0].content;
    for (const seed of DEMO_USERS) assert.equal(state.users.find(u => u.id === seed.id).email, seed.email);
    console.log(`PASS ${branch}: nove e-mails persistidos no PostgreSQL; autenticação e permissões validadas.`);
  } finally { await pool.end(); }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(`artifacts/test-login-${branch}-results.json`, JSON.stringify({ passed: true, branch, accounts: DEMO_USERS.map(u => ({ login: u.username, email: u.email })), ticketFlow: exercise, checks: ['username and email aliases', 'persistent sessions', 'profile emails persisted in PostgreSQL', 'anonymous access blocked', 'forged tokens blocked', 'foreign origins blocked', 'no admin through public password'] }, null, 2));
} finally {
  for (const token of sessions) {
    assert.equal((await call('/auth/logout', {}, token)).status, 200);
    assert.equal((await call('/state', undefined, token)).status, 401);
  }
}
console.log(`PASS ${branch}: todas as sessões de teste revogadas no logout.`);
