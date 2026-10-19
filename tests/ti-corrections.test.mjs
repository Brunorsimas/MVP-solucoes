import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, act, normalizeState, projectState } from '../public/domain.js';
import { createApp } from '../server.mjs';
const NOW = '2026-10-19T13:00:00.000Z';
const attachment = { type: 'application/pdf', name: 'proposta.pdf', data: Buffer.from('%PDF-1.4\nFicticio').toString('base64') };
const input = { sector:'ti', service:'Suporte técnico', region:'PE', city:'Recife', title:'Correções do atendimento de TI', description:'Descrição fictícia para testar os novos fluxos.', agreed:true };
function setup() {
  const state=createState(NOW), user=id=>state.users.find(u=>u.id===id);
  const run=(id,action,payload={},now=NOW)=>act(state,user(id),action,payload,{hour:10,now});
  const id=run('cliente','createTicket',input).ticketId;run('bruno','accept',{ticketId:id});
  const t=state.tickets[0];
  const offer=(extra={})=>{run('bruno','proposal',{ticketId:id,amount:150,scope:'Suporte técnico fictício',deadline:'2 dias',terms:'Na entrega',...extra});return t.proposals.at(-1);};
  const approve=p=>run('cliente','proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'});
  const schedule=(extra={})=>{run('bruno','appointment',{ticketId:id,date:'2026-10-22T13:00:00Z',location:'Local fictício',...extra});return t.appointments.at(-1);};
  const decision=(a,decision='confirmed')=>run('cliente','appointmentDecision',{ticketId:id,id:a.id,decision});
  return {state,user,run,id,t,offer,approve,schedule,decision};
}

test('15 documentos não impedem comprovantes, conferência e conclusão',()=>{
  const c=setup(),p=c.offer();c.approve(p);
  for(let i=0;i<15;i++)c.run('cliente','upload',{ticketId:c.id,...attachment});
  assert.throws(()=>c.run('bruno','upload',{ticketId:c.id,...attachment}),/15 anexos comuns/);
  const f=c.run('cliente','upload',{ticketId:c.id,...attachment,receipt:true}).fileId;
  assert.equal(c.t.threads[0].files.length,16);
  assert.throws(()=>c.run('bruno','upload',{ticketId:c.id,...attachment,receipt:true}),/Comprovantes/);
  c.run('bruno','confirmReceipt',{ticketId:c.id,fileId:f,proposalId:p.id});
  c.run('bruno','startService',{ticketId:c.id});c.run('bruno','deliver',{ticketId:c.id});c.run('bruno','complete',{ticketId:c.id});
  assert.equal(c.t.status,'completed');
});

test('proposta e documento são atômicos também no domínio estático',()=>{
  const c=setup();
  const snapshot=()=>JSON.stringify(c.state);
  for(const extra of [{scope:'curto'},{amount:0},{validityDays:0},{attachment:{...attachment,data:'ZmFsc28='}}]) {
    const before=snapshot();assert.throws(()=>c.offer({attachment,...extra}));assert.equal(snapshot(),before);
  }
  for(const source of ['form','document']) {
    const p=c.offer({source,attachment});assert.equal(c.t.threads[0].files.at(-1).id,p.fileId);
    assert.equal(c.t.threads[0].files.at(-1).receipt,false);assert.equal('data' in p,false);
  }
  for(let i=2;i<15;i++)c.run('cliente','upload',{ticketId:c.id,...attachment});
  const before=snapshot();assert.throws(()=>c.offer({attachment}),/15 anexos comuns/);assert.equal(snapshot(),before);
});

test('reagendamento recusado preserva original; confirmado substitui e guarda vínculo',()=>{
  const c=setup(),original=c.schedule();c.decision(original);
  const refused=c.schedule({replacesId:original.id});assert.equal(original.status,'confirmed');
  assert.throws(()=>c.schedule({replacesId:original.id}),/Já existe/);
  c.decision(refused,'declined');assert.equal(original.status,'confirmed');
  const replacement=c.schedule({replacesId:original.id,date:'2026-10-23T14:00:00Z'});c.decision(replacement);
  assert.equal(original.status,'superseded');assert.equal(original.supersededBy,replacement.id);
  assert.equal(replacement.status,'confirmed');assert.equal(c.t.appointments.filter(a=>a.status==='confirmed').length,1);
  assert.throws(()=>c.decision(replacement),/indisponível/);
});

test('ambas as partes cancelam encontros com motivo sem fechar chamado; cancelar original cancela reagendamento pendente',()=>{
  const c=setup(),original=c.schedule();c.decision(original);const replacement=c.schedule({replacesId:original.id});
  assert.throws(()=>c.run('cliente','cancelAppointment',{ticketId:c.id,id:original.id,reason:'x'}),/motivo/);
  c.run('cliente','cancelAppointment',{ticketId:c.id,id:original.id,reason:'Cancelamento combinado entre as partes'});
  assert.equal(original.status,'cancelled');assert.equal(replacement.status,'cancelled');assert.equal(c.t.status,'conversation');
  assert.throws(()=>c.decision(replacement),/indisponível/);
  const next=c.schedule();c.run('bruno','cancelAppointment',{ticketId:c.id,id:next.id,reason:'Imprevisto informado no chat'});
  assert.equal(next.cancelledBy,'bruno');assert.ok(c.state.notifications.some(n=>n.userId==='cliente'&&n.title==='Agendamento cancelado'));
});

test('cancelar apenas a proposta de novo horário preserva o anterior',()=>{
  const c=setup(),original=c.schedule();c.decision(original);const replacement=c.schedule({replacesId:original.id});
  c.run('bruno','cancelAppointment',{ticketId:c.id,id:replacement.id,reason:'Manter o horário anterior'});
  assert.equal(original.status,'confirmed');assert.equal(replacement.status,'cancelled');
});

test('transferência expõe só observação; visão do especialista anterior fica congelada',()=>{
  const c=setup();c.run('cliente','message',{ticketId:c.id,text:'CONVERSA PRIVADA BRUNO'});c.offer();
  c.run('cliente','release',{ticketId:c.id,reason:'Sem acordo sobre o prazo de entrega'});
  const historical=projectState(c.state,c.user('bruno')).tickets[0];assert.equal(historical.status,'released');
  const queue=projectState(c.state,c.user('kleber')).tickets[0];
  assert.equal(queue.releaseNote.reason,'Sem acordo sobre o prazo de entrega');assert.deepEqual(queue.threads,[]);assert.equal(queue.proposals,undefined);
  c.run('kleber','accept',{ticketId:c.id});c.run('kleber','message',{ticketId:c.id,text:'CONVERSA PRIVADA KLEBER'});
  c.run('kleber','closeNoCharge',{ticketId:c.id,reason:'MOTIVO PRIVADO KLEBER'},'2026-10-20T13:00:00Z');
  assert.deepEqual(projectState(c.state,c.user('bruno')).tickets[0],historical);
  const current=projectState(c.state,c.user('kleber')).tickets[0];assert.equal(current.threads.length,1);
  assert.equal(JSON.stringify(current).includes('CONVERSA PRIVADA BRUNO'),false);
  assert.equal(current.releaseNote.reason,'Sem acordo sobre o prazo de entrega');
});

test('terceira transferência não revela nova observação aos especialistas anteriores nem permite reaceite',()=>{
  const c=setup();c.run('cliente','release',{ticketId:c.id,reason:'PRIMEIRA OBSERVACAO'});
  const before=projectState(c.state,c.user('bruno')).tickets[0];
  c.run('kleber','accept',{ticketId:c.id});c.run('cliente','release',{ticketId:c.id,reason:'SEGUNDA OBSERVACAO'});
  assert.deepEqual(projectState(c.state,c.user('bruno')).tickets[0],before);
  assert.throws(()=>c.run('bruno','accept',{ticketId:c.id}),/compatível/);
  assert.equal(c.state.tickets[0].status,'waiting');
});

test('encerramento cancela propostas pendentes e encontros futuros; migração é idempotente',()=>{
  const c=setup(),p=c.offer();c.approve(p);const pending=c.offer({amount:200});
  const old=c.schedule({date:'2026-10-19T14:00:00Z'});c.decision(old);
  const future=c.schedule({date:'2026-10-25T14:00:00Z'});c.decision(future);
  const unconfirmed=c.schedule({date:'2026-10-26T14:00:00Z'});
  const f=c.run('cliente','upload',{ticketId:c.id,...attachment,receipt:true}).fileId;
  c.run('bruno','confirmReceipt',{ticketId:c.id,fileId:f,proposalId:p.id});c.run('bruno','startService',{ticketId:c.id});c.run('bruno','deliver',{ticketId:c.id});
  c.run('bruno','complete',{ticketId:c.id},'2026-10-20T13:00:00Z');
  assert.equal(p.status,'accepted');assert.equal(pending.status,'cancelled');assert.equal(old.status,'closed');assert.equal(future.status,'cancelled');assert.equal(unconfirmed.status,'cancelled');
  assert.throws(()=>c.run('cliente','proposalDecision',{ticketId:c.id,proposalId:pending.id,decision:'accepted'}),/encerrado/);
  // Simulate pre-fix data already closed on disk, then normalize twice.
  pending.status='pending';future.status='confirmed';unconfirmed.status='pending';
  normalizeState(c.state);assert.equal(pending.status,'cancelled');assert.equal(future.status,'cancelled');
  const once=JSON.stringify(c.state);normalizeState(c.state);assert.equal(JSON.stringify(c.state),once);
});

test('API: rollback de proposta+arquivo, concorrência pela quota e autorização de agendamento',async t=>{
  const app=createApp({database:':memory:',now:()=>NOW});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}/api`;
  const agent=()=>{let cookie='',csrf='';return async(path,data)=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',cookie,'X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const body=await r.json();if(body.csrf)csrf=body.csrf;return {status:r.status,body};};};
  const client=agent(),pro=agent(),other=agent();for(const [a,login]of [[client,'user'],[pro,'bruno'],[other,'kleber']])await a('/auth/login',{login,password:'123'});
  const action=(a,name,payload)=>a('/action',{action:name,payload});
  const id=(await action(client,'createTicket',input)).body.result.ticketId;await action(pro,'accept',{ticketId:id});
  const offer={ticketId:id,amount:100,scope:'Escopo de teste atômico',deadline:'2 dias',terms:'Na entrega',attachment};
  for(const extra of [{scope:'curto'},{amount:0},{attachment:{...attachment,data:'ZmFsc28='}}]) {
    const before=JSON.stringify(app.load());assert.equal((await action(pro,'proposal',{...offer,...extra})).status,400);assert.equal(JSON.stringify(app.load()),before);
  }
  for(let i=0;i<14;i++)assert.equal((await action(client,'upload',{ticketId:id,...attachment})).status,200);
  const race=await Promise.all([action(pro,'proposal',offer),action(pro,'proposal',offer)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
  const ticket=app.load().tickets[0];assert.equal(ticket.threads[0].files.length,15);assert.equal(ticket.proposals.length,1);
  await action(client,'proposalDecision',{ticketId:id,proposalId:ticket.proposals[0].id,decision:'accepted'});
  assert.equal((await action(client,'upload',{ticketId:id,...attachment,receipt:true})).status,200);
  await action(pro,'appointment',{ticketId:id,date:'2026-10-22T13:00:00Z',location:'Local fictício'});
  const appointment=app.load().tickets[0].appointments[0];
  assert.equal((await action(other,'cancelAppointment',{ticketId:id,id:appointment.id,reason:'Sem autorização'})).status,403);
  assert.equal((await action(client,'appointment',{ticketId:id,replacesId:appointment.id,date:'2026-10-23T13:00:00Z',location:'Local fictício'})).status,403);
  assert.equal((await action(pro,'appointment',{ticketId:id,replacesId:'de-outro-chamado',date:'2026-10-23T13:00:00Z',location:'Local fictício'})).status,409);
});
