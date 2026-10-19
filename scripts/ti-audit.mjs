// Local synthetic audit. Main accounts: user and bruno. No public service is contacted.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../server.mjs';
const cases = [], findings = [], actions = new Set();
const initial = '2026-10-19T13:00:00.000Z';
async function context() {
  let now = initial;
  const app = createApp({ database: ':memory:', now: () => now });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  function agent() {
    let cookie = '', csrf = '';
    const request = async (path, data, headers = {}) => {
      const r = await fetch(origin + '/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie, 'X-CSRF-Token': csrf, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
      if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      const body = r.headers.get('content-type')?.includes('application/json') ? await r.json() : await r.text();
      if (body.csrf) csrf = body.csrf;
      return { status: r.status, body };
    };
    request.state = async () => (await request('/state')).body;
    request.action = (name, payload = {}, headers) => { actions.add(name); return request('/action', { action: name, payload }, headers); };
    request.cookie = () => cookie;
    return request;
  }
  const client = agent(), pro = agent(), other = agent(), outsider = agent();
  const ok = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r)); return r.body; };
  for (const [a, login] of [[client, 'user'], [pro, 'bruno'], [other, 'kleber'], [outsider, 'tayane']]) await ok(a('/auth/login', { login, password: '123' }));
  const base = { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Computador fictício com problema', description: 'Descrição fictícia suficiente para avaliar o suporte de TI.', details: 'Equipamento de teste sem dados reais.', agreed: true };
  const ticket = async (extra = {}) => (await ok(client.action('createTicket', { ...base, ...extra }))).result.ticketId;
  const get = async id => (await client.state()).tickets.find(t => t.id === id);
  const accept = id => ok(pro.action('accept', { ticketId: id }));
  const upload = async (id, receipt = false, who = client, extra = {}) => (await ok(who.action('upload', { ticketId: id, type: 'application/pdf', name: 'documento-ficticio.pdf', data: Buffer.from('%PDF-1.4\nDocumento ficticio').toString('base64'), receipt, ...extra }))).result.fileId;
  const proposal = async (id, amount = 150, who = pro, extra = {}) => { await ok(who.action('proposal', { ticketId: id, amount, scope: 'Diagnóstico fictício do computador de teste.', terms: 'Na entrega', deadline: '2 dias', validityDays: 7, ...extra })); return (await get(id)).proposals.at(-1).id; };
  const approve = (id, proposalId, who = client) => ok(who.action('proposalDecision', { ticketId: id, proposalId, decision: 'accepted' }));
  const complete = async id => {
    await ok(pro.action('startService', { ticketId: id })); await ok(pro.action('deliver', { ticketId: id }));
    const fileId = await upload(id, true), proposalId = (await get(id)).proposals.find(p => p.status === 'accepted').id;
    await ok(pro.action('confirmReceipt', { ticketId: id, fileId, proposalId })); await ok(pro.action('complete', { ticketId: id }));
  };
  return { app, origin, agent, client, pro, other, outsider, ok, base, ticket, get, accept, upload, proposal, approve, complete, clock: value => now = value };
}
async function scenario(name, fn) {
  const c = await context();
  try { const details = await fn(c); cases.push({ name, passed: true, details }); }
  catch (e) { cases.push({ name, passed: false, error: e.stack }); process.exitCode = 1; }
  finally { await c.app.close(); }
}
function finding(id, severity, observed) { findings.push({ id, severity, observed }); }

await scenario('Fluxo user/Bruno: leitura prévia, negociação, agenda, execução, pagamento e avaliação', async c => {
  const id = await c.ticket();
  const preview = (await c.pro.state()).tickets.find(t => t.id === id);
  assert.equal(preview.description, c.base.description); assert.equal(preview.startedAt, null); assert.deepEqual(preview.threads, []);
  assert.equal((await c.outsider.state()).tickets.some(t => t.id === id), false);
  await c.accept(id);
  await c.ok(c.client.action('message', { ticketId: id, text: 'Mensagem fictícia do cliente.' }));
  await c.ok(c.pro.action('message', { ticketId: id, text: 'Diagnóstico fictício de TI.' }));
  const f = await c.upload(id);
  assert.equal((await c.pro(`/files/${f}`)).status, 200); assert.equal((await c.other(`/files/${f}`)).status, 404);
  const p1 = await c.proposal(id, 100, c.client, { source: 'document', fileId: f });
  assert.equal((await c.client.action('proposalDecision', { ticketId: id, proposalId: p1, decision: 'accepted' })).status, 403);
  await c.ok(c.pro.action('proposalDecision', { ticketId: id, proposalId: p1, decision: 'declined' }));
  const p2 = await c.proposal(id, 150); await c.approve(id, p2);
  for (const decision of ['declined', 'confirmed']) {
    await c.ok(c.pro.action('appointment', { ticketId: id, date: '2026-10-20T15:00:00Z', location: 'Atendimento fictício remoto' }));
    const a = (await c.get(id)).appointments.at(-1);
    await c.ok(c.client.action('appointmentDecision', { ticketId: id, id: a.id, decision }));
    assert.equal((await c.client.action('appointmentDecision', { ticketId: id, id: a.id, decision })).status, 400);
  }
  c.clock('2026-10-20T17:00:00Z'); await c.complete(id);
  assert.equal((await c.get(id)).createdAt, initial); assert.equal((await c.get(id)).closedAt, '2026-10-20T17:00:00Z');
  assert.equal((await c.client.action('message', { ticketId: id, text: 'Após conclusão' })).status, 400);
  await c.ok(c.client.action('review', { ticketId: id, rating: 4, comment: 'Avaliação fictícia de TI.' }));
  assert.equal((await c.client.action('review', { ticketId: id, rating: 5 })).status, 400);
  await c.ok(c.client.action('readNotifications')); await c.ok(c.pro.action('readNotifications'));
  assert.ok((await c.pro.state()).notifications.every(n => n.read));
  return { code: (await c.get(id)).code, status: (await c.get(id)).status, professional: 'bruno', rating: 4 };
});

await scenario('Segurança: contatos, permissões, CSRF, logout e arquivos internos', async c => {
  const anon = c.agent();
  await c.ok(c.client.action('profile', { phone: '(81) 95555-5555', contactEmail: 'cliente.privado@example.test', admin: true, role: 'professional', id: 'bruno' }));
  assert.equal((await c.client.state()).user.role, 'client'); assert.equal((await c.client.state()).user.admin, false);
  for (const who of [anon, c.pro, c.other, c.outsider]) assert.equal(JSON.stringify(await who.state()).includes('cliente.privado@example.test'), false);
  assert.equal((await anon.action('profile', { name: 'Intruso' })).status, 401);
  assert.equal((await c.client.action('profile', { name: 'Intruso' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await c.client.action('profile', { name: 'Intruso' }, { Origin: 'https://foreign.example.test' })).status, 403);
  const id = await c.ticket(); await c.ok(c.other.action('accept', { ticketId: id }));
  const f = await c.upload(id);
  assert.equal((await c.pro(`/files/${f}`)).status, 404); // Bruno's admin flag does not grant chat access.
  assert.equal((await c.pro.state()).tickets.some(t => t.id === id), false);
  assert.equal((await c.outsider.action('message', { ticketId: id, text: 'Tentativa não autorizada' })).status, 403);
  for (const path of ['/server.mjs', '/data/mvp.sqlite', '/%2e%2e%5cserver.mjs', '/.git/config']) {
    const content = await fetch(c.origin + path).then(r => r.text());
    assert.ok(!content.includes('CREATE TABLE') && !content.startsWith('SQLite format 3') && !content.includes('[remote "origin"]'));
  }
  const oldCookie = c.client.cookie(); await c.ok(c.client('/auth/logout', {}));
  assert.equal((await fetch(c.origin + '/api/state', { headers: { cookie: oldCookie } }).then(r => r.json())).user, null);
});

await scenario('Capacidade 2/3, disponibilidade, concorrência, cancelamento e suporte', async c => {
  const ids = []; for (let i=0;i<5;i++) ids.push(await c.ticket({ title: 'Capacidade de TI ' + i }));
  await c.ok(c.pro.action('profile', { available: false })); assert.equal((await c.pro.action('accept', { ticketId: ids[0] })).status, 403);
  await c.ok(c.pro.action('profile', { available: true })); await c.accept(ids[0]); await c.accept(ids[1]);
  assert.equal((await c.pro.action('accept', { ticketId: ids[2] })).status, 409);
  await c.ok(c.pro.action('profile', { phone: '(81) 90000-0000', contactEmail: 'bruno.ficticio@example.test', region: 'PE', city: 'Recife', bio: 'Especialista fictício para teste de perfil completo.' }));
  assert.equal((await c.pro.state()).user.capacity, 3);
  const race = await Promise.all(ids.slice(2,4).map(ticketId => c.pro.action('accept', { ticketId })));
  assert.deepEqual(race.map(r=>r.status).sort(), [200,409]);
  await c.ok(c.pro.action('profile', { phone: '' })); assert.equal((await c.pro.state()).user.activeCount,3);
  await c.ok(c.client.action('cancel', { ticketId: ids[0] }));
  await c.approve(ids[1], await c.proposal(ids[1]));
  assert.equal((await c.client.action('cancel', { ticketId: ids[1] })).status, 400);
  await c.ok(c.client.action('support', { ticketId: ids[1], category: 'Solicitar encerramento', message: 'Cancelar atendimento fictício contratado por acordo.' }));
  const s=(await c.client.state()).support[0]; assert.equal((await c.client.action('resolveSupport',{id:s.id})).status,403);
  await c.ok(c.pro.action('resolveSupport',{id:s.id})); assert.equal((await c.get(ids[1])).status,'cancelled');
  assert.equal((await c.pro.state()).user.activeCount,1);
  await c.ok(c.pro.action('accept',{ticketId:ids[4]}));
  await c.ok(c.pro.action('closeNoCharge',{ticketId:ids[4],reason:'Sem cobrança no teste de encerramento.'}));
});

await scenario('Pagamento antigo, propostas vencidas e formatos de valores', async c => {
  const id=await c.ticket();await c.accept(id);
  for(const amount of [0,-1,0.001,'NaN']) assert.equal((await c.pro.action('proposal',{ticketId:id,amount,scope:'Escopo de teste',deadline:'2 dias',terms:'Na entrega'})).status,400);
  const expired=await c.proposal(id,100,c.pro,{validityDays:1});c.clock('2026-10-20T13:00:00.000Z');
  assert.equal((await c.client.action('proposalDecision',{ticketId:id,proposalId:expired,decision:'accepted'})).status,409);
  const first=await c.proposal(id,100);await c.approve(id,first);const fileId=await c.upload(id,true);
  await c.ok(c.pro.action('confirmReceipt',{ticketId:id,fileId,proposalId:first}));
  const next=await c.proposal(id,1000);await c.approve(id,next);
  await c.ok(c.pro.action('startService',{ticketId:id}));await c.ok(c.pro.action('deliver',{ticketId:id}));
  assert.equal((await c.pro.action('complete',{ticketId:id})).status,400);
  assert.equal((await c.pro.action('confirmReceipt',{ticketId:id,fileId,proposalId:first})).status,409);
  await c.ok(c.pro.action('confirmReceipt',{ticketId:id,fileId,proposalId:next}));await c.ok(c.pro.action('complete',{ticketId:id}));
});

await scenario('Correção: comprovante e conclusão disponíveis após quinze anexos', async c => {
  const id=await c.ticket();await c.accept(id);await c.approve(id,await c.proposal(id));
  for(let i=0;i<15;i++)await c.upload(id,false,c.client,{name:'diagnostico-'+i+'.pdf'});
  await c.ok(c.pro.action('startService',{ticketId:id}));await c.ok(c.pro.action('deliver',{ticketId:id}));
  const receipt=await c.client.action('upload',{ticketId:id,type:'application/pdf',name:'pagamento.pdf',data:Buffer.from('%PDF-1.4\nPago ficticio').toString('base64'),receipt:true});
  assert.equal(receipt.status,200);
  const proposalId=(await c.get(id)).proposals[0].id;
  await c.ok(c.pro.action('confirmReceipt',{ticketId:id,fileId:receipt.body.result.fileId,proposalId}));
  const finish=await c.pro.action('complete',{ticketId:id});assert.equal(finish.status,200);
  return { fixed:'TI-01', files:16, status:(await c.get(id)).status, occupiedSlots:(await c.pro.state()).user.activeCount };
});

await scenario('Correção: reagendamento substitui o horário anterior', async c => {
  const id=await c.ticket();await c.accept(id);
  for(const date of ['2026-10-21T13:00:00Z','2026-10-22T14:00:00Z']){
    const replacesId=(await c.get(id)).appointments.at(-1)?.id;
    await c.ok(c.pro.action('appointment',{ticketId:id,date,location:'Reagendamento fictício combinado no chat',replacesId}));
    await c.ok(c.client.action('appointmentDecision',{ticketId:id,id:(await c.get(id)).appointments.at(-1).id,decision:'confirmed'}));
  }
  const appointments=(await c.get(id)).appointments;assert.equal(appointments.filter(a=>a.status==='confirmed').length,1);assert.equal(appointments[0].status,'superseded');
  assert.equal((await c.client.action('appointmentDecision',{ticketId:id,id:appointments[0].id,decision:'declined'})).status,400);
  await c.ok(c.client.action('cancel',{ticketId:id}));assert.equal((await c.get(id)).appointments[1].status,'cancelled');
  return { fixed:'TI-03', original:'superseded', replacement:'cancelled on closure' };
});

await scenario('Correção: conclusão encerra proposta pendente e reunião futura', async c => {
  const id=await c.ticket();await c.accept(id);await c.approve(id,await c.proposal(id));
  await c.ok(c.pro.action('appointment',{ticketId:id,date:'2026-10-25T16:00:00Z',location:'Reunião futura de teste'}));
  await c.ok(c.client.action('appointmentDecision',{ticketId:id,id:(await c.get(id)).appointments[0].id,decision:'confirmed'}));
  await c.proposal(id,200);await c.complete(id);
  const ticket=await c.get(id);assert.equal(ticket.proposals.at(-1).status,'cancelled');assert.equal(ticket.appointments[0].status,'cancelled');
  assert.equal((await c.client.action('proposalDecision',{ticketId:id,proposalId:ticket.proposals.at(-1).id,decision:'accepted'})).status,400);
  return { fixed:'TI-04',ticketStatus:ticket.status,pendingProposal:ticket.proposals.at(-1).status,appointment:ticket.appointments[0].status,approvalAfterClosureBlocked:true };
});

await scenario('Transferência: conversa privada e metadados posteriores isolados', async c => {
  const id=await c.ticket();await c.accept(id);await c.ok(c.client.action('message',{ticketId:id,text:'SEGREDO_ANTERIOR_TI'}));const file=await c.upload(id);
  await c.ok(c.client.action('release',{ticketId:id,reason:'Sem acordo no teste de TI'}));await c.ok(c.other.action('accept',{ticketId:id}));
  assert.equal((await c.other(`/files/${file}`)).status,404);
  assert.equal(JSON.stringify(await c.other.state()).includes('SEGREDO_ANTERIOR_TI'),false);
  await c.ok(c.other.action('message',{ticketId:id,text:'NOVA_CONVERSA_TI'}));
  await c.ok(c.other.action('closeNoCharge',{ticketId:id,reason:'Motivo reservado do novo atendimento'}));
  const previous=(await c.pro.state()).tickets.find(t=>t.id===id);assert.equal(previous.closeReason,'Sem acordo no teste de TI');assert.equal(previous.professionalId,'bruno');assert.equal(previous.status,'released');
  assert.equal(JSON.stringify(previous).includes('NOVA_CONVERSA_TI'),false);
  return { fixed:'P05',formerSpecialist:'bruno',visibleStatus:previous.status,newMessagesVisible:false };
});

await scenario('Falha: sessão suspensa volta após reativação sem autenticação', async c => {
  const oldCookie=c.other.cookie();await c.ok(c.pro.action('toggleProfessional',{id:'kleber'}));
  assert.equal((await c.other.action('readNotifications')).status,401);
  await c.ok(c.pro.action('toggleProfessional',{id:'kleber'}));
  assert.equal((await c.other.action('readNotifications')).status,200);assert.equal(c.other.cookie(),oldCookie);
  finding('TI-05','média segurança',{suspendedRequest:401,reactivatedSameSession:200,newLoginRequired:false});
});

await scenario('Anexos inválidos, limites, retenção e limite de tentativas', async c => {
  const id=await c.ticket();await c.accept(id);
  assert.equal((await c.client.action('upload',{ticketId:id,type:'application/pdf',name:'falso.pdf',data:Buffer.from('not pdf').toString('base64')})).status,400);
  const large=Buffer.alloc(2*1024*1024+1,65);large.write('%PDF-');
  assert.equal((await c.client.action('upload',{ticketId:id,type:'application/pdf',name:'grande.pdf',data:large.toString('base64')})).status,400);
  const file=await c.upload(id);await c.ok(c.pro.action('closeNoCharge',{ticketId:id,reason:'Teste fictício de retenção'}));
  c.clock('2026-11-18T12:59:59.999Z');assert.equal((await c.client(`/files/${file}`)).status,200);
  c.clock('2026-11-18T13:00:00.000Z');assert.equal((await c.client(`/files/${file}`)).status,404);
  assert.equal((await c.get(id)).threads[0].messages.length,0);
  const anon=c.agent();let statuses=[];for(let i=0;i<11;i++)statuses.push((await anon('/auth/login',{login:'user',password:'errada'})).status);
  assert.ok(statuses.includes(429));
});

mkdirSync('artifacts/auditoria',{recursive:true});
const report={at:new Date().toISOString(),environment:'isolated local synthetic data',primaryAccounts:['user','bruno'],auxiliaryAccounts:['kleber','tayane'],cases,actions:[...actions].sort(),findings};
writeFileSync('artifacts/auditoria/ti-api-retest-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
