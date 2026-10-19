import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
const payload = { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Notebook com defeito', description: 'Descrição fictícia com detalhes suficientes para o teste.', agreed: true };
test('API: sessão, CSRF, aceite concorrente, isolamento e fluxo completo', async t => {
  const app = createApp({ database: ':memory:' }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  function agent() {
    let cookie = '', csrf = '';
    return async (path, data, extra = {}) => {
      const response = await fetch(origin + '/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie, 'X-CSRF-Token': csrf, ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
      const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
      const body = await response.json(); if (body.csrf) csrf = body.csrf;
      return { status: response.status, body };
    };
  }
  const client = agent(), bruno = agent(), kleber = agent(), outsider = agent();
  assert.equal((await outsider('/action', { action: 'createTicket', payload })).status, 401);
  await client('/auth/login', { login: 'user', password: '123' }); await bruno('/auth/login', { login: 'bruno', password: '123' }); await kleber('/auth/login', { login: 'kleber', password: '123' }); await outsider('/auth/login', { login: 'maria', password: '123' });
  assert.equal((await client('/action', { action: 'createTicket', payload }, { 'X-CSRF-Token': 'invalid' })).status, 403);
  assert.equal((await client('/action', { action: 'createTicket', payload }, { Origin: 'https://evil.test' })).status, 403);
  const ticketId = (await client('/action', { action: 'createTicket', payload })).body.result.ticketId;
  assert.equal((await client('/state')).body.tickets.find(t => t.id === ticketId).modality, 'A combinar');
  const attempts = await Promise.all([bruno('/action', { action: 'accept', payload: { ticketId } }), kleber('/action', { action: 'accept', payload: { ticketId } })]);
  assert.deepEqual(attempts.map(a => a.status).sort(), [200, 409]);
  const winner = attempts[0].status === 200 ? bruno : kleber;
  assert.equal((await outsider('/action', { action: 'message', payload: { ticketId, text: 'Não permitido' } })).status, 403);
  assert.equal((await winner('/action', { action: 'proposal', payload: { ticketId, amount: 150, scope: 'Configurar computador de teste', deadline: '2 dias', terms: 'Na entrega' } })).status, 200);
  const ticket = (await client('/state')).body.tickets.find(t => t.id === ticketId);
  assert.equal((await client('/action', { action: 'proposalDecision', payload: { ticketId, proposalId: ticket.proposals[0].id, decision: 'accepted' } })).status, 200);
  await winner('/action', { action: 'startService', payload: { ticketId } }); await winner('/action', { action: 'deliver', payload: { ticketId } });
  assert.equal((await client('/action', { action: 'upload', payload: { ticketId, name: 'fake.pdf', type: 'application/pdf', data: Buffer.from('not a pdf').toString('base64'), receipt: true } })).status, 400);
  assert.equal((await client('/action', { action: 'upload', payload: { ticketId, name: 'comprovante.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\nfictional receipt').toString('base64'), receipt: true } })).status, 200);
  const file = (await client('/state')).body.tickets.find(t => t.id === ticketId).threads[0].files[0];
  assert.equal((await outsider(`/files/${file.id}`)).status, 404);
  await winner('/action', { action: 'confirmReceipt', payload: { ticketId, fileId: file.id } });
  assert.equal((await winner('/action', { action: 'complete', payload: { ticketId } })).status, 200);
  assert.equal((await client('/state')).body.tickets[0].status, 'completed');
  assert.equal((await client('/action', { action: 'message', payload: { ticketId, text: 'Encerrado' } })).status, 400);
  const html = await fetch(origin); assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy'), /object-src 'none'/); assert.match(await html.text(), /MVP Soluções/);
});
test('API: todas as contas temporárias exigem senha e o modo normal as desativa', async t => {
  const app = createApp({ database: ':memory:' }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const post = (path, data) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await post('/auth/login', { login: 'user', password: 'errada' })).status, 401);
  assert.equal((await post('/auth/demo', { id: 'bruno' })).status, 401);
  for (const login of ['user', 'tayane', 'miguel', 'feuzer', 'marcos', 'maria', 'bruno', 'stefanny', 'kleber']) assert.equal((await post('/auth/login', { login, password: '123' })).status, 200, login);
  const normal = createApp({ database: ':memory:', demo: false }); await new Promise(resolve => normal.server.listen(0, '127.0.0.1', resolve)); t.after(() => normal.close());
  const response = await fetch(`http://127.0.0.1:${normal.server.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'bruno', password: '123' }) });
  assert.equal(response.status, 401);
});
test('API: cadastro, login, recuperação e invalidação de sessões', async t => {
  const app = createApp({ database: ':memory:' }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const post = async (path, data) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }; };
  const register = await post('/auth/register', { name: 'Cliente Teste', email: 'teste@example.test', password: 'senha-de-teste-123', agreed: true }); assert.equal(register.status, 201);
  const account = app.db.prepare('SELECT * FROM accounts').get(); assert.notEqual(account.hash, 'senha-de-teste-123');
  assert.equal((await post('/auth/login', { email: 'teste@example.test', password: 'errada' })).status, 401);
  assert.equal((await post('/auth/login', { email: 'teste@example.test', password: 'senha-de-teste-123' })).status, 200);
  const recover = await post('/auth/recover', { email: 'teste@example.test' }); assert.ok(recover.data.demoToken);
  assert.equal((await post('/auth/reset', { token: recover.data.demoToken, password: 'senha-nova-12345' })).status, 200);
  assert.equal((await post('/auth/reset', { token: recover.data.demoToken, password: 'senha-nova-12345' })).status, 400);
  const view = await fetch(base + '/state', { headers: { cookie: register.cookie } }); assert.equal((await view.json()).user, null);
  assert.equal((await post('/auth/login', { email: 'teste@example.test', password: 'senha-nova-12345' })).status, 200);
});
test('API: atualização da conta preserva login e logout invalida a sessão', async t => {
  const app = createApp({ database: ':memory:' }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  let cookie = '', csrf = '';
  async function request(path, data) {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', cookie, 'X-CSRF-Token': csrf }, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json();
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (result.csrf) csrf = result.csrf;
    return { status: response.status, result };
  }
  await request('/auth/login', { login: 'user', password: '123' });
  const update = await request('/action', { action: 'profile', payload: { name: 'user', phone: '(81) 90000-1234', contactEmail: 'contato@example.test', region: 'PE', city: 'Recife' } });
  assert.equal(update.status, 200);
  const saved = (await request('/state')).result.user;
  assert.equal(saved.phone, '(81) 90000-1234'); assert.equal(saved.contactEmail, 'contato@example.test'); assert.equal(saved.username, 'user');
  const oldCookie = cookie;
  assert.equal((await request('/auth/logout', {})).status, 200);
  assert.equal((await request('/state')).result.user, null);
  const previousSession = await fetch(base + '/state', { headers: { cookie: oldCookie } }); assert.equal((await previousSession.json()).user, null);
  assert.equal((await request('/action', { action: 'profile', payload: { name: 'Outra pessoa' } })).status, 401);
});
