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
  const a=await tab(),origin=`http://127.0.0.1:${port}`;
  await a.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
  await a.send('Page.navigate',{url:origin});await a.wait('!!document.querySelector(".hero")');await a.login('user');
  const id=await a.evaluate(`(async()=>{
    const request = ${mode === 'static' ? "(await import('./demo.js')).staticRequest" : "async (path,data) => { const s=await fetch('/api/state').then(r=>r.json()); return fetch('/api'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:data?JSON.stringify(data):undefined}).then(r=>r.json()); }"};
    const result=await request('/action',{action:'createTicket',payload:{sector:'advocacia',service:'Advocacia geral',region:'PE',city:'Recife',title:'Negociação livre fictícia',description:'Teste fictício de negociação por documento e formulário.',agreed:true}});
    return result.result.ticketId;
  })()`);
  await a.login('tayane');await a.nav('/chamado/'+id);await a.click('[data-action=acceptTicket]');await a.wait('!!document.querySelector("#message-form")');
  await a.login('user');await a.nav('/chamado/'+id);await a.click('[data-action=newProposal]');await a.wait('!!document.querySelector("#proposal-form")');
  await a.fill('#proposal-form',{source:'document',amount:'25',validityDays:'7'});await a.evaluate('document.querySelector("#proposal-form").elements.source.dispatchEvent(new Event("change",{bubbles:true}))');
  assert.equal(await a.evaluate('document.querySelector("[data-proposal-details]").hidden'),true);
  assert.equal(await a.evaluate('document.querySelector("#proposalAttachment").required'),true);
  await a.evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File(['%PDF-1.4\\nProposta ficticia do cliente'], 'proposta-cliente.pdf',{type:'application/pdf'}));document.querySelector('#proposalAttachment').files=d.files;})()`);
  await a.submit('#proposal-form');await a.wait('!!document.querySelector(".proposal-card") && !document.querySelector("dialog").open');
  assert.match(await a.evaluate('document.querySelector(".proposal-card").textContent'),/25,00/);
  assert.equal(await a.evaluate('!!document.querySelector("[data-action=approveProposal]")'),false);
  assert.match(await a.evaluate('document.querySelector(".proposal-card").textContent'),/proposta-cliente.pdf/);
  await a.login('tayane');await a.nav('/chamado/'+id);await a.wait('!!document.querySelector("[data-action=approveProposal]")');
  await a.click('[data-action=declineProposal]');await a.submit('#confirm-form');await a.wait('document.querySelector("main").textContent.includes("Recusada")');
  await a.click('[data-action=newProposal]');await a.fill('#proposal-form',{amount:'30',scope:'Orientação fictícia para testar o formulário.',deadline:'2 dias',terms:'Na entrega',validityDays:'7'});await a.submit('#proposal-form');
  await a.wait('document.querySelectorAll(".proposal-card").length===2 && !document.querySelector("dialog").open');
  await a.login('user');await a.nav('/chamado/'+id);await a.click('[data-action=approveProposal]');await a.submit('#confirm-form');await a.wait('!!document.querySelector(".badge.contracted")');
  assert.match(await a.evaluate('document.querySelector("main").textContent'),/30,00/);
  await a.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await a.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  const shot=await a.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync('artifacts/auditoria/negociacao-'+mode+'.png',Buffer.from(shot.data,'base64'));
  checks.push(mode+': client document offer uploaded with value; self-approval unavailable; specialist declines and counteroffers by form; client approves exact value; mobile layout');
 }
 assert.deepEqual(errors,[]);writeFileSync('artifacts/auditoria/negotiation-browser-results.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,errors},null,2));
}finally{for(const t of tabs){await fetch(debug+'/json/close/'+t.target.id).catch(()=>{});t.socket.close();}await app.close();staticServer.closeAllConnections();await new Promise(r=>staticServer.close(r));}
