import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import netlifyProxy from '../netlify/functions/api.mjs';

assert.equal(process.env.NEON_BRANCH, 'production');
const api = process.env.NEON_FUNCTION_HELLO_BASE_URL, authBase = process.env.NEON_AUTH_BASE_URL;
const cookies = new Map();
async function auth(path, data) {
  const r = await fetch(authBase + path, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: 'http://127.0.0.1:4189', 'Content-Type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: data === undefined ? undefined : JSON.stringify(data) });
  for (const c of r.headers.getSetCookie()) { const part = c.split(';')[0], split = part.indexOf('='); cookies.set(part.slice(0, split), part.slice(split + 1)); }
  const result = await r.json(); assert.equal(r.ok, true, result?.message); return result;
}
async function request(path, token, data) {
  const r = await fetch(new URL('api' + path, api), { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: r.status, body: await r.json() };
}
const email = `mvp-smoke-${Date.now()}@example.test`, password = randomBytes(20).toString('base64url');
const publicState = await request('/state'); assert.equal(publicState.status, 200); assert.equal(publicState.body.config.authProvider, 'neon'); assert.equal(publicState.body.config.simulatedHour, null);
await auth('/sign-up/email', { name: 'Cliente de validação Neon', email, password, callbackURL: 'http://127.0.0.1:4189' });
const { token } = await auth('/token'); assert.ok(token);
const view = await request('/state', token); assert.equal(view.body.user.email, email); assert.equal(view.body.user.role, 'client');
const proxy = await netlifyProxy(new Request('http://127.0.0.1:4189/api/state', { headers: { Authorization: `Bearer ${token}` } }), { ip: 'test' }); assert.equal(proxy.status, 200); assert.equal((await proxy.json()).user.id, view.body.user.id);
const created = await request('/action', token, { action: 'createTicket', payload: { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Validação inicial Neon', description: 'Chamado fictício para conferir a persistência na branch production.', agreed: true } });
let ticketId;
if (publicState.body.config.open) {
  assert.equal(created.status, 200, JSON.stringify(created.body)); ticketId = created.body.result.ticketId;
  const cancelled = await request('/action', token, { action: 'cancel', payload: { ticketId } }); assert.equal(cancelled.status, 200);
} else { assert.equal(created.status, 400); assert.match(created.body.error, /8h às 19h/); }
const connection = new URL(process.env.DATABASE_URL_UNPOOLED); connection.searchParams.set('sslmode', 'verify-full');
const pool = new Pool({ connectionString: connection.toString(), connectionTimeoutMillis: 15000 });
try {
  const state = (await pool.query('SELECT content FROM mvp_state WHERE id=1')).rows[0].content;
  assert.ok(state.users.some(u => u.id === view.body.user.id && u.email === email));
  if (ticketId) assert.equal(state.tickets.find(t => t.id === ticketId).status, 'cancelled');
} finally { await pool.end(); }
await auth('/sign-out', {}); assert.equal(await auth('/get-session'), null);
await auth('/sign-in/email', { email, password, callbackURL: 'http://127.0.0.1:4189' });
assert.equal((await auth('/get-session')).user.email, email);
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/neon-production-access.json', JSON.stringify({ email, password }, null, 2));
writeFileSync('artifacts/neon-production-results.json', JSON.stringify({ passed: true, branch: 'production', services: ['Postgres', 'Neon Auth', 'Functions'], checks: ['public state', 'signup', 'JWT-protected state', 'Netlify forwarding code', 'PostgreSQL persistence', ticketId ? 'ticket create and cancel' : 'business hours enforced', 'logout and sign-in'], simulatedHour: null }, null, 2));
console.log('PASS production: Postgres persistence, Neon Auth signup/login/logout, JWT-protected Function and Netlify forwarding code.');
console.log(ticketId ? 'PASS production: ticket created, cancelled and persisted.' : 'PASS production: requests outside business hours are rejected.');
