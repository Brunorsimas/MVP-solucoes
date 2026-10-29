// Local browser check for the administration area: password change, user creation,
// sector per specialist, the separate client list, the deletion notice and the
// message shown to a disabled account.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { passwordCredentials } from '../lib/passwords.mjs';

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
const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
async function screenshot(name) { const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(resolve('artifacts', name), Buffer.from(shot.data, 'base64')); }

const app = createApp({ database: ':memory:' });
// The local handler has no provisioning endpoint: seed this synthetic password directly.
const brunoCredentials = passwordCredentials('senha-do-bruno-2026');
app.db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('bruno', 'bruno@local.test', brunoCredentials.salt, brunoCredentials.hash);
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${app.server.address().port}`;
async function login(user, password) {
  await cdp('Page.navigate', { url: `${origin}/#/entrar` }); await wait('!!document.querySelector("#auth-form")');
  await fill('#auth-form', { login: user, password }); await submit('#auth-form');
}
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });

  // The administrator signs in with their own password and changes it from the account page.
  await login('bruno@local.test', 'senha-do-bruno-2026');
  await wait('!!document.querySelector("#profile-menu-trigger")');
  await evaluate('location.hash="/conta"'); await wait('!!document.querySelector("#password-form")');
  await screenshot('admin-account-password.png');
  await fill('#password-form', { currentPassword: 'errada-de-proposito', password: 'nova-senha-do-bruno', confirmPassword: 'nova-senha-do-bruno' });
  await submit('#password-form'); await wait('document.querySelector("#password-error")?.textContent.includes("senha atual")');
  await fill('#password-form', { currentPassword: 'senha-do-bruno-2026', password: 'nova-senha-do-bruno', confirmPassword: 'diferente-daqui' });
  await submit('#password-form'); await wait('document.querySelector("#password-error")?.textContent.includes("confirmação")');
  await fill('#password-form', { currentPassword: 'senha-do-bruno-2026', password: 'nova-senha-do-bruno', confirmPassword: 'nova-senha-do-bruno' });
  await submit('#password-form'); await wait('!!document.querySelector(".toast")');
  checks.push('conta: senha atual conferida, confirmação conferida e troca concluída');

  // The new password is the one that works from now on.
  await click('#profile-menu-trigger'); await click('#profile-menu-dropdown [data-action=logout]'); await wait('!!document.querySelector(".hero")');
  await login('bruno@local.test', 'senha-do-bruno-2026'); await wait('document.querySelector("#form-error")?.textContent.includes("inválidos")');
  await login('bruno@local.test', 'nova-senha-do-bruno'); await wait('!!document.querySelector("#profile-menu-trigger")');
  checks.push('login: senha antiga recusada, senha nova aceita');

  // The administration creates a user with an initial password.
  await evaluate('location.hash="/admin"'); await wait('!!document.querySelector("[data-action=createUser]")');
  await screenshot('admin-users-table.png');
  await click('[data-action=createUser]'); await wait('!!document.querySelector("dialog[open] #create-user-form")');
  await fill('#create-user-form', { name: 'Ana Teste', email: 'ana.teste@local.test', role: 'client', password: 'senha-inicial-ana' });
  await submit('#create-user-form');
  await wait('!document.querySelector("dialog[open] #create-user-form")');
  await wait('[...document.querySelectorAll("td")].some(t => t.textContent.includes("ana.teste@local.test"))');
  checks.push('admin: usuário criado e listado na tabela');

  // The new account must change its password before doing anything else.
  await click('#profile-menu-trigger'); await click('#profile-menu-dropdown [data-action=logout]'); await wait('!!document.querySelector(".hero")');
  await login('ana.teste@local.test', 'senha-inicial-ana'); await wait('!!document.querySelector("#profile-menu-trigger")');
  await evaluate('location.hash="/conta"'); await wait('!!document.querySelector("#password-form")');
  assert.equal(await evaluate('document.querySelector("#password-form .info-note")?.textContent.includes("criada pela administração")'), true);
  await fill('#password-form', { currentPassword: 'senha-inicial-ana', password: 'senha-propria-ana', confirmPassword: 'senha-propria-ana' });
  await submit('#password-form'); await wait('!!document.querySelector(".toast")');
  await wait('!document.querySelector("#password-form .info-note")');
  assert.equal(await evaluate('!!document.querySelector("[data-action=createUser]")'), false, 'Uma conta comum não vê a administração');
  checks.push('conta criada: aviso de primeira troca exibido e removido após a troca');

  // Specialists are grouped by sector; clients sit in a table of their own.
  await click('#profile-menu-trigger'); await click('#profile-menu-dropdown [data-action=logout]'); await wait('!!document.querySelector(".hero")');
  await login('bruno@local.test', 'nova-senha-do-bruno'); await wait('!!document.querySelector("#profile-menu-trigger")');
  await evaluate('location.hash="/admin"'); await wait('!!document.querySelector("[data-action=editSector]")');
  const layout = await evaluate(`(() => {
    const row = login => [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(login));
    const client = row('ana.teste@local.test'), specialist = row('kleber');
    const actions = r => [...r.querySelectorAll('[data-action]')].map(b => b.dataset.action);
    return {
      clientActions: actions(client), specialistActions: actions(specialist),
      sectorHeadings: [...document.querySelectorAll('.account-section-title')].map(h => h.textContent),
      clientHeader: client.closest('table').querySelector('th').textContent,
      specialistHeader: specialist.closest('table').querySelector('th').textContent
    };
  })()`);
  assert.deepEqual(layout.clientActions, ['toggleProfessional', 'deleteUser'], 'Cliente só suspende e exclui');
  assert.deepEqual(layout.specialistActions, ['editSector', 'toggleProfessional', 'deleteUser'], 'Especialista ganha o setor');
  assert.equal(layout.clientHeader, 'Cliente');
  assert.equal(layout.specialistHeader, 'Especialista');
  assert.ok(layout.sectorHeadings.includes('Tecnologia da informação'), 'Especialistas agrupados por setor');
  checks.push(`tabelas separadas: clientes com ${layout.clientActions.join(' + ')}; especialistas por setor (${layout.sectorHeadings.join(', ')})`);

  // One sector per specialist: choosing another sector swaps the service list.
  await evaluate(`[...document.querySelectorAll('[data-action=editSector]')].find(b => b.dataset.id === 'kleber').click()`);
  await wait('!!document.querySelector("dialog[open] #sector-form")');
  await screenshot('admin-sector-form.png');
  await evaluate(`(() => { const s = document.querySelector('#sector-form [name=sector]'); s.value = 'advocacia'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.equal(await evaluate(`document.querySelector('#sector-form [data-services=ti]').hidden`), true, 'Serviços de outro setor ficam ocultos');
  await submit('#sector-form'); await wait('document.querySelector("#modal-error")?.textContent.includes("ao menos um serviço")');
  await evaluate(`document.querySelector('#sector-form [data-services=advocacia] input').click()`);
  await submit('#sector-form'); await wait('!document.querySelector("dialog[open] #sector-form")');
  await wait(`[...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes('Kleber') && r.textContent.includes('Advocacia geral'))`);
  checks.push('admin: setor do especialista trocado, com serviço obrigatório do setor');
  await screenshot('admin-users-tables.png');

  const deleteSelector = `[...document.querySelectorAll('[data-action=deleteUser]')].find(b => b.closest('tr').textContent.includes('ana.teste@local.test'))`;
  await evaluate(`${deleteSelector}.click()`); await wait('!!document.querySelector("dialog[open] #delete-user-form")');
  await fill('#delete-user-form', { confirm: 'Nome Errado' }); await submit('#delete-user-form');
  await wait('document.querySelector("#modal-error")?.textContent.includes("nome exato")');
  await fill('#delete-user-form', { confirm: 'Ana Teste' }); await submit('#delete-user-form');
  await wait('!document.querySelector("dialog[open] #delete-user-form")');
  await wait('document.body.textContent.includes("ficarão armazenadas por mais 360 dias")');
  assert.equal(await evaluate('document.body.textContent.includes("Nada é apagado automaticamente")'), true);
  await screenshot('admin-users-deleted.png');
  checks.push('admin: exclusão exige o nome exato e mostra a retenção de 360 dias');

  // A disabled account is told to contact the administration.
  // Suspended first: a successful probe would replace this page's session cookie.
  await evaluate(`[...document.querySelectorAll('[data-action=toggleProfessional]')].find(b => b.dataset.id === 'kleber').click()`);
  await wait('!!document.querySelector("dialog[open] #confirm-form")'); await submit('#confirm-form');
  await wait('!document.querySelector("dialog[open] #confirm-form")');
  await wait(`[...document.querySelectorAll('tr')].some(r => r.textContent.includes('Kleber') && r.textContent.includes('Desativado'))`);
  const blocked = await evaluate(`(async () => { const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ login:'kleber', password:'123' }) }); return [r.status, (await r.json()).error]; })()`);
  assert.equal(blocked[0], 403);
  assert.match(blocked[1], /Usuário desativado, entre em contato como administrador do sistema/);
  checks.push('login de conta desativada responde 403 com a mensagem combinada');

  assert.deepEqual(errors, []);
  const report = { passed: true, checks, errors };
  writeFileSync('artifacts/admin-users-browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await fetch(`${debug}/json/close/${target.id}`).catch(() => {}); socket.close(); await app.close(); }
