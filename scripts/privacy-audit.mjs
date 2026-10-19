// Authorized local audit: synthetic accounts and an isolated in-memory database only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { context, credentials } from './security-audit.mjs';
import { createApp } from '../server.mjs';
const checks = [], findings = [];
const c = await context();
try {
  const { client, legal, outsider, admin, alternate, agent, ok, ticket, accept, upload, clientId, legalId } = c;
  const anonymous = agent();
  const clientPrivate = { phone: '(81) 91111-1111', contactEmail: 'privado.cliente@example.test', city: 'Cidade Privada Cliente', region: 'PE' };
  const legalPrivate = { phone: '(81) 92222-2222', contactEmail: 'privado.juridico@example.test', city: 'Cidade Privada Especialista', region: 'PE' };
  await ok(client.action('profile', clientPrivate)); await ok(legal.action('profile', legalPrivate));
  for (const [name, who] of [['anonymous', anonymous], ['outsider', outsider], ['admin', admin], ['client', client], ['specialist', legal]]) {
    const view = await who.state(), serialized = JSON.stringify({ ...view, user: null });
    for (const value of [...Object.values(clientPrivate), ...Object.values(legalPrivate)].filter(v => v !== 'PE')) assert.equal(serialized.includes(value), false, name + ': ' + value);
    for (const p of view.professionals) for (const field of ['phone', 'email', 'contactEmail', 'city', 'region', 'profileCompletion']) assert.equal(Object.hasOwn(p, field), false, name + ': ' + field);
  }
  checks.push('Private contact fields are absent from public profiles, other clients, other specialists and admin projection.');
  await ok(client.action('profile', { id: legalId, role: 'professional', admin: true, email: 'invasor@example.test', capacity: 99 }));
  assert.equal((await client.state()).user.id, clientId);
  assert.equal((await client.state()).user.admin, false);
  assert.equal((await client.state()).user.role, 'client');
  assert.equal((await legal.state()).user.contactEmail, legalPrivate.contactEmail);
  checks.push('Mass assignment cannot change another account, role, admin privilege or capacity.');
  const id = await ticket('Pessoa Fictícia - caso familiar reservado', { city: 'Cidade Fictícia do Caso', description: 'Descrição sigilosa fictícia somente para as partes.' });
  const queue = (await alternate.state()).tickets.find(t => t.id === id);
  assert.equal(queue.title, 'Pessoa Fictícia - caso familiar reservado'); assert.equal(queue.city, 'Cidade Fictícia do Caso');
  assert.equal(queue.description, 'Descrição sigilosa fictícia somente para as partes.'); assert.equal(queue.clientId, undefined);
  checks.push('Authorized product rule: compatible specialists can review the request title, description and city before accepting. P04 reclassified as intended access, not an access-control finding.');
  await accept(id);
  await ok(client.action('message', { ticketId: id, text: 'Mensagem sigilosa fictícia.' }));
  const fileId = await upload(id);
  await ok(client.action('support', { ticketId: id, message: 'Suporte privado fictício para verificar isolamento.' }));
  for (const who of [outsider, alternate, admin]) {
    assert.equal((await who.state()).tickets.some(t => t.id === id), false);
    assert.equal((await who(`/files/${fileId}`)).status, 404);
    assert.equal((await who.action('message', { ticketId: id, text: 'Intrusão de teste' })).status, 403);
  }
  assert.equal((await anonymous(`/files/${fileId}`)).status, 401);
  assert.equal((await legal.state()).support.length, 0);
  assert.equal((await admin.state()).support.length, 1); // Explicit support channel, intended admin access.
  checks.push('Unrelated accounts and admin cannot read private chats/files; support is restricted to its author and admin.');
  await ok(client.action('release', { ticketId: id, reason: 'Transferência fictícia para testar isolamento.' }));
  await ok(alternate.action('accept', { ticketId: id }));
  await ok(alternate.action('message', { ticketId: id, text: 'NOVA_CONVERSA_PRIVADA' }));
  assert.equal((await alternate(`/files/${fileId}`)).status, 404);
  const before = (await legal.state()).tickets.find(t => t.id === id);
  await ok(alternate.action('closeNoCharge', { ticketId: id, reason: 'Motivo privado fictício informado pelo novo especialista.' }));
  const after = (await legal.state()).tickets.find(t => t.id === id);
  assert.equal(before.status, 'released'); assert.deepEqual(after, before);
  assert.equal(after.professionalId, legalId); assert.ok(after.closedAt);
  assert.equal(JSON.stringify(after).includes('NOVA_CONVERSA_PRIVADA'), false);
  assert.equal(after.closeReason, 'Transferência fictícia para testar isolamento.');
  checks.push('P05 fixed: former specialist sees only the closed participation; future owner, status and closure reason are not exposed.');
  checks.push('Transfer preserves isolation of messages and files between specialists.');
  const csrf = await client.action('profile', { phone: '' }, { 'X-CSRF-Token': 'invalid' }); assert.equal(csrf.status, 403);
  assert.equal((await client.action('profile', { phone: '' }, { Origin: 'https://foreign.example.test' })).status, 403);
  await ok(outsider('/auth/logout', {})); assert.equal((await outsider.action('profile', {})).status, 401);
  checks.push('Invalid CSRF, foreign origin and logged-out mutation are blocked.');
  const publicCode = await fetch(c.origin + '/domain.js').then(r => r.text()); assert.match(publicCode, /DEMO_PASSWORD = '123'/);
  const seedAttacker = agent(); await ok(seedAttacker('/auth/login', { login: 'bruno', password: '123' })); assert.equal((await seedAttacker.state()).user.admin, true);
  findings.push({ id: 'P02', severity: 'critical-if-public', scope: 'demo', observed: 'Published test credentials grant access to seeded accounts, including admin Bruno. This is intentional demo behavior; seeded profiles cannot hold real private data.' });
  for (const [name, account, privateData] of [['client', credentials.client, clientPrivate], ['specialist', credentials.legal, legalPrivate]]) {
    const attacker = agent(); const recovery = await attacker('/auth/recover', { email: account.email });
    assert.ok(recovery.body.demoToken);
    await ok(attacker('/auth/reset', { token: recovery.body.demoToken, password: 'AtaqueFicticio!2026' }));
    await ok(attacker('/auth/login', { login: account.email, password: 'AtaqueFicticio!2026' }));
    const stolen = (await attacker.state()).user; assert.equal(stolen.phone, privateData.phone); assert.equal(stolen.contactEmail, privateData.contactEmail);
    assert.equal((await (name === 'client' ? client : legal).state()).user, null);
  }
  findings.push({ id: 'P01', severity: 'critical-if-public', scope: 'demo', observed: 'Unauthenticated recovery returns the reset token. Knowing only a registered client or specialist email allows resetting its password and reading private contacts. Both roles reproduced; only synthetic accounts affected.' });
} finally { await c.app.close(); }

// Verify which demo behaviors persist with DEMO_MODE=0.
const normal = createApp({ database: ':memory:', demo: false });
await new Promise(r => normal.server.listen(0, '127.0.0.1', r));
try {
  const base = `http://127.0.0.1:${normal.server.address().port}/api`;
  const post = async (path, data) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: r.status, body: await r.json() }; };
  const registration = { name: 'Privacidade Teste', email: 'enumeracao@example.test', password: 'SenhaFicticia!2026', agreed: true };
  assert.equal((await post('/auth/register', registration)).status, 201);
  assert.equal((await post('/auth/register', registration)).status, 409);
  assert.equal((await post('/auth/register', { ...registration, email: 'livre@example.test' })).status, 201);
  findings.push({ id: 'P06', severity: 'low', scope: 'server', observed: 'Registration returns 409 for an existing email and 201 for an unused email, confirming account membership. Reproduced in non-demo mode; registration rate limiting reduces speed but does not hide membership.' });
  assert.equal((await post('/auth/login', { login: 'bruno', password: '123' })).status, 401);
  const recovery = await post('/auth/recover', { email: registration.email }); assert.equal(recovery.body.demoToken, undefined);
  checks.push('Non-demo mode blocks seeded 123 login and does not return recovery tokens.');
} finally { await normal.close(); }

// Static demo has no server security boundary. Reproduce raw data access after logout.
class Storage { data = new Map(); getItem(k) { return this.data.get(k) ?? null; } setItem(k,v) { this.data.set(k,String(v)); } removeItem(k) { this.data.delete(k); } }
globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage();
const { staticRequest } = await import('../public/demo.js');
staticRequest('/auth/login', { login: 'tayane', password: '123' });
staticRequest('/action', { action: 'profile', payload: { phone: '(81) 93333-3333', contactEmail: 'static.privado@example.test' } });
staticRequest('/auth/logout', {});
assert.equal(staticRequest('/state').user, null);
const raw = JSON.parse(localStorage.getItem('mvp-solucoes-static-v1'));
assert.equal(raw.users.find(u => u.id === 'tayane').phone, '(81) 93333-3333');
sessionStorage.setItem('mvp-solucoes-static-session-v2', 'bruno');
assert.equal(staticRequest('/state').user.admin, true);
findings.push({ id: 'P03', severity: 'high', scope: 'static-demo', observed: 'All demo accounts persist in plaintext localStorage after logout. A person controlling the same browser can read private contacts and set the session user ID to impersonate admin. This does not demonstrate remote access from another device.' });
delete globalThis.localStorage; delete globalThis.sessionStorage;
mkdirSync('artifacts/auditoria', { recursive: true });
const result = { at: new Date().toISOString(), syntheticOnly: true, checks, findings: findings.sort((a,b) => a.id.localeCompare(b.id)) };
writeFileSync('artifacts/auditoria/privacy-results.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
