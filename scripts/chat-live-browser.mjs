import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const origin = process.env.CHAT_TEST_ORIGIN || 'http://127.0.0.1:4190';
const version = await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9334}/json/version`).then(r => r.json());
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let seq = 0; const pending = new Map(), contexts = [], tabs = [], errors = [], checks = [], latency = [];
let cleanupClient, cleanupTicket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
socket.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
async function tab(login) {
  const { browserContextId } = await send('Target.createBrowserContext'); contexts.push(browserContextId);
  const { targetId } = await send('Target.createTarget', { url: origin + '/#/entrar', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async (expression, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(expression)) return; await pause(30); }
    throw Error('Timeout: ' + expression + '\n' + await evaluate('document.querySelector("main")?.textContent'));
  };
  const fill = (selector, values) => evaluate(`(() => { const f=document.querySelector(${JSON.stringify(selector)});for(const [k,v] of Object.entries(${JSON.stringify(values)})){const e=f.elements[k];if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));} })()`);
  const click = async selector => { await wait(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  const nav = async route => { await evaluate(`location.hash=${JSON.stringify(route)}`); await pause(100); };
  await wait('!!document.querySelector("#auth-form")');
  await fill('#auth-form', { login, password: '123' }); await submit('#auth-form');
  await wait('!!document.querySelector(".user-trigger") && document.documentElement.dataset.liveStatus === "connected"');
  const result = { sessionId, evaluate, wait, fill, click, submit, nav }; tabs.push(result);
  return result;
}
async function say(sender, receiver, text) {
  const start = Date.now();
  await sender.fill('#message-form', { text }); await sender.submit('#message-form');
  await receiver.wait(`document.querySelector('.messages')?.textContent.includes(${JSON.stringify(text)})`, 2500);
  latency.push(Date.now() - start);
  await sender.wait('!!document.querySelector("#message-form button") && !document.querySelector("#message-form button").disabled');
}
function passed(name) { checks.push(name); console.log('PASS Browser: ' + name); }
try {
  const client = await tab('user'), pro = await tab('bruno'), outsider = await tab('tayane');
  cleanupClient = client;
  const stamp = Date.now();
  await client.nav('/novo?setor=ti');
  await client.fill('#request-form', { service: 'Suporte técnico', region: 'PE', city: 'Recife' }); await client.submit('#request-form');
  await client.wait('!!document.querySelector("#description")');
  await client.fill('#request-form', { title: 'Chat ao vivo ' + stamp, description: 'Chamado fictício para validar mensagens instantâneas e preservar a digitação.' }); await client.submit('#request-form');
  await client.wait('!!document.querySelector("input[name=agreed]")'); await client.fill('#request-form', { agreed: true }); await client.submit('#request-form');
  await client.wait('location.hash.startsWith("#/chamado/")');
  const route = await client.evaluate('location.hash.slice(1)');
  cleanupTicket = route.split('/').at(-1);
  await pro.wait(`!!document.querySelector(${JSON.stringify('a[href="#' + route + '"]')})`, 2500);
  passed('novo chamado aparece na fila sem recarregar');
  await pro.click(`a[href="#${route}"]`); await pro.click('[data-action=acceptTicket]');
  await client.wait('!!document.querySelector("#message-form")', 2500);
  await pro.wait('!!document.querySelector("#message-form")');
  passed('aceite abre o chat automaticamente para o cliente');
  await client.evaluate(`window.keptComposer=document.querySelector('#message-form textarea');keptComposer.value='Rascunho que deve permanecer';keptComposer.focus();keptComposer.setSelectionRange(4,9)`);
  await say(pro, client, 'Mensagem instantânea ' + stamp);
  assert.deepEqual(await client.evaluate(`({same:keptComposer===document.querySelector('#message-form textarea'),focus:document.activeElement===keptComposer,value:keptComposer.value,start:keptComposer.selectionStart,end:keptComposer.selectionEnd})`), { same: true, focus: true, value: 'Rascunho que deve permanecer', start: 4, end: 9 });
  passed('recebe enquanto digita: mesmo campo, foco, texto e seleção preservados');
  await pro.evaluate(`window.keptComposer=document.querySelector('#message-form textarea');keptComposer.value='Rascunho do especialista';keptComposer.focus()`);
  await say(client, pro, 'Resposta do cliente ' + stamp);
  assert.equal(await pro.evaluate('document.activeElement===keptComposer && keptComposer.value === "Rascunho do especialista"'), true);
  passed('recebimento imediato também no sentido cliente para especialista');
  await client.click('[data-action=attachFile]'); await client.wait('document.querySelector("#modal").open');
  await client.evaluate(`window.keptFile=document.querySelector('#upload-form input[type=file]');const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4 Teste'],'rascunho.pdf',{type:'application/pdf'}));keptFile.files=dt.files;keptFile.focus()`);
  await say(pro, client, 'Mensagem com modal aberto ' + stamp);
  assert.equal(await client.evaluate('document.querySelector("#modal").open && document.querySelector("#upload-form input[type=file]")===keptFile && keptFile.files[0]?.name==="rascunho.pdf"'), true);
  await client.click('[data-action=closeModal]');
  passed('mensagem chega com modal aberto sem perder o arquivo selecionado');
  await client.nav('/conta'); await client.wait('!!document.querySelector("#profile-form")');
  await client.fill('#profile-form', { phone: '(81) 98888-7777' }); await client.evaluate('document.querySelector("[name=phone]").focus();window.keptProfile=document.querySelector("#profile-form")');
  await pro.fill('#message-form', { text: 'Atualização sem perder formulário ' + stamp }); await pro.submit('#message-form');
  await pause(500);
  assert.equal(await client.evaluate('document.querySelector("#profile-form")===keptProfile && document.querySelector("[name=phone]").value==="(81) 98888-7777"'), true);
  passed('atualização preserva formulário de perfil não salvo');
  await client.nav(route); await client.wait('!!document.querySelector("#message-form")');
  // Fill enough history to test reading older messages without a scroll jump.
  await pro.evaluate(`(async()=>{const key=Object.keys(sessionStorage).find(k=>k.startsWith('mvp-test-session:'));const token=sessionStorage.getItem(key),api=key.slice('mvp-test-session:'.length);for(let i=0;i<18;i++){const r=await fetch(new URL('api/action',api),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'message',payload:{ticketId:${JSON.stringify(route.split('/').at(-1))},text:'Histórico fictício '+i+' — '+${stamp}}})});if(!r.ok)throw Error('History setup failed')}})()`);
  await client.wait('document.querySelector(".messages")?.textContent.includes("Histórico fictício 17")');
  await client.evaluate('const log=document.querySelector("#messages");log.style.scrollBehavior="auto";log.scrollTop=0'); await pause(250);
  await say(pro, client, 'Mensagem enquanto lê histórico ' + stamp);
  assert.ok(await client.evaluate('document.querySelector("#messages").scrollTop < 5'));
  passed('preserva posição de leitura no histórico');
  const body = 'Recebida após reconectar ' + stamp;
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, client.sessionId);
  await pro.fill('#message-form', { text: body }); await pro.submit('#message-form');
  await pro.wait(`document.querySelector('.messages')?.textContent.includes(${JSON.stringify(body)})`);
  await pause(600);
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, client.sessionId);
  await client.wait(`document.documentElement.dataset.liveStatus==='connected' && document.querySelector('.messages')?.textContent.includes(${JSON.stringify(body)})`);
  assert.equal(await client.evaluate(`[...document.querySelectorAll('.message-bubble')].filter(e=>e.textContent===${JSON.stringify(body)}).length`), 1);
  passed('reconecta após queda de rede e recupera mensagem sem duplicar');
  await outsider.nav(route); await outsider.wait('document.querySelector("main")?.textContent.includes("Não encontramos esta página")');
  assert.equal(await outsider.evaluate('!!document.querySelector(".messages")'), false);
  assert.equal(await outsider.evaluate(`document.body.textContent.includes(${JSON.stringify('Mensagem instantânea ' + stamp)})`), false);
  passed('outro especialista não recebe o conteúdo privado');
  await client.click('[data-action=cancelTicket]'); await client.wait('!!document.querySelector("#confirm-form")'); await client.submit('#confirm-form');
  await pro.wait('!!document.querySelector(".badge.cancelled") && !document.querySelector("#message-form")', 2500);
  await client.wait('!document.querySelector("#modal").open && !!document.querySelector(".badge.cancelled")');
  cleanupTicket = null;
  passed('cancelamento encerra o chat na outra sessão automaticamente');
  await client.click('#profile-menu-trigger'); await client.click('[data-action=logout]');
  await client.wait('!document.querySelector(".user-trigger") && document.documentElement.dataset.liveStatus === "stopped"');
  passed('logout interrompe a conexão de eventos');
  assert.deepEqual(errors, []);
  writeFileSync('artifacts/chat-live-browser-results.json', JSON.stringify({ passed: true, origin, checks, latencyMs: latency, maxLatencyMs: Math.max(...latency) }, null, 2));
  const shot = await send('Page.captureScreenshot', { format: 'png' }, pro.sessionId);
  writeFileSync('artifacts/chat-live-browser.png', Buffer.from(shot.data, 'base64'));
  console.log('Latency milliseconds: ' + latency.join(', '));
} finally {
  if (cleanupClient && cleanupTicket) {
    try {
      await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, cleanupClient.sessionId);
      const cleanup = await cleanupClient.evaluate(`(async()=>{const key=Object.keys(sessionStorage).find(k=>k.startsWith('mvp-test-session:'));if(!key)return 'no-session';const token=sessionStorage.getItem(key);if(!token)return 'signed-out';const r=await fetch(new URL('api/action',key.slice('mvp-test-session:'.length)),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',payload:{ticketId:${JSON.stringify(cleanupTicket)}}})});return {status:r.status,result:await r.json()}})()`);
      if (cleanup?.status && cleanup.status !== 200) console.log('Test cleanup: ' + JSON.stringify(cleanup));
    } catch (error) { console.log('Test cleanup failed: ' + error.message); }
  }
  for (const tab of tabs) {
    try {
      await tab.evaluate(`(async()=>{const key=Object.keys(sessionStorage).find(k=>k.startsWith('mvp-test-session:'));const token=key&&sessionStorage.getItem(key);if(token)await fetch(new URL('api/auth/logout',key.slice('mvp-test-session:'.length)),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})})()`);
    } catch (error) { console.log('Test session cleanup failed: ' + error.message); }
  }
  for (const browserContextId of contexts) await send('Target.disposeBrowserContext', { browserContextId });
  socket.close();
}
