import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore } from '../lib/postgres-store.mjs';
import { createNeonHandler } from '../lib/neon-api.mjs';

test('Neon: valida token antes do banco e só permite origens configuradas', async () => {
  let reads = 0;
  const handler = createNeonHandler({ store: { read() { reads++; throw Error(); } }, verify: async () => { throw Error(); }, authUrl: 'https://auth.example.test/auth', origins: ['https://app.example.test'] });
  const call = (path, method, headers = {}) => handler(new Request('https://function.example.test' + path, { method, headers }));
  assert.equal((await call('/api/action', 'POST')).status, 401);
  assert.equal((await call('/api/state', 'GET', { Authorization: 'Bearer forged' })).status, 401);
  assert.equal((await call('/api/state', 'GET', { Origin: 'https://evil.example.test' })).status, 403);
  const preflight = await call('/api/action', 'OPTIONS', { Origin: 'https://app.example.test' });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.test');
  assert.equal(reads, 0);
});

test('Neon: identidade gera somente cliente e vinculação de especialista exige e-mail verificado', async t => {
  const pool = await embeddedPostgres(); t.after(() => pool.close());
  await pool.query('CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id TEXT PRIMARY KEY,name TEXT,email TEXT,"emailVerified" BOOLEAN,banned BOOLEAN)');
  await pool.query('INSERT INTO neon_auth."user" VALUES($1,$2,$3,false,false)', ['subject1', 'Cliente Neon', 'neon@example.test']);
  const store = createPostgresStore(pool);
  const id = await store.neonIdentity('subject1'); assert.equal(await store.neonIdentity('subject1'), id);
  assert.equal((await store.read()).users.find(u => u.id === id).role, 'client');
  await assert.rejects(store.linkNeonSpecialist('subject1', 'bruno'), /verificar seu e-mail/);
  await pool.query('UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=$1', ['subject1']);
  await store.linkNeonSpecialist('subject1', 'bruno'); assert.equal(await store.neonIdentity('subject1'), 'bruno');
  const handler = createNeonHandler({ store, verify: async token => { assert.equal(token, 'valid'); return { sub: 'subject1' }; }, authUrl: 'https://auth.example.test/auth', origins: ['https://app.example.test'], simulatedHour: 10 });
  const response = await handler(new Request('https://function.example.test/api/state', { headers: { Authorization: 'Bearer valid', Origin: 'https://app.example.test' } }));
  const view = await response.json(); assert.equal(view.user.id, 'bruno'); assert.equal(view.user.admin, true); assert.equal(view.config.authProvider, 'neon');
  assert.equal(view.config.authUrl, 'https://auth.example.test/auth');
  assert.equal(view.professionals.some(p => p.email || p.phone), false);
  await pool.query('UPDATE neon_auth."user" SET banned=true WHERE id=$1', ['subject1']);
  await assert.rejects(store.neonIdentity('subject1'), e => e.status === 401);
});
