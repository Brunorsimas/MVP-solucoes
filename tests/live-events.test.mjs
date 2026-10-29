import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore } from '../lib/postgres-store.mjs';
import { createNeonHandler } from '../lib/neon-api.mjs';
import { createLiveEvents, LIVE_CHANNEL } from '../lib/live-events.mjs';
import { createLiveUpdates } from '../public/live-updates.js';

const origin = 'https://app.example.test';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Fixed sleeps made this file flaky under load: poll instead of guessing.
const until = async (condition, label) => {
  for (let waited = 0; waited < 2000; waited += 5) { if (condition()) return; await delay(5); }
  throw Error('Tempo esgotado: ' + label);
};
const timeout = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Live event timeout')), 2000); })]); }
  finally { clearTimeout(timer); }
};

test('SSE: usuários autenticados recebem eventos entre instâncias, sem conteúdo privado, e logout revoga conexão', async t => {
  const pool = await embeddedPostgres();
  const store = createPostgresStore(pool); await store.init();
  const source = { subscribe: callback => pool.listen(LIVE_CHANNEL, callback) };
  const first = createLiveEvents(source, { heartbeatMs: 40 }), second = createLiveEvents(source, { heartbeatMs: 40, perUser: 1 });
  const readers = [];
  t.after(async () => { first.close(); second.close(); for (const reader of readers) await reader.cancel().catch(() => {}); await pool.close(); });
  const options = { store, origins: [origin], authUrl: 'https://auth.example.test/auth', verify: async () => { throw Error(); }, testLoginEnabled: true, simulatedHour: 10 };
  const handler = createNeonHandler({ ...options, live: first }), otherInstance = createNeonHandler({ ...options, store: createPostgresStore(pool), live: second });
  const call = (path, token, data, target = handler, requestOrigin = origin) => target(new Request('https://api.example.test/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: requestOrigin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) }));
  const login = async name => (await (await call('/auth/test-login', null, { login: name, password: '123' })).json()).token;
  const client = await login('user'), pro = await login('bruno'), outsider = await login('tayane');
  assert.equal((await call('/events')).status, 401);
  assert.equal((await call('/events', 'mvp-test-' + '0'.repeat(64))).status, 401);
  assert.equal((await call('/events', client, undefined, handler, 'https://evil.example.test')).status, 403);
  async function stream(token, target) {
    const response = await call('/events', token, undefined, target);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const reader = response.body.getReader(); readers.push(reader);
    const next = async event => { for (;;) { const value = await timeout(reader.read()); if (value.done) throw Error('Stream closed'); const text = new TextDecoder().decode(value.value); if (text.includes(`event: ${event}\n`)) return text; } };
    await next('ready'); return { reader, next };
  }
  const receiving = await stream(client, handler), sending = await stream(pro, otherInstance), foreign = await stream(outsider, handler);
  assert.equal((await call('/events', pro, undefined, otherInstance)).status, 429);
  const created = await (await call('/action', client, { action: 'createTicket', payload: { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Chat em tempo real', description: 'Chamado fictício para testar entrega imediata entre instâncias.', agreed: true } })).json();
  const ticketId = created.result.ticketId;
  await receiving.next('change'); await sending.next('change'); await foreign.next('change');
  assert.equal((await call('/action', pro, { action: 'accept', payload: { ticketId } }, otherInstance)).status, 200);
  await receiving.next('change'); await foreign.next('change');
  assert.equal((await call('/action', pro, { action: 'message', payload: { ticketId, text: 'SEGREDO DA CONVERSA' } }, otherInstance)).status, 200);
  const signal = await receiving.next('change'), foreignSignal = await foreign.next('change');
  assert.equal(signal, 'event: change\ndata: {}\n\n'); assert.equal(foreignSignal, signal);
  assert.equal(foreignSignal.includes(ticketId), false); assert.equal(foreignSignal.includes('SEGREDO'), false);
  const own = await (await call('/state', client)).json(), other = await (await call('/state', outsider)).json();
  assert.ok(own.tickets[0].threads[0].messages.some(m => m.text === 'SEGREDO DA CONVERSA'));
  assert.equal(JSON.stringify(other).includes('SEGREDO'), false);
  await call('/auth/logout', client, {});
  await receiving.next('auth'); assert.equal((await receiving.reader.read()).done, true);
});

test('PostgreSQL: notificação só é emitida no commit; rollback e gravação idêntica não notificam', async t => {
  const pool = await embeddedPostgres(); t.after(() => pool.close());
  const store = createPostgresStore(pool); await store.init();
  const events = [], stop = await pool.listen(LIVE_CHANNEL, () => events.push('change'));
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("UPDATE mvp_state SET content=jsonb_set(content,'{probe}','true') WHERE id=1");
      assert.equal(events.length, 0); await client.query('ROLLBACK');
      assert.equal(events.length, 0);
      await client.query('BEGIN'); await client.query("UPDATE mvp_state SET content=jsonb_set(content,'{probe}','true') WHERE id=1");
      assert.equal(events.length, 0); await client.query('COMMIT');
    } finally { client.release(); }
    await until(() => events.length === 1, 'notificação após o commit');
    await pool.query('UPDATE mvp_state SET content=content WHERE id=1'); await delay(50); assert.equal(events.length, 1);
  } finally { await stop(); }
});

test('Cliente SSE: interpreta frames fragmentados, reconecta e para ao sair, sem renovar sessão negada', async t => {
  const encoder = new TextEncoder(), connections = [], updates = [], statuses = [];
  let unauthorized = 0;
  const live = createLiveUpdates({ retryMs: 5, fetchEvents: async signal => {
    const stream = new ReadableStream({ start(controller) { connections.push(controller); signal.addEventListener('abort', () => { try { controller.error(Error('abort')); } catch {} }, { once: true }); } });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }, onUpdate: () => updates.push('update'), onUnauthorized: () => unauthorized++, onStatus: value => statuses.push(value) });
  t.after(() => live.stop());
  live.start('user:session'); await until(() => connections.length === 1, 'primeira conexão');
  connections[0].enqueue(encoder.encode('event: rea')); connections[0].enqueue(encoder.encode('dy\ndata: {}\n\nevent: heartbeat\ndata: {}\n\n'));
  await until(() => updates.length === 1, 'frame fragmentado'); assert.equal(live.status, 'connected');
  connections[0].enqueue(encoder.encode('event: change\ndata: {}\n\n')); await until(() => updates.length === 2, 'evento change');
  connections[0].close(); await until(() => connections.length === 2, 'reconexão');
  connections[1].enqueue(encoder.encode('event: ready\ndata: {}\n\n')); await until(() => updates.length === 3, 'ready após reconectar');
  live.stop(); await until(() => live.status === 'stopped', 'parada'); await delay(20); assert.equal(connections.length, 2);
  const rejected = createLiveUpdates({ fetchEvents: async () => new Response('{}', { status: 401 }), onUpdate() {}, onUnauthorized: () => unauthorized++ });
  rejected.start('old:session'); await until(() => unauthorized === 1, 'sessão negada'); rejected.stop();
  assert.ok(statuses.includes('reconnecting'));
});
