// Browser check for public sign-up: the visitor creates their own account from
// the "Criar conta" tab, lands as a plain client, and the interface refuses the
// invalid cases before they reach the server.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';

const debug = `http://127.0.0.1:${process.env.CDP_PORT || 9345}`;
const target = await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
let sequence = 0; const pending = new Map(), errors = [], checks = [];
socket.onmessage = event => {
  const m = JSON.parse(event.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const cdp = (method, params = {}) => new Promise((ok, fail) => { const id = ++sequence; pending.set(id, { resolve: ok, reject: fail }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function wait(expression) { const end = Date.now() + 15000; do { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } while (Date.now() < end); throw new Error('Timeout: ' + expression); }
async function click(selector) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(selector, values) { await evaluate(`(() => {const f=document.querySelector(${JSON.stringify(selector)}); for(const [k,v] of Object.entries(${JSON.stringify(values)})){const e=f.elements[k]; e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}})()`); }
const check = (selector, name) => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}).elements[${JSON.stringify(name)}]; e.checked=true; e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
const valid = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).checkValidity()`);
async function screenshot(name) { const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(resolve('artifacts', name), Buffer.from(shot.data, 'base64')); }

const app = createApp({ database: ':memory:' });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const openSignup = async () => {
  await cdp('Page.navigate', { url: `${origin}/#/entrar` });
  await wait('!!document.querySelector("#auth-form")');
  await click('[data-action=authTab][data-id=register]');
  await wait('document.querySelector("#auth-form")?.dataset.mode==="register"');
};
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });

  // The tab exists and carries the fields a visitor needs: name, e-mail, password, terms.
  await openSignup();
  await screenshot('signup-form.png');
  const fields = await evaluate('[...document.querySelector("#auth-form").elements].map(e => e.name).filter(Boolean)');
  for (const name of ['name', 'email', 'password', 'agreed']) assert.ok(fields.includes(name), `campo ausente no cadastro: ${name}`);
  assert.equal(await evaluate('document.querySelector("#auth-form").elements.password.minLength'), 10, 'o formulário não exige 10 caracteres');
  checks.push('aba Criar conta traz nome, e-mail, senha com mínimo de 10 e aceite dos termos');

  // The browser itself blocks the empty, the short and the unaccepted cases.
  assert.equal(await valid('#auth-form'), false, 'formulário vazio passou na validação do navegador');
  await fill('#auth-form', { name: 'Visitante Navegador', email: 'visitante@exemplo.test', password: 'curta' });
  assert.equal(await valid('#auth-form'), false, 'senha de 5 caracteres passou na validação');
  await fill('#auth-form', { password: 'senha-do-visitante' });
  assert.equal(await valid('#auth-form'), false, 'cadastro sem aceite dos termos passou na validação');
  await check('#auth-form', 'agreed');
  assert.equal(await valid('#auth-form'), true, 'cadastro completo foi recusado pela validação');
  checks.push('navegador recusa formulário vazio, senha curta e falta de aceite antes de enviar');

  // The visitor completes the sign-up and is signed in as a client.
  await submit('#auth-form');
  await wait('!!document.querySelector("#profile-menu-trigger")');
  const session = await evaluate('fetch("/api/state").then(r => r.json()).then(s => ({ nome: s.user?.name, papel: s.user?.role, admin: s.user?.admin, temAdmin: !!s.admin }))');
  assert.equal(session.nome, 'Visitante Navegador');
  assert.equal(session.papel, 'client', 'o cadastro público não produziu um cliente');
  assert.equal(session.admin, false);
  assert.equal(session.temAdmin, false, 'conta recém-criada recebeu o bloco de administração');
  await screenshot('signup-logged-in.png');
  checks.push('cadastro concluído pela tela: sessão aberta como cliente, sem administração');

  // The navigation of a fresh client offers no administrative entry.
  const menu = await evaluate('[...document.querySelectorAll(".nav-link")].map(a => a.getAttribute("href"))');
  assert.equal(menu.includes('#/admin'), false, 'o menu do cliente mostra a administração');
  const forced = await evaluate('fetch("/api/action", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"createUser",payload:{name:"Forjado",email:"forjado@exemplo.test",password:"senha-forjada-xx"}})}).then(r => r.status)');
  assert.ok([401, 403].includes(forced), `ação administrativa de um cliente recém-criado respondeu ${forced}`);
  checks.push('cliente novo não vê administração no menu e recebe 403 ao forçar a ação');

  // The same e-mail cannot be registered twice: the interface shows the reason.
  await click('#profile-menu-trigger'); await click('#profile-menu-dropdown [data-action=logout]');
  await wait('!!document.querySelector(".hero")');
  await openSignup();
  await fill('#auth-form', { name: 'Outro Visitante', email: 'visitante@exemplo.test', password: 'outra-senha-aqui' });
  await check('#auth-form', 'agreed');
  await submit('#auth-form');
  await wait('(document.querySelector("#form-error")?.textContent || "").length > 0');
  const duplicate = await evaluate('document.querySelector("#form-error").textContent');
  assert.match(duplicate, /e-mail|conta/i, `mensagem de e-mail repetido inesperada: ${duplicate}`);
  assert.equal(await evaluate('!!document.querySelector("#profile-menu-trigger")'), false, 'o cadastro repetido abriu sessão');
  await screenshot('signup-duplicate.png');
  checks.push(`e-mail repetido recusado na tela com mensagem: "${duplicate.trim()}"`);

  // The account created by the visitor signs in again with its own password.
  await click('[data-action=authTab][data-id=login]');
  await wait('document.querySelector("#auth-form")?.dataset.mode==="login"');
  await fill('#auth-form', { login: 'visitante@exemplo.test', password: 'senha-errada-aqui' });
  await submit('#auth-form');
  await wait('(document.querySelector("#form-error")?.textContent || "").includes("inválidos")');
  await fill('#auth-form', { login: 'visitante@exemplo.test', password: 'senha-do-visitante' });
  await submit('#auth-form');
  await wait('!!document.querySelector("#profile-menu-trigger")');
  checks.push('conta criada pelo visitante entra de novo: senha errada recusada, senha certa aceita');

  // A client who signed up can open a ticket, which is the point of signing up.
  await evaluate('location.hash="/novo"');
  await wait('!!document.querySelector("#request-form")');
  await screenshot('signup-new-ticket.png');
  checks.push('cliente recém-cadastrado alcança o formulário de nova solicitação');

  assert.deepEqual(errors, [], `erros de console: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ passed: false, checks, errors, failure: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  socket.close(); await app.close();
}
