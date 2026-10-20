import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,act,proposalAuthor,receiptConfirmed,purgeExpired,projectState} from '../public/domain.js';
import {createApp} from '../server.mjs';
const NOW='2026-10-19T13:00:00Z';
function setup(){
 const state=createState(NOW);const run=(id,action,payload,now=NOW)=>act(state,state.users.find(u=>u.id===id),action,payload,{now,hour:10});
 const id=run('cliente','createTicket',{sector:'advocacia',service:'Direito criminal',region:'PE',city:'Recife',title:'Consulta fictícia',description:'Descrição fictícia para negociar um valor.',agreed:true}).ticketId;run('tayane','accept',{ticketId:id});
 const payload={ticketId:id,amount:50,scope:'Escopo fictício para teste',deadline:'2 dias',terms:'Na entrega',validityDays:7};
 const offer=(author='cliente',extra={})=>{run(author,'proposal',{...payload,...extra});return state.tickets[0].proposals.at(-1);};
 const decide=(who,p,decision='accepted')=>run(who,'proposalDecision',{ticketId:id,proposalId:p.id,decision});
 const upload=(who='cliente',receipt=false)=>run(who,'upload',{ticketId:id,type:'application/pdf',name:'proposta-ficticia.pdf',data:Buffer.from('%PDF-1.4\nDocumento ficticio').toString('base64'),receipt}).fileId;
 return {state,run,id,payload,offer,decide,upload,ticket:state.tickets[0]};
}
test('cliente envia proposta, não aprova a própria e especialista pode aceitar',()=>{
 const c=setup();const p=c.offer();assert.equal(proposalAuthor(p),'cliente');
 assert.throws(()=>c.decide('cliente',p), /outra parte/);assert.throws(()=>c.decide('cliente',p,'declined'), /outra parte/);
 c.decide('tayane',p);assert.equal(p.decidedBy,'tayane');assert.equal(c.ticket.status,'contracted');
 assert.ok(c.state.notifications.some(n=>n.userId==='cliente'&&n.title==='Proposta aprovada'));
 c.run('tayane','startService',{ticketId:c.id});c.run('tayane','deliver',{ticketId:c.id});
 const f=c.upload('cliente',true);c.run('tayane','confirmReceipt',{ticketId:c.id,fileId:f,proposalId:p.id});c.run('tayane','complete',{ticketId:c.id});assert.equal(c.ticket.status,'completed');
});
test('contraproposta substitui a pendente e só a outra parte decide',()=>{
 const c=setup();const first=c.offer('tayane');const counter=c.offer('cliente',{amount:35.5});assert.equal(first.status,'superseded');
 assert.throws(()=>c.decide('cliente',counter), /outra parte/);assert.throws(()=>c.decide('tayane',first), /disponível/);
 c.decide('tayane',counter,'declined');assert.equal(c.ticket.status,'conversation');
 const final=c.offer('cliente',{amount:40});c.decide('tayane',final);assert.equal(final.amount,4000);
});
test('proposta por documento registra valor, autor, arquivo e aprovação sem exigir formulário detalhado',()=>{
 const c=setup();const f=c.upload();const p=c.offer('cliente',{source:'document',fileId:f,scope:'',deadline:'',terms:''});
 assert.equal(p.fileId,f);assert.equal(p.source,'document');assert.match(p.scope,/Conforme documento/);c.decide('tayane',p);
 assert.equal(p.status,'accepted');assert.equal(p.professionalId,'tayane');
});
test('documento é opcional no formulário e obrigatório no modo documento',()=>{
 const c=setup();assert.throws(()=>c.offer('cliente',{source:'document'}), /Anexe o documento/);
 const f=c.upload();const p=c.offer('cliente',{fileId:f});assert.equal(p.source,'form');assert.equal(p.fileId,f);
});
test('não é possível vincular documento de outra pessoa, conversa anterior ou comprovante',()=>{
 const c=setup();const f=c.upload('tayane');assert.throws(()=>c.offer('cliente',{source:'document',fileId:f}), /documento seu/);
 const p=c.offer('tayane');c.decide('cliente',p);const receipt=c.upload('cliente',true);assert.throws(()=>c.offer('cliente',{source:'document',fileId:receipt}), /documento seu/);
 const before=setup();const old=before.upload();before.run('cliente','release',{ticketId:before.id,reason:'Sem acordo, encaminhar novamente.'});
 before.state.users.push({...structuredClone(before.state.users.find(u=>u.id==='tayane')),id:'criminal-alternativo',username:'criminal-alternativo'});
 before.run('criminal-alternativo','accept',{ticketId:before.id});
 assert.throws(()=>before.offer('cliente',{source:'document',fileId:old}), /documento seu/);
});
test('proposta do cliente vence, e nova versão exige nova conferência do pagamento',()=>{
 const c=setup();const p=c.offer();c.decide('tayane',p);const f=c.upload('cliente',true);c.run('tayane','confirmReceipt',{ticketId:c.id,fileId:f,proposalId:p.id});
 const p2=c.offer('cliente',{amount:60,validityDays:1});assert.throws(()=>c.run('tayane','proposalDecision',{ticketId:c.id,proposalId:p2.id,decision:'accepted'},'2026-10-20T13:00:00Z'),/venceu/);
 const p3=c.offer('cliente',{amount:60});c.decide('tayane',p3);assert.equal(receiptConfirmed(c.ticket.threads[0].files.find(x=>x.id===f),p3),false);
});
test('documentos de proposta seguem retenção e não são copiados para os registros de proposta',()=>{
 const c=setup();const f=c.upload();const p=c.offer('cliente',{source:'document',fileId:f});c.run('cliente','cancel',{ticketId:c.id});
 purgeExpired(c.state,'2026-11-18T13:00:00Z');assert.equal(c.ticket.threads[0].files.length,0);assert.equal(p.fileId,f);assert.equal(Object.hasOwn(p,'data'),false);
});
test('versões antigas sem authorId continuam atribuídas ao especialista',()=>{
 const c=setup();const p=c.offer('tayane');delete p.authorId;
 assert.equal(proposalAuthor(p),'tayane');assert.throws(()=>c.decide('tayane',p), /outra parte/);c.decide('cliente',p);assert.equal(p.status,'accepted');
});
test('somente participantes podem propor e decidir e preços continuam válidos em centavos',()=>{
 const c=setup();assert.throws(()=>c.run('miguel','proposal',c.payload), /não participa/);
 assert.throws(()=>c.offer('cliente',{amount:0.001}), /duas casas/);assert.throws(()=>c.offer('cliente',{amount:-50}), /positivo/);
 const p=c.offer('cliente',{amount:'0.01'});assert.equal(p.amount,1);assert.throws(()=>c.decide('bruno',p), /não participa/);
});
test('API permite proposta do cliente com documento e aprovação só do especialista',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const agent=()=>{let cookie='',csrf='';return async(path,data)=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const body=await r.json();csrf=body.csrf||csrf;return{status:r.status,body};};};
 const client=agent(),legal=agent();await client('/auth/login',{login:'user',password:'123'});await legal('/auth/login',{login:'tayane',password:'123'});const a=(agent,action,payload)=>agent('/action',{action,payload});
 const id=(await a(client,'createTicket',{sector:'advocacia',service:'Direito criminal',region:'PE',city:'Recife',title:'Proposta de teste',description:'Consulta fictícia com proposta do cliente.',agreed:true})).body.result.ticketId;
 await a(legal,'accept',{ticketId:id});const file=(await a(client,'upload',{ticketId:id,name:'oferta.pdf',type:'application/pdf',data:Buffer.from('%PDF-1.4\nOferta ficticia').toString('base64')})).body.result.fileId;assert.ok(file);
 assert.equal((await a(client,'proposal',{ticketId:id,source:'document',fileId:file,amount:25,validityDays:7})).status,200);
 const p=(await client('/state')).body.tickets[0].proposals[0];assert.equal((await a(client,'proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'})).status,403);assert.equal((await a(legal,'proposalDecision',{ticketId:id,proposalId:p.id,decision:'accepted'})).status,200);
 assert.equal((await legal('/state')).body.tickets[0].status,'contracted');
});
