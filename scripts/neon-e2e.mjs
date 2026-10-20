import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresStore } from '../lib/postgres-store.mjs';

assert.ok(process.env.NEON_BRANCH && process.env.NEON_BRANCH !== 'production', 'Execute somente na branch de validação.');
const api = process.env.NEON_FUNCTION_HELLO_BASE_URL, authUrl = process.env.NEON_AUTH_BASE_URL;
assert.ok(api && authUrl, 'As variáveis da branch de teste são necessárias.');
const connection = new URL(process.env.DATABASE_URL_UNPOOLED); connection.searchParams.set('sslmode', 'verify-full');
const pool = new Pool({ connectionString: connection.toString(), connectionTimeoutMillis: 15000 });
const store = createPostgresStore(pool), checks = [], stamp = Date.now();
function authAgent() {
  const cookies = new Map();
  // Independent HTTP cookie jars avoid the browser SDK's module-wide session cache
  // mixing multiple fictitious users inside this single Node test process.
  const call = async (path, payload) => {
    const headers = new Headers({ Origin: 'http://localhost:4189', 'Content-Type': 'application/json' });
    if (cookies.size) headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const response = await fetch(authUrl.replace(/\/$/, '') + path, { method: payload === undefined ? 'GET' : 'POST', headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    for (const cookie of response.headers.getSetCookie()) { const part = cookie.split(';')[0], index = part.indexOf('='); cookies.set(part.slice(0, index), part.slice(index + 1)); }
    const data = await response.json();
    return response.ok ? { data, error: null } : { data: null, error: { message: data.message || 'Auth request failed', status: response.status } };
  };
  return { signUp: { email: data => call('/sign-up/email', { ...data, callbackURL: 'http://localhost:4189' }) }, signIn: { email: data => call('/sign-in/email', { ...data, callbackURL: 'http://localhost:4189' }) }, getSession: () => call('/get-session?disableCookieCache=true'), token: () => call('/token'), signOut: () => call('/sign-out', {}) };
}
function checked(result) { assert.equal(result.error, null, result.error?.message); return result.data; }
async function request(path, token, payload, headers = {}) {
  const r = await fetch(new URL('api' + path, api), { method: payload === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const content = r.headers.get('content-type')?.includes('application/json') ? await r.json() : await r.text();
  return { status: r.status, body: content, headers: r.headers };
}
try {
  await store.init();
  const client = authAgent(), specialist = authAgent(), outsider = authAgent();
  const password = randomBytes(20).toString('base64url');
  const accounts = [];
  for (const [auth, name, suffix] of [[client, 'Cliente QA Neon', 'client'], [specialist, 'Especialista QA Neon', 'pro'], [outsider, 'Outra Pessoa QA Neon', 'other']]) {
    const email = `mvp-${suffix}-${stamp}@example.test`;
    const signup = checked(await auth.signUp.email({ email, password, name }));
    assert.ok(signup.user?.id); accounts.push({ auth, email, subject: signup.user.id });
    const session = checked(await auth.getSession()); assert.equal(session.user.email, email);
  }
  checks.push('Neon Auth: signup and persistent provider sessions');
  const tokens = [];
  for (const { auth } of accounts) tokens.push(checked(await auth.token()).token);
  assert.ok(tokens.every(Boolean));
  const [ct, pt, ot] = tokens;
  assert.equal((await request('/action', null, { action: 'createTicket', payload: {} })).status, 401);
  assert.equal((await request('/state', 'forged.token.value')).status, 401);
  assert.equal((await request('/state', ct, undefined, { Origin: 'https://evil.example' })).status, 403);
  const publicState = await request('/state'); assert.equal(publicState.status, 200); assert.equal(publicState.body.user, null);
  assert.equal((await request('/state', ct)).body.user.role, 'client');
  const preflight = await fetch(new URL('api/action', api), { method: 'OPTIONS', headers: { Origin: 'http://localhost:4189', 'Access-Control-Request-Headers': 'authorization, content-type', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:4189');
  checks.push('Function: rejects anonymous/forged credentials and foreign origins; CORS preflight works');
  const proUser = (await request('/state', pt)).body.user;
  await store.transaction(state => {
    const user = state.users.find(u => u.id === proUser.id), template = state.users.find(u => u.id === 'bruno');
    Object.assign(user, { role: 'professional', sector: 'ti', specialty: 'Suporte de teste', services: ['Suporte técnico'], regions: [...template.regions], modalities: [...template.modalities] });
  });
  const create = await request('/action', ct, { action: 'createTicket', payload: { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'QA remoto Neon ' + stamp, description: 'Solicitação fictícia para validar Neon Auth, Postgres e Functions.', agreed: true } });
  // Business hours remain enforced. This script is normally run during 08:00-19:00 Recife.
  assert.equal(create.status, 200, JSON.stringify(create.body));
  const id = create.body.result.ticketId;
  assert.ok((await request('/state', pt)).body.tickets.some(t => t.id === id));
  assert.equal((await request('/action', pt, { action: 'accept', payload: { ticketId: id } })).status, 200);
  assert.equal((await request('/action', ct, { action: 'message', payload: { ticketId: id, text: 'Conversa salva no Neon.' } })).status, 200);
  assert.ok((await request('/state', pt)).body.tickets.find(t => t.id === id).threads[0].messages.some(m => m.text === 'Conversa salva no Neon.'));
  assert.equal((await request('/state', ot)).body.tickets.length, 0);
  assert.equal((await request('/action', ot, { action: 'message', payload: { ticketId: id, text: 'Não permitido' } })).status, 403);
  checks.push('Postgres + Function: independent client/specialist sessions share the private ticket and chat; outsider blocked');
  await request('/action', pt, { action: 'proposal', payload: { ticketId: id, amount: '75.00', scope: 'Diagnóstico fictício para testes', deadline: '1 dia', terms: 'Na entrega' } });
  const proposal = (await request('/state', ct)).body.tickets.find(t => t.id === id).proposals[0];
  assert.ok(proposal);
  assert.equal((await request('/action', ct, { action: 'proposalDecision', payload: { ticketId: id, proposalId: proposal.id, decision: 'accepted' } })).status, 200);
  await request('/action', pt, { action: 'startService', payload: { ticketId: id } });
  await request('/action', pt, { action: 'deliver', payload: { ticketId: id } });
  assert.equal((await request('/action', ct, { action: 'upload', payload: { ticketId: id, name: 'recibo-ficticio.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\nFicticio').toString('base64'), receipt: true } })).status, 200);
  const file = (await request('/state', ct)).body.tickets.find(t => t.id === id).threads[0].files[0];
  assert.equal((await request('/files/' + file.id, ot)).status, 404);
  const download = await fetch(new URL('api/files/' + file.id, api), { headers: { Authorization: `Bearer ${ct}` } }); assert.equal(download.status, 200); assert.match(await download.text(), /%PDF/);
  await request('/action', pt, { action: 'confirmReceipt', payload: { ticketId: id, fileId: file.id, proposalId: proposal.id } });
  assert.equal((await request('/action', pt, { action: 'complete', payload: { ticketId: id } })).status, 200);
  assert.equal((await request('/action', ct, { action: 'review', payload: { ticketId: id, rating: 5, comment: 'Validação fictícia' } })).status, 200);
  const saved = (await pool.query('SELECT content FROM mvp_state WHERE id=1')).rows[0].content.tickets.find(t => t.id === id);
  assert.equal(saved.status, 'completed'); assert.equal(saved.review.rating, 5);
  checks.push('End-to-end: proposal, approval, receipt upload/download, completion and rating persisted in PostgreSQL');
  checked(await client.signOut()); assert.equal(checked(await client.getSession()), null);
  const restored = authAgent(); checked(await restored.signIn.email({ email: accounts[0].email, password }));
  const restoredToken = checked(await restored.token()).token;
  assert.equal((await request('/state', restoredToken)).body.tickets.find(t => t.id === id).status, 'completed');
  checks.push('Neon Auth: logout and fresh sign-in restore the persisted ticket');
  const forgedTrigger = await fetch(new URL('internal/retention', api), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-neon-trigger-invocation-id': 'forged' }, body: JSON.stringify({ version: 1, invocation_id: 'forged' }) });
  assert.equal(forgedTrigger.status, 401);
  checks.push('Retention endpoint rejects fabricated trigger requests');
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/neon-e2e-results.json', JSON.stringify({ branch: process.env.NEON_BRANCH, passed: true, checks }, null, 2));
  writeFileSync('artifacts/neon-test-access.json', JSON.stringify({ branch: process.env.NEON_BRANCH, client: accounts[0].email, specialist: accounts[1].email, password }, null, 2));
  for (const check of checks) console.log('PASS ' + check);
} finally { await pool.end(); }
