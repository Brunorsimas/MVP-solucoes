import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';

// Uses an existing, isolated headless Chromium/Edge at CDP_PORT. No browser package required.
const debugging = `http://127.0.0.1:${process.env.CDP_PORT || 9333}`;
const target = await fetch(`${debugging}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let seq = 0; const pending = new Map(), errors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
async function wait(expression, label = expression) { const end = Date.now() + 15000; do { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < end); throw new Error(`Timeout: ${label}`); }
async function click(selector) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`, selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(form, values) { await evaluate(`(() => { const form=document.querySelector(${JSON.stringify(form)}); for(const [name,value] of Object.entries(${JSON.stringify(values)})){ const input=form.elements.namedItem(name); if(!input)throw new Error('Missing input '+name); if(input.type==='checkbox')input.checked=value;else input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); } })()`); }
async function submit(form) { await evaluate(`document.querySelector(${JSON.stringify(form)}).requestSubmit()`); }
async function navigate(route) { await evaluate(`location.hash=${JSON.stringify(route)}`); await new Promise(resolve => setTimeout(resolve, 150)); }
async function screenshot(name, width, height) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await new Promise(resolve => setTimeout(resolve, 250));
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(resolve('artifacts', name), Buffer.from(shot.data, 'base64'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, `${name}: horizontal overflow`);
}
await cdp('Runtime.enable'); await cdp('Page.enable');
const app = createApp({ database: ':memory:' }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
await mkdir(resolve('artifacts'), { recursive: true });
const checks = [];
try {
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: origin });
  await wait('!!document.querySelector(".hero")', 'homepage renders');
  await screenshot('home-desktop.png', 1440, 1080);
  await screenshot('home-mobile.png', 390, 844);
  await click('[data-action="mobileMenu"]'); assert.equal(await evaluate('document.querySelector(".sidebar").classList.contains("open")'), true);
  await click('[data-action="mobileMenu"]'); checks.push('home desktop/mobile, no overflow, mobile navigation');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await navigate('/especialistas'); await wait('document.querySelectorAll(".expert-card").length===8');
  await click('[data-action="expertFilter"][data-id="ti"]'); assert.equal(await evaluate('document.querySelectorAll(".expert-card").length'), 3);
  await click('[data-action="expert"][data-id="bruno"]'); await wait('document.querySelector("dialog").open'); await click('[data-action="closeModal"]'); checks.push('directory filters and profile dialog');
  await navigate('/entrar'); await click('[data-action="demoLogin"][data-id="cliente"]'); await wait('!!document.querySelector(".user-trigger")');
  await navigate('/novo'); await click('[data-action="chooseSector"][data-id="ti"]');
  await fill('#request-form', { service: 'Suporte técnico', region: 'PE', modality: 'Remoto', city: 'Recife' }); await submit('#request-form');
  await wait('!!document.querySelector("#description")');
  await fill('#request-form', { title: 'Notebook sem conexão Wi-Fi', description: 'Meu notebook de teste não consegue conectar à rede Wi-Fi após uma atualização.', details: 'Notebook demonstrativo. Problema começou ontem.', preferences: 'À tarde, depois das 14h.' }); await submit('#request-form');
  await wait('!!document.querySelector("input[name=agreed]")'); await fill('#request-form', { agreed: true }); await submit('#request-form');
  await wait('location.hash.startsWith("#/chamado/") && !!document.querySelector(".ticket-detail-head")');
  const ticketRoute = await evaluate('location.hash.slice(1)'); checks.push('three-step request form creates a persisted ticket');
  await click('[data-action="switchProfile"]'); await click('[data-action="demoLogin"][data-id="bruno"]');
  await wait('!!document.querySelector("[data-action=acceptTicket]")'); await click('[data-action="acceptTicket"]');
  await wait('!!document.querySelector("#message-form")');
  await fill('#message-form', { text: 'Olá! Vamos avaliar a conexão do seu notebook de teste.' }); await submit('#message-form');
  await wait('document.querySelector(".messages").textContent.includes("Olá! Vamos avaliar")');
  await click('[data-action="newProposal"]');
  await fill('#proposal-form', { scope: 'Diagnóstico remoto e configuração da conexão Wi-Fi.', exclusions: 'Peças e substituição de hardware.', amount: '150', deadline: 'Até 2 dias úteis', terms: 'Pagamento direto após a entrega', validity: '7 dias' }); await submit('#proposal-form');
  await wait('!!document.querySelector(".proposal-card") && !document.querySelector("dialog").open');
  await screenshot('ticket-desktop.png', 1440, 1080);
  await click('[data-action="switchProfile"]'); await click('[data-action="demoLogin"][data-id="cliente"]'); await wait('!!document.querySelector("[data-action=approveProposal]")');
  await click('[data-action="approveProposal"]'); await submit('#confirm-form'); await wait('!!document.querySelector(".badge.contracted")'); checks.push('professional acceptance, chat, proposal, exact-version client approval');
  await click('[data-action="appointment"]');
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) + 'T14:00';
  await fill('#appointment-form', { date: future, location: 'Reunião remota; link a combinar no chat.' }); await submit('#appointment-form');
  await wait('!!document.querySelector(".appointment") && !document.querySelector("dialog").open');
  await navigate('/agenda'); await wait('document.querySelector(".appointment")?.textContent.includes("Reunião remota")'); checks.push('appointment proposal and agenda');
  await navigate(ticketRoute); await click('[data-action="switchProfile"]'); await click('[data-action="demoLogin"][data-id="bruno"]'); await wait('!!document.querySelector("[data-action=startService]")');
  await click('[data-action="appointmentYes"]'); await wait('document.querySelector(".appointment")?.textContent.includes("Confirmado")');
  await click('[data-action="startService"]'); await wait('!!document.querySelector("[data-action=deliver]")'); await click('[data-action="deliver"]'); await wait('!!document.querySelector(".badge.delivery")');
  await click('[data-action="switchProfile"]'); await click('[data-action="demoLogin"][data-id="cliente"]'); await wait('!!document.querySelector("[data-action=attachReceipt]")');
  await click('[data-action="attachReceipt"]');
  await evaluate(`(() => {const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4\\ncomprovante ficticio'], 'comprovante-teste.pdf', {type:'application/pdf'})); document.querySelector('#attachment').files=dt.files;})()`);
  await submit('#upload-form'); await wait('document.querySelector(".messages")?.textContent.includes("Comprovante anexado")');
  await click('[data-action="switchProfile"]'); await click('[data-action="demoLogin"][data-id="bruno"]'); await wait('!!document.querySelector("[data-action=confirmReceipt]")');
  await click('[data-action="confirmReceipt"]'); await submit('#confirm-form'); await wait('!document.querySelector("dialog").open && !document.querySelector("[data-action=confirmReceipt]")');
  await click('[data-action="completeTicket"]'); await submit('#confirm-form'); await wait('!!document.querySelector(".badge.completed")');
  assert.match(await evaluate('document.querySelector(".retention-note").textContent'), /Histórico disponível até/); checks.push('receipt upload, professional confirmation, completion, retention deadline');
  await navigate('/admin'); await wait('!!document.querySelector("table")'); await screenshot('admin-desktop.png', 1440, 1080);
  assert.equal(await evaluate('document.querySelector("main").textContent.includes("Olá! Vamos avaliar")'), false); checks.push('administrator operational dashboard without private messages');
  await navigate('/privacidade'); await wait('document.querySelector("h1")?.textContent.includes("Privacidade")');
  await navigate('/ajuda'); await wait('!!document.querySelector("#support-form")');
  await fill('#support-form', { category: 'Problema técnico', message: 'Solicitação demonstrativa para testar a central de suporte.' }); await submit('#support-form');
  await navigate('/admin'); await wait('document.querySelector("main").textContent.includes("Solicitação demonstrativa")'); checks.push('support reaches administration');
  await navigate(ticketRoute); await screenshot('ticket-mobile.png', 390, 844);
  assert.deepEqual(errors, [], 'Browser runtime exceptions');
  await writeFile(resolve('artifacts/browser-report.json'), JSON.stringify({ checks, errors, passed: true }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, screenshots: ['home-desktop.png', 'home-mobile.png', 'ticket-desktop.png', 'ticket-mobile.png', 'admin-desktop.png'], errors }, null, 2));
} finally { await fetch(`${debugging}/json/close/${target.id}`).catch(() => {}); socket.close(); await app.close(); }
