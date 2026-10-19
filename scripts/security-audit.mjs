// Local, synthetic audit. Does not contact Netlify or GitHub or alter the preview database.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';

export const credentials = {
  client: { name: 'Cliente Auditoria', email: 'cliente.auditoria@example.test', password: 'TesteLocal!2026' },
  legal: { name: 'Juridico Auditoria', email: 'juridico.auditoria@example.test', password: 'TesteLocal!2026' }
};
export async function context(database = ':memory:', { auxiliary = true } = {}) {
  let clock = '2026-10-19T13:00:00.000Z';
  const app = createApp({ database, now: () => clock });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  function agent() {
    let cookie = '', csrf = '';
    const request = async (path, data, headers = {}) => {
      const response = await fetch(origin + '/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const type = response.headers.get('content-type') || '';
      const body = type.includes('application/json') ? await response.json() : await response.text();
      if (body.csrf) csrf = body.csrf;
      return { status: response.status, body };
    };
    request.action = (action, payload = {}, headers) => request('/action', { action, payload }, headers);
    request.state = async () => (await request('/state')).body;
    return request;
  }
  const client = agent(), legal = agent(), admin = agent(), outsider = agent(), alternate = agent();
  for (const [a, c] of [[client, credentials.client], [legal, credentials.legal]]) {
    const existing = app.load().users.find(u => u.email === c.email);
    assert.equal((await a(existing ? '/auth/login' : '/auth/register', existing ? { login: c.email, password: c.password } : { ...c, agreed: true })).status, existing ? 200 : 201);
  }
  const clientId = (await client.state()).user.id, legalId = (await legal.state()).user.id;
  // No professional provisioning endpoint exists. Promote ONLY this synthetic fixture locally.
  app.transact(s => Object.assign(s.users.find(u => u.id === legalId), { role: 'professional', sector: 'advocacia', specialty: 'Advocacia geral — teste fictício', services: ['Advocacia geral'], regions: ['PE', 'Belem'], modalities: ['Remoto', 'Presencial'], bio: 'Perfil fictício exclusivo da auditoria local.' }));
  if (auxiliary) for (const [a, login] of [[admin, 'bruno'], [outsider, 'user'], [alternate, 'tayane']]) assert.equal((await a('/auth/login', { login, password: '123' })).status, 200);
  const ok = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r)); return r.body; };
  const ticket = async (title = 'Consulta jurídica fictícia', extra = {}) => (await ok(client.action('createTicket', { sector: 'advocacia', service: 'Advocacia geral', region: 'PE', city: 'Recife', title, description: 'Descrição inteiramente fictícia para auditoria do atendimento jurídico.', agreed: true, ...extra }))).result.ticketId;
  const get = async id => (await client.state()).tickets.find(t => t.id === id);
  const accept = async id => ok(legal.action('accept', { ticketId: id }));
  const proposal = async (id, amount = 150, extra = {}) => { await ok(legal.action('proposal', { ticketId: id, amount, scope: 'Orientação jurídica fictícia de auditoria', deadline: '2 dias', terms: 'Na entrega', validity: '7 dias', ...extra })); return (await get(id)).proposals.at(-1).id; };
  const approve = async (id, proposalId) => ok(client.action('proposalDecision', { ticketId: id, proposalId, decision: 'accepted' }));
  const upload = async (id, receipt = false, extra = {}) => { await ok(client.action('upload', { ticketId: id, name: 'documento-ficticio.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\nAuditoria ficticia, sem dados pessoais.').toString('base64'), receipt, ...extra })); return (await get(id)).threads.at(-1).files.at(-1).id; };
  return { app, origin, agent, client, legal, admin, outsider, alternate, clientId, legalId, ok, ticket, get, accept, proposal, approve, upload, setClock: t => clock = t };
}

async function main() {
  mkdirSync('artifacts/auditoria', { recursive: true });
  const evidence = [], cases = [];
  async function scenario(name, fn, persistent = false) {
    const db = persistent ? resolve(`data/auditoria-${Date.now()}.sqlite`) : ':memory:';
    const c = await context(db);
    try { await fn(c); cases.push({ name, status: 'executed', database: persistent ? db : undefined }); }
    catch (e) { cases.push({ name, status: 'harness-error', error: e.stack }); }
    finally { await c.app.close(); }
  }
  const finding = (id, observed) => evidence.push({ id, observed });

  await scenario('Jornada jurídica completa, autenticação, perfis, notificações, anexos, permissões e avaliação', async c => {
    const { client, legal, admin, outsider, agent, ok, ticket, get, accept, proposal, approve, upload, legalId } = c;
    const anonymous = agent();
    assert.equal((await anonymous.action('createTicket', {})).status, 401);
    assert.equal((await client.action('readNotifications', {}, { 'X-CSRF-Token': 'invalid' })).status, 403);
    assert.equal((await client.action('readNotifications', {}, { Origin: 'https://foreign.example.test' })).status, 403);
    await ok(client.action('profile', { name: 'Cliente Auditoria', city: 'Recife', region: 'PE', phone: '(81) 90000-0000', contactEmail: 'contato.auditoria@example.test', admin: true, role: 'professional' }));
    assert.equal((await client.state()).user.admin, false);
    assert.equal((await client.state()).user.role, 'client');
    assert.equal((await client.action('toggleProfessional', { id: legalId })).status, 403);
    assert.equal((await legal.action('profile', { contactEmail: 'invalid' })).status, 400);
    await ok(legal.action('profile', { available: false }));
    const id = await ticket('Jornada jurídica completa', { professionalId: 'bruno', createdAt: '2000-01-01', closedAt: '2000-01-02', modality: 'Remoto', preferences: 'descartar' });
    assert.equal((await legal.action('accept', { ticketId: id })).status, 403);
    await ok(legal.action('profile', { available: true })); await accept(id);
    assert.equal((await outsider.action('message', { ticketId: id, text: 'Invasão fictícia' })).status, 403);
    assert.equal((await admin.state()).tickets.some(t => t.id === id), false);
    assert.equal((await outsider.state()).tickets.some(t => t.id === id), false);
    await ok(legal.action('message', { ticketId: id, text: 'Atendimento jurídico de teste iniciado.' }));
    assert.equal((await outsider.action('cancel', { ticketId: id })).status, 403);
    assert.equal((await client.action('upload', { ticketId: id, type: 'application/pdf', data: Buffer.from('not pdf').toString('base64') })).status, 400);
    assert.equal((await client.action('upload', { ticketId: id, type: 'text/html', data: Buffer.from('<h1>teste</h1>').toString('base64') })).status, 400);
    const fileId = await upload(id);
    assert.equal((await client(`/files/${fileId}`)).status, 200);
    assert.equal((await legal(`/files/${fileId}`)).status, 200);
    assert.equal((await outsider(`/files/${fileId}`)).status, 404);
    assert.equal((await admin(`/files/${fileId}`)).status, 404);
    assert.equal((await anonymous(`/files/${fileId}`)).status, 401);
    const p1 = await proposal(id); await ok(client.action('proposalDecision', { ticketId: id, proposalId: p1, decision: 'declined' }));
    const p2 = await proposal(id, 250), p3 = await proposal(id, 300);
    assert.equal((await client.action('proposalDecision', { ticketId: id, proposalId: p2, decision: 'accepted' })).status, 409);
    await approve(id, p3);
    await ok(legal.action('appointment', { ticketId: id, date: '2026-10-22T17:00:00Z', location: 'Reunião fictícia' }));
    let appointmentId = (await get(id)).appointments.at(-1).id;
    assert.equal((await legal.action('appointmentDecision', { ticketId: id, id: appointmentId, decision: 'confirmed' })).status, 400);
    await ok(client.action('appointmentDecision', { ticketId: id, id: appointmentId, decision: 'declined' }));
    await ok(legal.action('appointment', { ticketId: id, date: '2026-10-23T17:00:00Z', location: 'Outra reunião fictícia' }));
    appointmentId = (await get(id)).appointments.at(-1).id;
    await ok(client.action('appointmentDecision', { ticketId: id, id: appointmentId, decision: 'confirmed' }));
    await ok(legal.action('startService', { ticketId: id }));
    assert.equal((await legal.action('complete', { ticketId: id })).status, 400);
    await ok(legal.action('deliver', { ticketId: id }));
    assert.equal((await legal.action('complete', { ticketId: id })).status, 400);
    const receiptId = await upload(id, true);
    await ok(legal.action('confirmReceipt', { ticketId: id, fileId: receiptId, proposalId: p3 }));
    c.setClock('2026-10-19T14:00:00.000Z'); await ok(legal.action('complete', { ticketId: id }));
    assert.equal((await legal.action('review', { ticketId: id, rating: 5 })).status, 400);
    assert.equal((await client.action('review', { ticketId: id, rating: 6 })).status, 400);
    await ok(client.action('review', { ticketId: id, rating: 4, comment: 'Avaliação fictícia.', professionalId: 'bruno' }));
    assert.equal((await get(id)).review.professionalId, legalId);
    assert.equal((await client.action('review', { ticketId: id, rating: 5 })).status, 400);
    assert.equal((await client.action('message', { ticketId: id, text: 'Mensagem após encerramento' })).status, 400);
    const t = await get(id); assert.equal(t.createdAt, '2026-10-19T13:00:00.000Z'); assert.equal(t.closedAt, '2026-10-19T14:00:00.000Z');
    await ok(client.action('readNotifications')); assert.ok((await client.state()).notifications.every(n => n.read));
    await ok(client('/auth/logout', {})); assert.equal((await client.state()).user, null);
    evidence.push({ id: 'FLOW', ticketId: id, code: t.code, status: t.status, createdAt: t.createdAt, closedAt: t.closedAt, assertions: 'Cadastro, privilégios, CSRF, IDOR, documentos, propostas, agenda, pagamento, avaliação e logout verificados' });
  }, true);

  await scenario('Capacidade, concorrência, cancelamento, transferência e isolamento', async c => {
    const { ticket, legal, client, alternate, admin, accept, ok, upload, get, legalId } = c;
    const a = await ticket('Primeiro atendimento'), b = await ticket('Segundo atendimento'), d = await ticket('Terceiro atendimento');
    await accept(a); await accept(b); assert.equal((await legal.action('accept', { ticketId: d })).status, 409);
    await ok(client.action('cancel', { ticketId: b }));
    await ok(legal.action('message', { ticketId: a, text: 'Segredo fictício da primeira conversa' })); const f = await upload(a);
    await ok(client.action('release', { ticketId: a, reason: 'Não houve acordo de teste' }));
    assert.equal((await legal.action('accept', { ticketId: a })).status, 403);
    await ok(alternate.action('accept', { ticketId: a }));
    assert.equal((await alternate(`/files/${f}`)).status, 404);
    assert.equal(JSON.stringify(await alternate.state()).includes('Segredo fictício'), false);
    assert.equal((await legal.action('message', { ticketId: a, text: 'Não deve entrar na nova conversa' })).status, 403);
    await ok(alternate.action('closeNoCharge', { ticketId: a, reason: 'Encerramento de teste sem cobrança' }));
    const race = await Promise.all([legal.action('accept', { ticketId: d }), alternate.action('accept', { ticketId: d })]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    await ok(admin.action('toggleProfessional', { id: legalId })); assert.equal((await legal.action('readNotifications')).status, 401);
    await ok(admin.action('toggleProfessional', { id: legalId }));
    assert.equal((await legal.action('readNotifications')).status, 200);
    finding('SESSION-REACTIVATION', 'A sessão anterior à suspensão volta a funcionar após reativação; sem novo login.');
  });

  await scenario('Confirmação de pagamento após mudança da proposta', async c => {
    const id = await c.ticket(); await c.accept(id); await c.approve(id, await c.proposal(id, 100));
    const f = await c.upload(id, true); await c.ok(c.legal.action('confirmReceipt', { ticketId: id, fileId: f, proposalId: (await c.get(id)).proposals[0].id }));
    await c.approve(id, await c.proposal(id, 1000));
    await c.ok(c.legal.action('startService', { ticketId: id })); await c.ok(c.legal.action('deliver', { ticketId: id }));
    const blocked = await c.legal.action('complete', { ticketId: id }); assert.equal(blocked.status, 400);
    await c.ok(c.legal.action('confirmReceipt', {ticketId:id,fileId:f,proposalId:(await c.get(id)).proposals.at(-1).id}));
    const result = await c.legal.action('complete', {ticketId:id}); assert.equal(result.status,200);
    finding('PAYMENT-VERSION', { priorAmount: 100, newAmount: 1000, staleConfirmationBlocked: true, reconfirmed: true, completeStatus: result.status, status: (await c.get(id)).status });
  });

  await scenario('Agendamento como primeira interação e agenda após cancelamento', async c => {
    const id = await c.ticket(); await c.accept(id);
    await c.ok(c.legal.action('appointment', { ticketId: id, date: '2026-10-23T17:00:00Z', location: 'Reunião jurídica fictícia' }));
    const a = (await c.get(id)).appointments[0]; await c.ok(c.client.action('appointmentDecision', { ticketId: id, id: a.id, decision: 'confirmed' }));
    assert.ok((await c.get(id)).startedAt);
    const result = await c.client.action('cancel', { ticketId: id }); assert.equal(result.status, 200);
    const t = await c.get(id); assert.equal(t.appointments[0].status,'cancelled');
    finding('APPOINTMENT-CANCEL', { startedAt: t.startedAt, cancelledAfterProfessionalScheduling: result.status, ticketStatus: t.status, appointmentStatus: t.appointments[0].status });
  });

  await scenario('Encerramento após contrato via suporte', async c => {
    const id = await c.ticket(); await c.accept(id); await c.approve(id, await c.proposal(id));
    for (const [a, action] of [[c.client, 'cancel'], [c.client, 'release'], [c.legal, 'closeNoCharge']]) assert.equal((await a.action(action, { ticketId: id, reason: 'As partes desistiram do serviço' })).status, 400);
    await c.ok(c.client.action('support', { ticketId: id, category: 'Solicitar encerramento', message: 'As duas partes desistiram, favor cancelar o atendimento contratado.' }));
    const supportId = (await c.client.state()).support[0].id;
    assert.equal((await c.client.action('resolveSupport', { id: supportId })).status, 403);
    await c.ok(c.admin.action('resolveSupport', { id: supportId }));
    const t = await c.get(id), pro = (await c.legal.state()).user;
    assert.equal(t.status,'cancelled');assert.equal(pro.activeCount,0);
    finding('SUPPORT-DEADEND', { support: (await c.client.state()).support[0].status, ticket: t.status, closedAt: t.closedAt, occupiedSlots: pro.activeCount });
  });

  await scenario('Validade e valor mínimo das propostas', async c => {
    const id = await c.ticket(); await c.accept(id); const p = await c.proposal(id, 100, { validity: '1 dia' });
    c.setClock('2026-10-28T13:00:00.000Z'); assert.equal((await c.client.action('proposalDecision',{ticketId:id,proposalId:p,decision:'accepted'})).status,409);
    finding('PROPOSAL-EXPIRY', { validity: '1 dia', elapsedDays: 9, expiredApprovalBlocked:true, proposalStatus: (await c.get(id)).proposals[0].status });
    assert.equal((await c.legal.action('proposal',{ticketId:id,amount:0.001,scope:'Proposta fictícia de teste',deadline:'2 dias',terms:'Na entrega'})).status,400);
    finding('ZERO-CENTS', 'POST proposal amount=0.001 é rejeitado com HTTP 400.');
  });

  await scenario('Retenção e recuperação demonstrativa', async c => {
    const id = await c.ticket(); await c.accept(id); await c.ok(c.legal.action('message', { ticketId: id, text: 'Mensagem fictícia a expurgar' })); const f = await c.upload(id);
    await c.ok(c.legal.action('closeNoCharge', { ticketId: id, reason: 'Fim do teste de retenção' }));
    c.setClock('2026-11-18T12:59:59.999Z'); assert.equal((await c.client(`/files/${f}`)).status, 200);
    c.setClock('2026-11-18T13:00:00.000Z'); assert.equal((await c.client(`/files/${f}`)).status, 404); assert.equal((await c.get(id)).threads[0].messages.length, 0);
    const anonymous = c.agent(); const token = (await anonymous('/auth/recover', { email: credentials.client.email })).body.demoToken;
    assert.ok(token); await c.ok(anonymous('/auth/reset', { token, password: 'NovaSenhaFicticia!2026' }));
    assert.equal((await c.client.state()).user, null);
    await c.ok(anonymous('/auth/login', { login: credentials.client.email, password: 'NovaSenhaFicticia!2026' }));
    finding('DEMO-RESET', 'No modo demo, um solicitante anônimo recebe o token e redefine a conta apenas sabendo o e-mail (comportamento simulado já documentado).');
  });

  await scenario('Limite de tentativas de login', async c => {
    const anonymous = c.agent(); const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await anonymous('/auth/login', { login: credentials.client.email, password: 'errada' })).status);
    assert.ok(statuses.includes(429)); evidence.push({ id: 'RATE-LIMIT', statuses });
  });

  await scenario('Limites de anexos e de solicitações; acesso a arquivos internos', async c => {
    const id = await c.ticket(); await c.accept(id);
    const base = { ticketId: id, type: 'application/pdf', name: 'teste.pdf', data: Buffer.from('%PDF-1.4\nTeste').toString('base64') };
    for (let i = 0; i < 15; i++) await c.ok(c.client.action('upload', base));
    assert.equal((await c.client.action('upload', base)).status, 400);
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 65); oversized.write('%PDF-');
    assert.equal((await c.client.action('upload', { ...base, data: oversized.toString('base64') })).status, 400);
    for (let i = 0; i < 9; i++) await c.ticket('Limite de chamados ' + i);
    assert.equal((await c.client.action('createTicket', { sector: 'advocacia', service: 'Advocacia geral', region: 'PE', city: 'Recife', title: 'Décimo primeiro chamado', description: 'Solicitação fictícia para testar limite de chamados.', agreed: true })).status, 400);
    for (const path of ['/server.mjs', '/%2e%2e%5cserver.mjs', '/data/mvp.sqlite', '/.git/config']) {
      const r = await fetch(c.origin + path); const content = await r.text();
      assert.ok(!content.includes('CREATE TABLE') && !content.includes('[remote "origin"]') && !content.startsWith('SQLite format 3'), path);
    }
    evidence.push({ id: 'LIMITS', maxAttachments: 15, maxFileBytes: 2097152, maxOpenClientTickets: 10, internalFilesExposed: false });
  });

  const result = { auditedAt: new Date().toISOString(), environment: 'local, synthetic, no remote calls', credentials, cases, evidence };
  writeFileSync('artifacts/auditoria/api-retest-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (cases.some(c => c.status === 'harness-error')) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/security-audit.mjs')) await main();
