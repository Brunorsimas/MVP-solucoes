import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createApp } from '../server.mjs';

const debug = `http://127.0.0.1:${process.env.CDP_PORT || 9333}`;
const target = await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0; const pending = new Map(), errors = [], checks = [];
socket.onmessage = event => {
  const m = JSON.parse(event.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function wait(expression) { const end = Date.now() + 15000; do { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < end); throw new Error('Timeout: ' + expression); }
async function click(selector) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(selector, values) { await evaluate(`(() => {const f=document.querySelector(${JSON.stringify(selector)}); for(const [k,v] of Object.entries(${JSON.stringify(values)})){f.elements[k].value=v; f.elements[k].dispatchEvent(new Event('input',{bubbles:true}));}})()`); }
async function screenshot(name) { const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(resolve('artifacts', name), Buffer.from(shot.data, 'base64')); }
const app = createApp({ database: ':memory:' });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const staticServer = http.createServer((req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve('dist', '.' + (pathname === '/' ? '/index.html' : pathname));
    assert.ok(file.startsWith(resolve('dist') + '/') || file.startsWith(resolve('dist') + '\\'));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'text/plain' }); res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  for (const [mode, port] of [['local', app.server.address().port], ['static', staticServer.address().port]]) {
    for (const login of ['user', 'tayane', 'bruno']) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
      await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/#/entrar` }); await wait('!!document.querySelector("#auth-form")');
      await fill('#auth-form', { login, password: '123' }); await evaluate('document.querySelector("#auth-form").requestSubmit()'); await wait('!document.querySelector("#auth-form") && !!document.querySelector("#profile-menu-trigger")');
      assert.equal(await evaluate('document.querySelector("#profile-menu-trigger").getAttribute("aria-expanded")'), 'false');
      await click('#profile-menu-trigger'); await wait('!document.querySelector("#profile-menu-dropdown").hidden');
      assert.equal(await evaluate('document.querySelector("#profile-menu-trigger").getAttribute("aria-expanded")'), 'true');
      assert.equal(await evaluate('document.querySelectorAll("#profile-menu-dropdown [role=menuitem]").length'), 2);
      await evaluate('document.querySelector("main h1").click()'); assert.equal(await evaluate('document.querySelector("#profile-menu-dropdown").hidden'), true);
      await evaluate('document.querySelector("#profile-menu-trigger").focus(); document.querySelector("#profile-menu-trigger").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown",bubbles:true}))');
      assert.equal(await evaluate('document.activeElement.dataset.action'), 'account');
      await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown",bubbles:true}))'); assert.equal(await evaluate('document.activeElement.dataset.action'), 'logout');
      await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))');
      assert.equal(await evaluate('document.activeElement.id'), 'profile-menu-trigger');
      assert.equal(await evaluate('document.querySelector("#profile-menu-dropdown").hidden'), true);
      await click('#profile-menu-trigger'); await click('#profile-menu-dropdown [data-action=account]'); await wait('!!document.querySelector("#profile-form")');
      assert.equal(await evaluate('document.querySelector("#account-login").value'), login);
      assert.equal(await evaluate('document.querySelector("#account-login").readOnly'), true);
      await fill('#profile-form', { contactEmail: `${login}.contato@example.test`, phone: '(81) 90000-1234', region: 'PE', city: 'Recife' });
      await click('#profile-menu-trigger'); await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))');
      assert.equal(await evaluate('document.querySelector("#city").value'), 'Recife', 'Opening the menu must preserve unsaved fields');
      await evaluate('document.querySelector("#profile-form").requestSubmit()'); await wait(`document.querySelector("progress")?.value === ${login === 'user' ? 5 : 6}`);
      await cdp('Page.reload'); await wait('document.querySelector("#phone")?.value === "(81) 90000-1234"');
      assert.equal(await evaluate('document.querySelector("#contactEmail").value'), `${login}.contato@example.test`);
      if (login === 'bruno') { await click('#profile-menu-trigger'); await screenshot(`${mode}-account-desktop.png`); await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))'); }
      await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await click('#profile-menu-trigger');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("#profile-menu-trigger > svg")).display !== "none"'), true, 'Dropdown arrow visible on mobile');
      assert.equal(await evaluate('(() => {const r=document.querySelector("#profile-menu-dropdown").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})()'), true);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
      if (login === 'bruno') await screenshot(`${mode}-account-mobile.png`);
      await click('#profile-menu-dropdown [data-action=logout]'); await wait('!document.querySelector(".user-trigger") && !!document.querySelector(".hero")');
      await evaluate('location.hash="/conta"'); await wait('!!document.querySelector(".empty")'); assert.equal(await evaluate('!!document.querySelector("#profile-form")'), false);
      checks.push(`${mode}: ${login}, dropdown, keyboard, outside click, private editable fields, persistence, responsive layout, logout`);
    }
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
  writeFileSync('artifacts/account-browser-report.json', JSON.stringify({ passed: true, checks, errors }, null, 2));
} finally { await fetch(`${debug}/json/close/${target.id}`).catch(() => {}); socket.close(); await app.close(); staticServer.closeAllConnections(); await new Promise(resolve => staticServer.close(resolve)); }
