import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore, connectPostgres } from '../lib/postgres-store.mjs';
import { createSharedHandler, passwordCredentials, digest } from '../lib/shared-api.mjs';
import netlifyHandler from '../netlify/functions/api.mjs';

const fixedTime = '2026-10-20T13:00:00.000Z';
const ticketPayload = { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Computador de teste', description: 'Descrição fictícia suficiente para testar o compartilhamento.', agreed: true };
function agent(handler, ip) {
  let cookie = '', csrf = '';
  return {
    async request(path, data, headers = {}) {
      const response = await handler(new Request('https://piloto.example.test/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie, 'X-CSRF-Token': csrf, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) }), { ip });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const body = await response.json(); if (body.csrf) csrf = body.csrf;
      return { response, body, status: response.status };
    },
    get cookie() { return cookie; }
  };
}
test('PostgreSQL: persistência em disco, dispositivos independentes, isolamento e fluxo', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mvp-shared-'));
  let db = await embeddedPostgres(directory);
  t.after(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  let store = createPostgresStore(db); await store.init();
  await store.provision('bruno', 'bruno@team.example.test', passwordCredentials('senha-bruno-individual'));
  await store.provision('kleber', 'kleber@team.example.test', passwordCredentials('senha-kleber-individual'));
  await store.provision('tayane', 'tayane@team.example.test', passwordCredentials('senha-tayane-individual'));
  const handler = createSharedHandler({ store, now: () => fixedTime });
  const client = agent(handler, 'client'), specialist = agent(handler, 'pro'), rival = agent(handler, 'rival'), other = agent(handler, 'other');
  assert.equal((await client.request('/auth/login', { login: 'bruno', password: '123' })).status, 401);
  assert.equal((await client.request('/auth/register', { name: 'Cliente Teste', email: 'cliente@teste.example', password: 'senha-cliente-teste', agreed: true, role: 'professional', admin: true })).status, 201);
  const account = await store.account('cliente@teste.example'); assert.notEqual(account.hash, 'senha-cliente-teste');
  assert.equal((await client.request('/state')).body.user.role, 'client');
  assert.equal((await client.request('/state')).body.user.admin, false);
  assert.equal((await specialist.request('/auth/login', { login: 'bruno', password: 'senha-bruno-individual' })).status, 200);
  await rival.request('/auth/login', { login: 'kleber', password: 'senha-kleber-individual' });
  await other.request('/auth/login', { login: 'tayane', password: 'senha-tayane-individual' });
  const response = await client.request('/action', { action: 'createTicket', payload: ticketPayload }); assert.equal(response.status, 200);
  const id = response.body.result.ticketId;
  const attempts = await Promise.all([specialist.request('/action', { action: 'accept', payload: { ticketId: id } }), rival.request('/action', { action: 'accept', payload: { ticketId: id } })]);
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
  const winner = attempts[0].status === 200 ? specialist : rival;
  assert.equal((await other.request('/state')).body.tickets.length, 0);
  await winner.request('/action', { action: 'message', payload: { ticketId: id, text: 'Conversa compartilhada privada' } });
  const secondDevice = agent(createSharedHandler({ store: createPostgresStore(db), now: () => fixedTime }), 'device2');
  await secondDevice.request('/auth/login', { login: 'cliente@teste.example', password: 'senha-cliente-teste' });
  assert.ok((await secondDevice.request('/state')).body.tickets[0].threads[0].messages.some(m => m.text === 'Conversa compartilhada privada'));
  await winner.request('/action', { action: 'proposal', payload: { ticketId: id, amount: '150.00', scope: 'Diagnóstico fictício do computador', deadline: '2 dias', terms: 'Na entrega' } });
  const proposal = (await client.request('/state')).body.tickets[0].proposals[0];
  assert.equal((await client.request('/action', { action: 'proposalDecision', payload: { ticketId: id, proposalId: proposal.id, decision: 'accepted' } })).status, 200);
  await winner.request('/action', { action: 'startService', payload: { ticketId: id } });
  await winner.request('/action', { action: 'deliver', payload: { ticketId: id } });
  assert.equal((await client.request('/action', { action: 'upload', payload: { ticketId: id, name: 'recibo.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\nFictício').toString('base64'), receipt: true } })).status, 200);
  const file = (await client.request('/state')).body.tickets[0].threads[0].files[0];
  assert.equal((await other.request('/files/' + file.id)).status, 404);
  await winner.request('/action', { action: 'confirmReceipt', payload: { ticketId: id, fileId: file.id, proposalId: proposal.id } });
  assert.equal((await winner.request('/action', { action: 'complete', payload: { ticketId: id } })).status, 200);
  assert.equal((await client.request('/action', { action: 'review', payload: { ticketId: id, rating: 5, comment: 'Teste' } })).status, 200);
  const persistedCookie = client.cookie;
  await db.close(); db = await embeddedPostgres(directory); store = createPostgresStore(db);
  const restarted = createSharedHandler({ store, now: () => fixedTime });
  const resumed = await restarted(new Request('https://piloto.example.test/api/state', { headers: { cookie: persistedCookie } })).then(r => r.json());
  assert.equal(resumed.user.email, 'cliente@teste.example'); assert.equal(resumed.tickets[0].status, 'completed'); assert.equal(resumed.tickets[0].review.rating, 5);
  assert.equal(resumed.config.mode, 'shared');
  assert.equal(await store.session(persistedCookie.slice(12)), undefined, 'session token stored only as hash');
  assert.ok(await store.session(digest(persistedCookie.slice(12)), Date.parse(fixedTime)));
  const fresh = agent(restarted, 'restart-login'); await fresh.request('/auth/login', { login: 'cliente@teste.example', password: 'senha-cliente-teste' });
  assert.equal((await fresh.request('/state')).body.user.id, account.user_id);
  await store.cleanup('2026-11-20T13:00:00.000Z');
  const expired = (await store.read()).tickets.find(t => t.id === id);
  assert.equal(expired.threads[0].messages.length, 0); assert.equal(expired.threads[0].files.length, 0);
  assert.equal(await store.session(digest(persistedCookie.slice(12)), Date.parse('2026-11-20T13:00:00.000Z')), undefined);
});

test('PostgreSQL: cadastro concorrente, rollback, CSRF, recuperação e limites persistentes', async t => {
  const db = await embeddedPostgres(); t.after(() => db.close());
  const store = createPostgresStore(db), handler = createSharedHandler({ store, now: () => fixedTime });
  const a = agent(handler, 'a'), b = agent(handler, 'b');
  const data = { name: 'Pessoa Teste', email: 'igual@example.test', password: 'senha-pessoa-teste', agreed: true };
  const results = await Promise.all([a.request('/auth/register', data), b.request('/auth/register', data)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await store.read()).users.filter(u => u.email === data.email).length, 1);
  const user = results[0].status === 201 ? a : b;
  const success = results.find(r => r.status === 201);
  assert.match(success.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); assert.match(success.response.headers.get('set-cookie'), /Secure/);
  assert.equal((await user.request('/action', { action: 'createTicket', payload: ticketPayload }, { 'X-CSRF-Token': 'invalid' })).status, 403);
  assert.equal((await user.request('/action', { action: 'createTicket', payload: ticketPayload }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await a.request('/auth/recover', { email: data.email })).body.demoToken, undefined);
  await assert.rejects(store.transaction(async (s, client) => { s.users.push({ id: 'rollback' }); await client.query('INSERT INTO mvp_accounts VALUES($1,$2,$3,$4,$5)', ['rollback', 'rollback', 'rollback@example.test', 'salt', 'hash']); throw new Error('rollback'); }), /rollback/);
  assert.equal(await store.account('rollback'), undefined); assert.equal((await store.read()).users.some(u => u.id === 'rollback'), false);
  await store.throttle('persistent-key', 1, Date.parse(fixedTime));
  await assert.rejects(createPostgresStore(db).throttle('persistent-key', 1, Date.parse(fixedTime)), e => e.status === 429);
  await user.request('/auth/logout', {}); assert.equal((await user.request('/state')).body.user, null);
});

test('banco ausente: conexão falha sem voltar ao armazenamento do navegador', async () => {
  await assert.rejects(connectPostgres(''), e => e.status === 503);
  const original = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try { const response = await netlifyHandler(new Request('https://piloto.example.test/api/state'), { ip: 'test' }); assert.equal(response.status, 503); assert.match((await response.json()).error, /banco compartilhado/); }
  finally { if (original !== undefined) process.env.DATABASE_URL = original; }
});
