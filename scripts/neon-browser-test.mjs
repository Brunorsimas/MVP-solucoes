import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const origin = 'http://127.0.0.1:4189', debug = `http://127.0.0.1:${process.env.CDP_PORT || 9333}`;
const version = await fetch(debug + '/json/version').then(r => r.json());
const socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
let seq = 0; const pending = new Map(), contexts = [], errors = [], cookieBlocks = [];
socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); if (m.method === 'Network.responseReceivedExtraInfo') for (const c of m.params.blockedCookies || []) cookieBlocks.push(c.blockedReasons); };
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
async function tab() {
  const { browserContextId } = await send('Target.createBrowserContext'); contexts.push(browserContextId);
  const { targetId } = await send('Target.createTarget', { url: origin + '/#/entrar', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }); await send('Runtime.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const wait = async expression => { const end = Date.now() + 20000; while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 150)); } throw Error('Timeout: ' + expression + '\nPage: ' + await evaluate('document.querySelector("main")?.textContent')); };
  const fill = (selector, values) => evaluate(`(() => { const f=document.querySelector(${JSON.stringify(selector)}); for(const [k,v] of Object.entries(${JSON.stringify(values)})){const e=f.elements[k]; if(e.type==='checkbox')e.checked=v; else e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));} })()`);
  const click = async selector => { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  const nav = async route => { await evaluate(`location.hash=${JSON.stringify(route)}`); await new Promise(r => setTimeout(r, 150)); };
  await wait('!!document.querySelector("#auth-form")'); return { sessionId, evaluate, wait, fill, click, submit, nav };
}
try {
  const access = JSON.parse(readFileSync('artifacts/neon-test-access.json', 'utf8'));
  const client = await tab(), specialist = await tab();
  await client.fill('#auth-form', { login: access.client, password: access.password }); await client.submit('#auth-form');
  try { await client.wait('!!document.querySelector(".user-trigger")'); }
  catch(error) {
    const authUrl = parseEnv(readFileSync('.env.local', 'utf8')).NEON_AUTH_BASE_URL;
    console.error('Auth session metadata:', await client.evaluate(`fetch(${JSON.stringify(authUrl + '/get-session')},{credentials:'include'}).then(async r=>{const d=await r.json();return {status:r.status,keys:Object.keys(d||{}),hasUser:!!d?.user,hasSession:!!d?.session};})`));
    throw error;
  }
  await specialist.fill('#auth-form', { login: access.specialist, password: access.password }); await specialist.submit('#auth-form'); await specialist.wait('!!document.querySelector(".user-trigger")');
  await client.nav('/novo?setor=ti');
  await client.fill('#request-form', { service: 'Suporte técnico', region: 'PE', city: 'Recife' }); await client.submit('#request-form');
  await client.wait('!!document.querySelector("#description")');
  await client.fill('#request-form', { title: 'QA Neon no navegador', description: 'Chamado fictício para verificar a integração real de todos os serviços no navegador.' }); await client.submit('#request-form');
  await client.wait('!!document.querySelector("input[name=agreed]")'); await client.fill('#request-form', { agreed: true }); await client.submit('#request-form');
  await client.wait('location.hash.startsWith("#/chamado/") && !!document.querySelector(".ticket-detail-head")');
  const route = await client.evaluate('location.hash.slice(1)');
  await specialist.nav('/fila'); await specialist.click(`a[href="#${route}"]`);
  await specialist.click('[data-action=acceptTicket]'); await specialist.wait('!!document.querySelector("#message-form")');
  await specialist.fill('#message-form', { text: 'Mensagem pelo Neon Functions e Auth.' }); await specialist.submit('#message-form');
  await specialist.wait('document.querySelector(".messages").textContent.includes("Neon Functions")');
  await client.evaluate('location.reload()'); await client.wait('document.querySelector(".messages")?.textContent.includes("Neon Functions")');
  assert.equal(await client.evaluate('!!document.querySelector(".user-trigger")'), true, 'session restored after reload');
  await client.click('[data-action=cancelTicket]'); await client.wait('!!document.querySelector("#confirm-form")'); await client.submit('#confirm-form'); await client.wait('!!document.querySelector(".badge.cancelled")');
  await client.click('#profile-menu-trigger'); await client.click('[data-action=logout]'); await client.wait('!document.querySelector(".user-trigger")');
  await client.evaluate('location.reload()'); await client.wait('!!document.querySelector(".hero")');
  assert.equal(await client.evaluate('!!document.querySelector(".user-trigger")'), false);
  assert.deepEqual(errors, []);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, specialist.sessionId);
  writeFileSync('artifacts/neon-browser-preview.png', Buffer.from(shot.data, 'base64'));
  writeFileSync('artifacts/neon-browser-results.json', JSON.stringify({ passed: true, checks: ['SDK email/password sign-in', 'two isolated browser sessions', 'ticket form', 'specialist accepts and chats', 'reload restores session and shared conversation', 'cancel', 'logout persists after reload', 'no JavaScript errors'] }, null, 2));
  console.log('PASS Browser: Neon SDK login, independent client/specialist sessions, ticket, chat, reload, cancellation and logout.');
} catch(error) { console.error('Cookie blocking reasons (values omitted):', JSON.stringify(cookieBlocks)); throw error; }
finally { for (const browserContextId of contexts) await send('Target.disposeBrowserContext', { browserContextId }); socket.close(); }
