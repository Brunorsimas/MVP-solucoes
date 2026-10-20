import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DEMO_USERS } from '../public/domain.js';

const origin = 'http://127.0.0.1:4190';
const version = await fetch('http://127.0.0.1:9334/json/version').then(r => r.json());
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map(), contexts = [], errors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
async function tab() {
  const { browserContextId } = await send('Target.createBrowserContext'); contexts.push(browserContextId);
  const { targetId } = await send('Target.createTarget', { url: origin + '/#/entrar', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async expression => {
    const end = Date.now() + 25000;
    while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw Error('Timeout: ' + expression + '\n' + await evaluate('document.querySelector("main")?.textContent'));
  };
  const fill = (selector, values) => evaluate(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); for (const [key,value] of Object.entries(${JSON.stringify(values)})) { const field = f.elements[key]; if (field.type === 'checkbox') field.checked = value; else field.value = value; field.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  const click = async selector => { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  const nav = async route => { await evaluate(`location.hash = ${JSON.stringify(route)}`); await new Promise(resolve => setTimeout(resolve, 200)); };
  await wait('!!document.querySelector("#auth-form")');
  return { sessionId, evaluate, wait, fill, click, submit, nav };
}
try {
  const tabs = {};
  for (const account of DEMO_USERS) {
    const page = await tab(); tabs[account.id] = page;
    assert.equal(await page.evaluate('document.querySelector("[name=login]").type'), 'text');
    if (account.id === 'cliente') {
      await page.fill('#auth-form', { login: 'user', password: 'wrong' }); await page.submit('#auth-form');
      await page.wait('document.querySelector("#form-error")?.textContent.includes("inválidos")');
    }
    await page.fill('#auth-form', { login: account.username, password: '123' }); await page.submit('#auth-form');
    await page.wait('!!document.querySelector(".user-trigger")');
    assert.equal(await page.evaluate('document.querySelector("#profile-menu-dropdown span").textContent'), account.username);
    assert.equal(await page.evaluate('[...document.querySelectorAll("a")].some(a => a.hash === "#/admin")'), false);
    await page.evaluate('location.reload()');
    await page.wait('!!document.querySelector(".user-trigger")');
    await page.nav('/conta'); await page.wait('!!document.querySelector("#profile-form")');
    assert.equal(await page.evaluate('document.querySelector("[name=contactEmail]").value'), account.email);
    await page.click('#profile-menu-trigger'); await page.click('[data-action=logout]');
    await page.wait('!document.querySelector(".user-trigger")');
    await page.nav('/entrar'); await page.wait('!!document.querySelector("#auth-form")');
    await page.fill('#auth-form', { login: account.email, password: '123' }); await page.submit('#auth-form');
    await page.wait('!!document.querySelector(".user-trigger")');
    assert.equal(await page.evaluate('document.querySelector("#profile-menu-dropdown span").textContent'), account.username);
    console.log('PASS Browser: ' + account.username + ' e ' + account.email + ' / 123; perfil e sessão verificados.');
  }
  const client = tabs.cliente, professional = tabs.bruno;
  await client.nav('/novo?setor=ti');
  await client.fill('#request-form', { service: 'Suporte técnico', region: 'PE', city: 'Recife' }); await client.submit('#request-form');
  await client.wait('!!document.querySelector("#description")');
  await client.fill('#request-form', { title: 'Teste do login com nome', description: 'Solicitação fictícia para testar a autenticação temporária e a conversa privada.' }); await client.submit('#request-form');
  await client.wait('!!document.querySelector("input[name=agreed]")');
  await client.fill('#request-form', { agreed: true }); await client.submit('#request-form');
  await client.wait('location.hash.startsWith("#/chamado/") && !!document.querySelector(".ticket-detail-head")');
  const route = await client.evaluate('location.hash.slice(1)');
  await professional.nav('/fila'); await professional.click(`a[href="#${route}"]`);
  assert.equal(await professional.evaluate('!!document.querySelector("#message-form")'), false);
  await professional.click('[data-action=acceptTicket]'); await professional.wait('!!document.querySelector("#message-form")');
  await professional.fill('#message-form', { text: 'Conversa privada pelo acesso temporário.' }); await professional.submit('#message-form');
  await professional.wait('document.querySelector(".messages")?.textContent.includes("acesso temporário")');
  await client.evaluate('location.reload()'); await client.wait('document.querySelector(".messages")?.textContent.includes("acesso temporário")');
  await client.click('[data-action=cancelTicket]'); await client.wait('!!document.querySelector("#confirm-form")');
  await client.submit('#confirm-form'); await client.wait('!!document.querySelector(".badge.cancelled")');
  await client.click('#profile-menu-trigger'); await client.click('[data-action=logout]');
  await client.wait('!document.querySelector(".user-trigger")'); await client.evaluate('location.reload()');
  await client.wait('!!document.querySelector(".hero")');
  assert.equal(await client.evaluate('!!document.querySelector(".user-trigger")'), false);
  await client.nav('/entrar'); await client.wait('!!document.querySelector("#auth-form")');
  await client.fill('#auth-form', { login: 'kleber', password: '123' }); await client.submit('#auth-form');
  await client.wait('!!document.querySelector(".user-trigger")');
  assert.equal(await client.evaluate('document.querySelector("#profile-menu-dropdown span").textContent'), 'kleber');
  await client.nav(route);
  await client.wait('!document.querySelector(".messages")');
  const expired = tabs.tayane;
  await expired.evaluate(`sessionStorage.setItem(${JSON.stringify('mvp-test-session:' + origin + '/')}, 'mvp-test-' + 'a'.repeat(64)); location.reload()`);
  await expired.wait('!document.querySelector(".user-trigger") && !!document.querySelector("main")');
  await expired.nav('/entrar'); await expired.wait('!!document.querySelector("#auth-form")');
  await expired.fill('#auth-form', { login: 'tayane', password: '123' }); await expired.submit('#auth-form');
  await expired.wait('!!document.querySelector(".user-trigger")');
  assert.deepEqual(errors, []);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }, professional.sessionId);
  writeFileSync('artifacts/test-login-browser.png', Buffer.from(screenshot.data, 'base64'));
  writeFileSync('artifacts/test-login-browser-results.json', JSON.stringify({ passed: true, checks: ['all nine usernames and test emails', 'account profile displays test email', 'wrong password rejected', 'reload restores each session', 'no admin through shared password', 'ticket creation and preview', 'acceptance and private chat', 'logout and reload', 'account switch isolates chat', 'invalid session clears and permits login', 'no JavaScript exceptions'] }, null, 2));
  console.log('PASS Browser: chamado, chat, isolamento, logout, troca de conta e sessão inválida.');
} finally {
  for (const browserContextId of contexts) await send('Target.disposeBrowserContext', { browserContextId });
  socket.close();
}
