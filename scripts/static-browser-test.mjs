import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';

// Serve a GitHub Pages-like repository subpath and test the actual static artifact.
const server = http.createServer((req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/MVP-solucoes/')) { res.writeHead(404); return res.end(); }
    pathname = pathname.slice('/MVP-solucoes/'.length);
    if (!extname(pathname)) pathname += pathname.endsWith('/') || !pathname ? 'index.html' : '/index.html';
    const file = resolve('dist', pathname);
    if (!file.startsWith(resolve('dist'))) throw new Error('Invalid path');
    const content = readFileSync(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'text/plain' }); res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}/MVP-solucoes/`;
const debug = `http://127.0.0.1:${process.env.CDP_PORT || 9333}`;
const target = await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let count = 0; const pending = new Map(), errors = [];
socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++count; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
async function wait(expression) { const end = Date.now() + 10000; while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timeout: ${expression}`); }
try {
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: origin }); await wait('!!document.querySelector(".hero")');
  assert.equal(await evaluate('document.documentElement.dataset.mode'), 'static');
  await evaluate('location.hash="/entrar"'); await wait('!!document.querySelector("#auth-form")');
  await evaluate('document.querySelector("#login").value="user"; document.querySelector("#password").value="errada"; document.querySelector("#auth-form").requestSubmit()');
  await wait('document.querySelector("#form-error")?.textContent.includes("inválidos")');
  await evaluate('document.querySelector("#password").value="123"; document.querySelector("#auth-form").requestSubmit()'); await wait('!document.querySelector("#auth-form") && !!document.querySelector(".demo-banner")');
  assert.match(await evaluate('document.querySelector(".demo-banner").textContent'), /neste navegador/);
  await cdp('Page.navigate', { url: origin + 'servicos/ti/' }); await wait('!!document.querySelector(".page-head") && document.querySelector("h1")?.textContent === "Tecnologia da informação"');
  assert.equal(await evaluate('new URL(document.querySelector("link[rel=stylesheet]").href).pathname'), '/MVP-solucoes/styles.css');
  await evaluate('document.querySelector(".page-head a").click()'); await wait('!!document.querySelector("#request-form")');
  await evaluate('document.querySelector("[data-action=chooseSector][data-id=advocacia]").click()');
  assert.equal(await evaluate('document.querySelector(".selection.selected").textContent.trim()'), 'Advocacia');
  await cdp('Page.reload'); await wait('!!document.querySelector(".user-trigger")');
  assert.match(await evaluate('document.querySelector(".user-trigger").textContent'), /user/);
  await evaluate('location.hash="/especialistas"'); await wait('document.querySelectorAll(".expert-card").length === 8');
  assert.equal(await evaluate('document.querySelectorAll(".expert-card a, .expert-card button").length'), 0);
  await evaluate('location.hash="/servicos/ti"'); await wait('!!document.querySelector(".service-detail")');
  assert.equal(await evaluate('document.querySelectorAll(".expert-card").length'), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: static build under repository subpath, password login, invalid-password feedback, nested service page, sector change, session persistence, display-only specialist directory, no JS exceptions.');
} finally { await fetch(`${debug}/json/close/${target.id}`).catch(() => {}); socket.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
