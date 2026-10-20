import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, act, activeCount, priceInCents, receiptConfirmed, proposalExpired, projectState, proposalAuthor } from '../public/domain.js';
import { readDraft, writeDraft, discardDraft } from '../public/drafts.js';
import { createApp } from '../server.mjs';

const NOW = '2026-10-19T13:00:00.000Z';
function setup(sector = 'advocacia', service = 'Direito criminal', pro = 'tayane') {
  const state = createState(NOW);
  const run = (who, action, payload = {}, now = NOW) => act(state, state.users.find(u => u.id === who), action, payload, { now, hour: 10 });
  const id = run('cliente', 'createTicket', { sector, service, city: 'Recife', region: 'PE', title: 'Solicitação fictícia', description: 'Descrição fictícia suficiente para testar as correções.', agreed: true }).ticketId;
  run(pro, 'accept', { ticketId: id });
  const ticket = state.tickets[0];
  const proposal = (amount = 100, extra = {}) => { run(pro, 'proposal', { ticketId: id, amount, scope: 'Serviço fictício para testar', deadline: '2 dias', terms: 'Na entrega', ...extra }); return ticket.proposals.at(-1); };
  const approve = p => run('cliente', 'proposalDecision', { ticketId: id, proposalId: p.id, decision: 'accepted' });
  const receipt = () => { run('cliente', 'upload', { ticketId: id, type: 'application/pdf', name: 'ficticio.pdf', data: 'JVBERi0=', receipt: true }); return ticket.threads[0].files.at(-1); };
  return { state, run, id, ticket, proposal, approve, receipt, pro };
}

test('rascunho é vinculado à sessão e é descartado no encerramento', () => {
  const values = new Map(); const storage = { getItem:k=>values.get(k), setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) };
  writeDraft(storage, 'cliente:sessao1', { description: 'Privado' });
  assert.equal(readDraft(storage, 'cliente:sessao1').description, 'Privado');
  assert.deepEqual(readDraft(storage, 'outro:sessao2'), {});
  assert.deepEqual(readDraft(storage, 'cliente:nova-sessao'), {});
  discardDraft(storage); assert.deepEqual(readDraft(storage, 'cliente:sessao1'), {});
});

test('aumento do orçamento exige conferência da nova versão e impede confirmação desatualizada', () => {
  const { run, ticket, id, proposal, approve, receipt } = setup();
  const p1 = proposal(100); approve(p1); const file = receipt();
  run('tayane', 'confirmReceipt', { ticketId: id, fileId: file.id, proposalId: p1.id });
  assert.equal(receiptConfirmed(file,p1), true);
  const p2 = proposal(1000); approve(p2);
  assert.equal(receiptConfirmed(file,p2), false);
  assert.throws(()=>run('tayane','confirmReceipt',{ticketId:id,fileId:file.id,proposalId:p1.id}), /proposta mudou/);
  run('tayane', 'startService', { ticketId:id }); run('tayane','deliver',{ticketId:id});
  assert.throws(()=>run('tayane','complete',{ticketId:id}), /proposta atual/);
  run('tayane','confirmReceipt',{ticketId:id,fileId:file.id,proposalId:p2.id});
  run('tayane','complete',{ticketId:id});
  assert.equal(ticket.status,'completed'); assert.equal(file.confirmations.length,2);
  assert.equal(file.confirmations[0].proposalId,p1.id); assert.equal(file.confirmations[1].amount,100000);
});

test('comprovantes antigos sem versão não autorizam conclusão até nova conferência', () => {
  const { run, ticket, id, proposal, approve, receipt }=setup(); const p=proposal(); approve(p); const f=receipt();
  f.confirmedAt=NOW; f.confirmedBy='tayane';
  run('tayane','startService',{ticketId:id});run('tayane','deliver',{ticketId:id});
  assert.throws(()=>run('tayane','complete',{ticketId:id}), /proposta atual/);
  run('tayane','confirmReceipt',{ticketId:id,fileId:f.id,proposalId:p.id}); run('tayane','complete',{ticketId:id});
  assert.equal(ticket.status,'completed');
});

test('suporte tratado encerra contratado, agenda e conversa e libera a vaga de forma idempotente', () => {
  const {state,run,id,ticket,proposal,approve}=setup();approve(proposal());
  run('tayane','appointment',{ticketId:id,date:'2026-10-22T13:00:00Z',location:'Reunião fictícia'});
  run('cliente','appointmentDecision',{ticketId:id,id:ticket.appointments[0].id,decision:'confirmed'});
  run('cliente','support',{ticketId:id,category:'Solicitar encerramento',message:'As partes pedem encerramento.'});
  const support=state.support[0], end='2026-10-19T14:00:00.000Z';
  assert.throws(()=>run('tayane','resolveSupport',{id:support.id}), /restrito/);
  run('bruno','resolveSupport',{id:support.id},end);
  assert.equal(ticket.status,'cancelled');assert.equal(ticket.closedAt,end);assert.equal(activeCount(state,'tayane'),0);
  assert.equal(ticket.appointments[0].status,'cancelled');assert.equal(ticket.threads[0].closedAt,end);
  assert.equal(support.resolvedBy,'bruno');assert.equal(support.resolvedAt,end);
  assert.throws(()=>run('bruno','resolveSupport',{id:support.id},'2026-10-20T13:00:00Z'), /já foi finalizado/);
  assert.equal(ticket.closedAt,end);
});

test('suporte geral não encerra chamados alheios e suporte de concluído preserva conclusão',()=>{
  const {state,run,id,ticket}=setup();
  run('cliente','support',{message:'Dúvida geral da plataforma.'});run('bruno','resolveSupport',{id:state.support[0].id});assert.equal(ticket.status,'conversation');
  ticket.status='completed';ticket.closedAt=NOW;ticket.threads[0].closedAt=NOW;
  run('cliente','support',{ticketId:id,message:'Dúvida sobre o serviço finalizado.'});run('bruno','resolveSupport',{id:state.support[0].id},'2026-10-20T13:00:00Z');
  assert.equal(ticket.status,'completed');assert.equal(ticket.closedAt,NOW);
});

test('especialista agenda desde o início e cliente cancela até contratar, com cancelamento da reunião',()=>{
  const {run,id,ticket,state}=setup();assert.equal(ticket.startedAt,NOW);
  assert.throws(()=>run('cliente','appointment',{ticketId:id,date:'2026-10-22T13:00:00Z',location:'Reunião fictícia'}), /especialista/);
  run('tayane','appointment',{ticketId:id,date:'2026-10-22T13:00:00Z',location:'Reunião fictícia'});
  run('cliente','appointmentDecision',{ticketId:id,id:ticket.appointments[0].id,decision:'confirmed'});
  run('tayane','message',{ticketId:id,text:'Podemos conversar sobre o escopo.'});run('cliente','cancel',{ticketId:id});
  assert.equal(ticket.status,'cancelled');assert.equal(ticket.appointments[0].status,'cancelled');assert.equal(activeCount(state,'tayane'),0);
  assert.throws(()=>run('cliente','appointmentDecision',{ticketId:id,id:ticket.appointments[0].id,decision:'confirmed'}), /indisponível/);
});

test('cancelamento direto após aprovação continua bloqueado e encerramento sem cobrança limpa agenda e propostas',()=>{
  const a=setup(); a.approve(a.proposal()); assert.throws(()=>a.run('cliente','cancel',{ticketId:a.id}), /contratação/);
  const b=setup();b.proposal();b.run('tayane','appointment',{ticketId:b.id,date:'2026-10-22T13:00:00Z',location:'Reunião fictícia'});
  b.run('tayane','closeNoCharge',{ticketId:b.id,reason:'Sem acordo entre as partes.'});
  assert.equal(b.ticket.proposals[0].status,'cancelled');assert.equal(b.ticket.appointments[0].status,'cancelled');
});

test('propostas vencem no instante limite e apenas versão atualizada pode ser aprovada',()=>{
  const {run,id,proposal,ticket}=setup();const p=proposal(100,{validityDays:1});
  assert.equal(p.expiresAt,'2026-10-20T13:00:00.000Z');
  assert.equal(proposalExpired(p,'2026-10-20T12:59:59.999Z'),false);
  assert.throws(()=>run('cliente','proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'},p.expiresAt), /venceu/);
  assert.equal(p.status,'pending');
  run('tayane','proposal',{ticketId:id,amount:100,scope:'Nova proposta válida atualizada',deadline:'2 dias',terms:'Na entrega',validityDays:1},'2026-10-21T13:00:00Z');
  const replacement=ticket.proposals.at(-1);
  run('cliente','proposalDecision',{ticketId:id,proposalId:replacement.id,decision:'accepted'},'2026-10-21T13:01:00Z');assert.equal(replacement.status,'accepted');
});

test('validades antigas numéricas migram, texto indeterminado exige nova proposta',()=>{
  const {run,id,proposal}=setup();const p=proposal(100,{validity:'1 dia'});delete p.expiresAt;
  assert.throws(()=>run('cliente','proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'},'2026-10-21T13:00:00Z'), /venceu/);
  p.validity='Prazo a combinar';assert.throws(()=>run('cliente','proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'}), /atualizada/);
});

test('valor é livremente negociado e configurações antigas de preço não impõem piso',()=>{
  const {state,run,id,proposal,ticket}=setup();
  state.proposalMinimums={advocacia:{default:100000,services:{'Direito criminal':200000}}};
  const p=proposal('0.01');run('cliente','proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'});
  assert.equal(ticket.status,'contracted');assert.equal(p.amount,1);
  assert.equal(Object.hasOwn(projectState(state,null),'proposalMinimums'),false);
  assert.throws(()=>run('bruno','setProposalMinimum',{sector:'advocacia',amount:100}), /Chamado não encontrado/);
});

test('cada assunto de todos os setores rejeita frações de centavo e aceita mínimo exato',()=>{
  for (const [sector,service,pro] of [['advocacia','Advocacia geral','miguel'],['advocacia','Direito criminal','tayane'],['engenharia','Projeto civil','marcos'],['engenharia','Vistoria e visita técnica','marcos'],['engenharia','Reforma e acompanhamento','marcos'],['ti','Suporte técnico','bruno'],['ti','Conserto de computador','bruno'],['ti','Montagem de PC','bruno'],['ti','Desenvolvimento de software','stefanny'],['ti','Engenharia de dados','kleber']]){
    const c=setup(sector,service,pro);assert.throws(()=>c.proposal(0.001), /duas casas/);const p=c.proposal('0.01');c.approve(p);assert.equal(p.amount,1);
  }
  for(const bad of [0,-1,0.001,true,null,'NaN','1e3',10000000.01]) assert.equal(priceInCents(bad),null);
  assert.equal(priceInCents('12.34'),1234);
});

test('API rejeita centavos inválidos e aprovação de proposta vencida sem alterar o estado', async t=>{
  let now=NOW;const app=createApp({database:':memory:',now:()=>now});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const agent=()=>{let cookie='',csrf='';return async(path,data)=>{const r=await fetch(origin+'/api'+path,{method:data?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const body=await r.json();csrf=body.csrf||csrf;return {status:r.status,body};};};
  const client=agent(),legal=agent(),admin=agent();await client('/auth/login',{login:'user',password:'123'});await legal('/auth/login',{login:'tayane',password:'123'});await admin('/auth/login',{login:'bruno',password:'123'});
  const action=(a,action,payload)=>a('/action',{action,payload});
  const id=(await action(client,'createTicket',{sector:'advocacia',service:'Direito criminal',region:'PE',city:'Recife',title:'Consulta fictícia',description:'Descrição de teste de segurança da API.',agreed:true})).body.result.ticketId;
  await action(legal,'accept',{ticketId:id});
  const base={ticketId:id,amount:0.001,scope:'Serviço fictício para testar',deadline:'2 dias',terms:'Na entrega',validityDays:1};
  assert.equal((await action(legal,'proposal',base)).status,400);assert.equal(app.load().tickets[0].proposals.length,0);
  await action(legal,'proposal',{...base,amount:100});const p=app.load().tickets[0].proposals[0];now=p.expiresAt;
  assert.equal((await action(client,'proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'})).status,409);assert.equal(app.load().tickets[0].status,'proposal');
  await action(client,'support',{ticketId:id,message:'Solicitar encerramento após a proposta.'});const support=app.load().support[0];
  assert.equal((await action(client,'resolveSupport',{id:support.id})).status,403);
  assert.equal((await action(admin,'resolveSupport',{id:support.id})).status,200);assert.equal(app.load().tickets[0].status,'cancelled');
  assert.equal(activeCount(app.load(),'tayane'),0);
});
