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
const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const staticServer=http.createServer((req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve('dist','.'+(path==='/'?'/index.html':path));assert.ok(file.startsWith(resolve('dist')+'\\')||file.startsWith(resolve('dist')+'/'));res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'text/plain'});res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
try {
 for(const [mode,port] of [['local',app.server.address().port],['static',staticServer.address().port]]) {
  const a=await tab(), origin=`http://127.0.0.1:${port}`;
  const requestCode=mode==='static'?"(await import('./demo.js')).staticRequest":"async (path,data) => { const s=await fetch('/api/state').then(r=>r.json()); const r=await fetch('/api'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:data?JSON.stringify(data):undefined}); const result=await r.json(); if(!r.ok) throw Error(result.error); return result; }";
  const request=(path,data)=>a.evaluate(`(async()=>{const request=${requestCode};return request(${JSON.stringify(path)},${JSON.stringify(data)});})()`);
  await a.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
  await a.send('Page.navigate',{url:origin}); await a.wait('!!document.querySelector(".hero")');await a.login('user');
  const ids=[];for(let i=0;i<4;i++) ids.push((await request('/action',{action:'createTicket',payload:{sector:'advocacia',service:'Direito criminal',region:'PE',city:'Recife',title:'Teste de vaga '+i,description:'Solicitação fictícia para teste de capacidade e perfil.',agreed:true}})).result.ticketId);
  await a.login('tayane');
  for(const ticketId of ids.slice(0,2)) await request('/action',{action:'accept',payload:{ticketId}});
  await a.send('Page.reload');await a.wait('!!document.querySelector(".user-trigger")');
  await a.nav('/chamado/'+ids[2]);await a.wait('!!document.querySelector("[data-action=acceptTicket]")');
  assert.equal(await a.evaluate('document.querySelector("[data-request-details]")?.open'),true);
  assert.match(await a.evaluate('document.querySelector("[data-request-details]").textContent'),/Solicitação fictícia para teste de capacidade e perfil/);
  assert.equal(await a.evaluate('!!document.querySelector("#message-form")'),false);
  assert.equal((await request('/state')).tickets.find(t=>t.id===ids[2]).startedAt,null);
  checks.push(mode+': request description visible before acceptance, details expanded, chat and start remain locked until acceptance');
  assert.equal(await a.evaluate('document.querySelector("[data-action=acceptTicket]").disabled'),true);
  await a.nav('/conta'); await a.wait('!!document.querySelector("#profile-form")');
  assert.match(await a.evaluate('document.querySelector("[data-capacity-incentive]").textContent'),/Complete seu perfil/);
  const bio='<img src=x onerror="window.profileInjected=true"> Apresentação de teste';
  await a.fill('#profile-form',{phone:'(81) 94444-4444',contactEmail:'privado.browser@example.test',region:'PE',city:'Cidade Privada',bio});
  await a.submit('#profile-form');await a.wait('document.querySelector("[data-capacity-incentive]")?.textContent.includes("Terceira vaga liberada!")');
  assert.equal(await a.evaluate('document.querySelector("progress").value'),6);
  await a.nav('/chamado/'+ids[2]);await a.wait('!!document.querySelector("[data-action=acceptTicket]")');
  assert.equal(await a.evaluate('document.querySelector("[data-action=acceptTicket]").disabled'),false);
  await a.click('[data-action=acceptTicket]');await a.wait('!!document.querySelector("#message-form")');
  await a.nav('/chamado/'+ids[3]);await a.wait('!!document.querySelector("[data-action=acceptTicket]")');
  assert.equal(await a.evaluate('document.querySelector("[data-action=acceptTicket]").disabled'),true);
  await a.nav('/especialistas');await a.wait('!!document.querySelector(".expert-card")');
  assert.equal(await a.evaluate('!!window.profileInjected'),false);
  assert.equal(await a.evaluate('!!document.querySelector(".expert-bio img")'),false);
  assert.equal(await a.evaluate('document.querySelector("main").textContent.includes("privado.browser@example.test")'),false);
  assert.equal(await a.evaluate('document.querySelector("main").textContent.includes("Cidade Privada")'),false);
  assert.match(await a.evaluate('Array.from(document.querySelectorAll(".expert-card")).find(e=>e.querySelector("h3").textContent==="Tayane").textContent'),/Agenda preenchida/);
  await a.nav('/conta');await a.wait('!!document.querySelector("#profile-form")');
  await a.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await a.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  const shot=await a.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync('artifacts/auditoria/profile-capacity-'+mode+'.png',Buffer.from(shot.data,'base64'));
  await a.fill('#profile-form',{phone:''});await a.submit('#profile-form');await a.wait('document.querySelector("[data-capacity-incentive]")?.textContent.includes("Complete seu perfil")');
  assert.equal((await request('/state')).user.activeCount,3);assert.equal((await request('/state')).user.capacity,2);
  // Restore synthetic contact before verifying actual browser storage after logout.
  await a.fill('#profile-form',{phone:'(81) 94444-4444'});await a.submit('#profile-form');await a.wait('document.querySelector("[data-capacity-incentive]")?.textContent.includes("Terceira vaga liberada!")');
  await a.click('#profile-form [data-action=logout]');await a.wait('!document.querySelector(".user-trigger")');
  if(mode==='static') {
   assert.equal(await a.evaluate('JSON.parse(localStorage.getItem("mvp-solucoes-static-v1")).users.find(u=>u.id==="tayane").phone'),'(81) 94444-4444');
   checks.push('P03 reproduced in Edge: specialist private phone remains in raw localStorage after logout.');
  }
  checks.push(mode+': profile incentive, save, third acceptance, fourth blocked, downgrade preserves cases, public contacts hidden, stored HTML escaped, mobile layout');
 }
 assert.deepEqual(errors,[]);writeFileSync('artifacts/auditoria/profile-browser-results.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,errors},null,2));
}finally{for(const t of tabs){await fetch(debug+'/json/close/'+t.target.id).catch(()=>{});t.socket.close();}await app.close();staticServer.closeAllConnections();await new Promise(r=>staticServer.close(r));}
