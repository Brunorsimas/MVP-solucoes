import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createApp} from '../server.mjs';
import {act} from '../public/domain.js';
const debug=`http://127.0.0.1:${process.env.CDP_PORT||9333}`, errors=[], checks=[], tabs=[];
async function tab(){
 const target=await fetch(debug+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let seq=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=async expression=>{const end=Date.now()+12000;do{if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}while(Date.now()<end);throw new Error('Timeout: '+expression);};
 const fill=(selector,values)=>evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});for(const [k,v] of Object.entries(${JSON.stringify(values)})){f.elements[k].value=v;f.elements[k].dispatchEvent(new Event('input',{bubbles:true}));}})()`);
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
 const nav=async route=>{await evaluate(`location.hash=${JSON.stringify(route)}`);await new Promise(r=>setTimeout(r,150));};
 const submit=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
 const login=async login=>{await nav('/entrar');await wait('!!document.querySelector("#auth-form")');await fill('#auth-form',{login,password:'123'});await submit('#auth-form');await wait(`document.querySelector('.user-trigger strong')?.textContent.toLowerCase()===${JSON.stringify(login)}`);};
 await send('Runtime.enable');await send('Page.enable');const result={send,evaluate,wait,fill,click,nav,submit,login,target,socket};tabs.push(result);return result;
}
let clock='2026-10-19T13:00:00.000Z';const app=createApp({database:':memory:',now:()=>clock});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const staticServer=http.createServer((req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve('dist','.'+(path==='/'?'/index.html':path));assert.ok(file.startsWith(resolve('dist')+'\\')||file.startsWith(resolve('dist')+'/'));res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'text/plain'});res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
try{
 for(const [mode,port]of [['local',app.server.address().port],['static',staticServer.address().port]]){
  const a=await tab(),b=await tab(),origin=`http://127.0.0.1:${port}`;
  await a.send('Page.navigate',{url:origin});await a.wait('!!document.querySelector(".hero")');
  // A legacy unscoped draft must never be loaded by the new app.
  await a.evaluate('localStorage.setItem("mvp-draft",JSON.stringify({description:"LEGACY-SECRET"}))');await a.send('Page.reload');await a.wait('!!document.querySelector(".hero")');
  await a.login('user');await a.nav('/novo?setor=advocacia');await a.wait('!!document.querySelector("#request-form")');
  await a.fill('#request-form',{service:'Direito criminal',region:'PE',city:'Recife'});await a.submit('#request-form');await a.wait('!!document.querySelector("#description")');
  assert.equal(await a.evaluate('document.querySelector("#description").value'),'');
  await a.fill('#request-form',{title:'Rascunho privado',description:'TAB-PRIVATE-SECRET: não pode aparecer em outra conta.'});
  await a.send('Page.reload');await a.wait('!!document.querySelector("#request-form")');await a.submit('#request-form');await a.wait('!!document.querySelector("#description")');
  assert.match(await a.evaluate('document.querySelector("#description").value'),/TAB-PRIVATE-SECRET/);
  await b.send('Page.navigate',{url:origin});await b.wait('!!document.querySelector(".hero")');await b.login('tayane');
  await a.wait('!document.querySelector("#description")');
  assert.equal(await a.evaluate('sessionStorage.getItem("mvp-private-draft-v2")'),null);
  assert.equal(await a.evaluate('document.querySelector("main").textContent.includes("TAB-PRIVATE-SECRET")'),false);
  await a.nav('/novo?setor=advocacia');await a.fill('#request-form',{service:'Direito criminal',region:'PE',city:'Recife'});await a.submit('#request-form');await a.wait('!!document.querySelector("#description")');assert.equal(await a.evaluate('document.querySelector("#description").value'),'');
  await a.fill('#request-form',{title:'Outro rascunho',description:'Logout deve limpar inclusive a aba ativa de outra sessão.'});
  await b.click('#profile-menu-trigger');await b.click('#profile-menu-dropdown [data-action=logout]');await a.wait('sessionStorage.getItem("mvp-private-draft-v2")===null');
  checks.push(mode+': legacy draft discarded; same-session reload preserves own draft; account change and logout in another tab clear private drafts');
 }
 const a=await tab();const origin=`http://127.0.0.1:${app.server.address().port}`;
 let id,supportId,proposalId;
 app.transact(s=>{const run=(u,a,p)=>act(s,s.users.find(x=>x.id===u),a,p,{now:clock,hour:10});id=run('cliente','createTicket',{sector:'advocacia',service:'Direito criminal',region:'PE',city:'Recife',title:'Suporte e proposta de teste',description:'Solicitação fictícia para validar o painel administrativo.',agreed:true}).ticketId;run('tayane','accept',{ticketId:id});run('tayane','proposal',{ticketId:id,amount:150,scope:'Serviço fictício para testar',deadline:'2 dias',terms:'Na entrega',validityDays:1});proposalId=s.tickets[0].proposals[0].id;});
 clock='2026-10-20T13:00:00.000Z';await a.send('Page.navigate',{url:origin});await a.wait('!!document.querySelector(".hero")');await a.login('user');await a.nav('/chamado/'+id);await a.wait('!!document.querySelector(".proposal-card")');
 assert.match(await a.evaluate('document.querySelector(".proposal-card").textContent'),/Vencida/);assert.equal(await a.evaluate('!!document.querySelector("[data-action=approveProposal]")'),false);
 app.transact(s=>{const run=(u,a,p)=>act(s,s.users.find(x=>x.id===u),a,p,{now:clock,hour:10});run('tayane','proposal',{ticketId:id,amount:150,scope:'Atualização fictícia para testar',deadline:'2 dias',terms:'Na entrega',validityDays:1});run('cliente','proposalDecision',{ticketId:id,proposalId:s.tickets[0].proposals.at(-1).id,decision:'accepted'});run('tayane','appointment',{ticketId:id,date:'2026-10-22T17:00:00Z',location:'Reunião fictícia'});run('cliente','support',{ticketId:id,message:'Encerrar este contrato de teste.'});supportId=s.support[0].id;});
 await a.login('bruno');await a.nav('/admin');await a.wait('!!document.querySelector("table")');
 assert.equal(await a.evaluate('!!document.querySelector("#minimum-form")'),false);
 await a.click(`[data-action=resolveSupport][data-id="${supportId}"]`);assert.match(await a.evaluate('document.querySelector("dialog").textContent'),/será encerrado/);await a.submit('#confirm-form');await a.wait('!document.querySelector("dialog").open');
 const closed=app.load().tickets.find(t=>t.id===id);assert.equal(closed.status,'cancelled');assert.equal(closed.appointments[0].status,'cancelled');
 const shot=await a.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync('artifacts/auditoria/admin-corrigido.png',Buffer.from(shot.data,'base64'));
 checks.push('local: expired proposal hidden approval; free negotiation without sector pricing controls; explicit support confirmation closes contracted ticket and agenda');
 assert.deepEqual(errors,[]);writeFileSync('artifacts/auditoria/fixes-browser-results.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,errors},null,2));
}finally{for(const t of tabs){await fetch(debug+'/json/close/'+t.target.id).catch(()=>{});t.socket.close();}await app.close();staticServer.closeAllConnections();await new Promise(r=>staticServer.close(r));}
