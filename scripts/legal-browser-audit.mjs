import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { context, credentials } from './security-audit.mjs';

const debug = `http://127.0.0.1:${process.env.CDP_PORT || 9333}`;
const target = await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
let sequence = 0; const pending = new Map(), errors = [], checks = [], findings = [];
socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function wait(expression) { const end = Date.now() + 12000; do { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 80)); } while (Date.now() < end); throw new Error('Timeout: ' + expression); }
async function click(s) { await wait(`!!document.querySelector(${JSON.stringify(s)})`); await evaluate(`document.querySelector(${JSON.stringify(s)}).click()`); }
async function fill(s, values) { await evaluate(`(() => { const f=document.querySelector(${JSON.stringify(s)});for(const [k,v] of Object.entries(${JSON.stringify(values)})){const i=f.elements.namedItem(k);if(!i)throw new Error('Input missing: '+k); if(i.type==='checkbox')i.checked=v;else i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));}})()`); }
async function submit(s) { await evaluate(`document.querySelector(${JSON.stringify(s)}).requestSubmit()`); }
async function nav(route) { await evaluate(`location.hash=${JSON.stringify(route)}`); await new Promise(r => setTimeout(r, 160)); }
async function login(kind) { const c = credentials[kind]; await nav('/entrar'); await fill('#auth-form', { login: c.email, password: c.password }); await submit('#auth-form'); await wait(`document.querySelector('.user-trigger strong')?.textContent===${JSON.stringify(c.name.split(' ')[0])}`); }
const stamp = Date.now(), out = resolve('artifacts/auditoria'), downloadDir = resolve(out, 'downloads-' + stamp);
mkdirSync(downloadDir, { recursive: true });
const database = resolve('data/auditoria-navegador-' + stamp + '.sqlite');
const c = await context(database, { auxiliary: false });
const screenshot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(resolve(out, name), Buffer.from(r.data, 'base64')); };
let ticketId;
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: c.origin + '/#/novo?setor=advocacia' });
  await wait('location.hash==="#/entrar" && !!document.querySelector("#auth-form")');
  await login('client'); await wait('!!document.querySelector("#request-form")');
  await fill('#request-form', { service: 'Advocacia geral', region: 'PE', city: 'Recife' }); await submit('#request-form');
  await wait('!!document.querySelector("#description")');
  assert.equal(await evaluate('!!document.querySelector("[name=modality],[name=preferences]")'), false);
  await fill('#request-form', { title: 'Auditoria jurídica — orientação fictícia', description: 'Solicitação fictícia de orientação jurídica para testar a plataforma, sem caso real.', details: 'Dados inteiramente fictícios.' });
  await click('[data-action=previousStep]'); await wait('!!document.querySelector("#city")'); await submit('#request-form');
  await wait('!!document.querySelector("#description")');
  await submit('#request-form'); await wait('!!document.querySelector("[name=agreed]")'); await fill('#request-form', { agreed: true }); await submit('#request-form');
  await wait('location.hash.startsWith("#/chamado/") && !!document.querySelector(".ticket-detail-head")');
  ticketId = await evaluate('location.hash.split("/").at(-1)');
  const route = '/chamado/' + ticketId;
  checks.push('Cliente criado: login obrigatório, formulário jurídico completo, voltar etapa, consentimento, abertura automática');
  await login('legal'); await nav('/fila'); await nav(route); await click(`[data-action=acceptTicket][data-id="${ticketId}"]`);
  await nav(route); await wait('!!document.querySelector("#message-form")');
  const payload = '<img src=x onerror="window.auditXss=1"> & mensagem fictícia';
  await fill('#message-form', { text: payload }); await submit('#message-form'); await wait('document.querySelector(".messages").textContent.includes("onerror")');
  assert.equal(await evaluate('document.querySelectorAll(".message-bubble img").length'), 0);
  assert.equal(await evaluate('window.auditXss===1'), false);
  await click('[data-action=newProposal]'); await click('[data-action=closeModal]'); assert.equal(await evaluate('document.querySelector("dialog").open'), false);
  await click('[data-action=newProposal]'); await fill('#proposal-form', { amount: '150', scope: 'Orientação jurídica de teste, sem processo real.', exclusions: 'Nenhuma representação real.', deadline: '2 dias', terms: 'Pagamento fictício após entrega', validityDays: '7' }); await submit('#proposal-form');
  await wait('!!document.querySelector(".proposal-card") && !document.querySelector("dialog").open');
  await click('[data-action=appointment]'); await fill('#appointment-form', { date: '2026-10-23T14:00', location: 'Reunião fictícia da auditoria' }); await submit('#appointment-form'); await wait('!!document.querySelector(".appointment") && !document.querySelector("dialog").open');
  await login('client'); await nav(route); await click('[data-action=approveProposal]'); await submit('#confirm-form'); await wait('!!document.querySelector(".badge.contracted")');
  await click('[data-action=appointmentYes]'); await wait('document.querySelector(".appointment").textContent.includes("Confirmado")');
  await login('legal'); await nav(route);
  await click('[data-action=startService]'); await wait('!!document.querySelector("[data-action=deliver]")'); await click('[data-action=deliver]'); await wait('!!document.querySelector(".badge.delivery")');
  await login('client'); await nav(route); await click('[data-action=attachReceipt]');
  await evaluate(`(() => {const d=new DataTransfer();d.items.add(new File(['%PDF-1.4\\nDocumento de teste'], 'comprovante-juridico-ficticio.pdf',{type:'application/pdf'}));document.querySelector('#attachment').files=d.files;})()`);
  await submit('#upload-form'); await wait('document.querySelector(".messages").textContent.includes("Comprovante anexado")');
  await login('legal'); await nav(route); await click('[data-action=confirmReceipt]'); await submit('#confirm-form'); await wait('!document.querySelector("dialog").open && !document.querySelector("[data-action=confirmReceipt]")');
  await click('[data-action=completeTicket]'); await submit('#confirm-form'); await wait('!!document.querySelector(".badge.completed")');
  await login('client'); await nav(route); await click('[data-action=review]'); await evaluate('document.querySelectorAll("input[name=rating]")[4].checked=true'); await fill('#review-form', { comment: 'Teste de avaliação jurídica.' }); await submit('#review-form');
  await wait('document.querySelector("main").textContent.includes("Sua avaliação: 5/5")');
  await screenshot('juridico-corrigido-desktop.png');
  await click('[data-action=exportChat]'); await click('[data-action=downloadFile]');
  for (let i=0; i<80 && readdirSync(downloadDir).filter(f => /\.(txt|pdf)$/.test(f)).length<2; i++) await new Promise(r=>setTimeout(r,100));
  const files = readdirSync(downloadDir); assert.ok(files.some(f=>f.endsWith('.txt'))); assert.ok(files.some(f=>f.endsWith('.pdf')));
  assert.match(readFileSync(resolve(downloadDir, files.find(f=>f.endsWith('.txt'))),'utf8'), /Abertura:.*\nEncerramento:/);
  checks.push('Especialista jurídico criado: aceite, chat, escape de HTML, proposta, agenda, execução, entrega, comprovante, conclusão, avaliação, exportação e download');
  for (const route of ['/', '/servicos', '/servicos/advocacia', '/servicos/engenharia', '/servicos/ti', '/especialistas', '/como-funciona', '/chamados', '/mensagens', '/agenda', '/notificacoes', '/conta', '/ajuda', '/termos', '/privacidade', '/sobre']) {
    await nav(route); assert.ok(await evaluate('document.querySelector("main").textContent.length>20'), route);
  }
  await nav('/notificacoes'); await click('[data-action=readNotifications]'); await wait('document.querySelectorAll(".notification-row.unread").length===0');
  await nav('/especialistas'); await click('[data-action=expertFilter][data-id=advocacia]');
  assert.equal(await evaluate('document.querySelectorAll(".expert-card").length'), 4);
  await fill('#expert-search', { query: 'Juridico Auditoria' }); await submit('#expert-search'); await wait('document.querySelectorAll(".expert-card").length===1');
  assert.equal(await evaluate('document.querySelectorAll(".expert-card a,.expert-card button").length'), 0);
  await nav('/admin'); assert.match(await evaluate('document.querySelector("main").textContent'), /restrita/);
  await nav('/ajuda'); await fill('#support-form', { category: 'Problema técnico', message: 'Pedido de suporte fictício na auditoria jurídica.' }); await submit('#support-form'); await wait('document.querySelector("main").textContent.includes("Pedido de suporte fictício")');
  checks.push('Páginas públicas, diretório e busca, notificações, ajuda, restrição da administração e suporte');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await nav(route); assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true); await screenshot('juridico-corrigido-mobile.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  // Privacy regression: persist a client draft, log out, sign in as the unrelated specialist.
  await nav('/novo?setor=advocacia'); await click('[data-action=chooseSector][data-id=advocacia]'); await fill('#request-form', { service: 'Advocacia geral', region: 'PE', city: 'Recife' }); await submit('#request-form'); await wait('!!document.querySelector("#description")');
  const secret = 'SEGREDO-FICTICIO-CLIENTE: conteúdo não enviado ao especialista.';
  await fill('#request-form', { title: 'Rascunho jurídico confidencial fictício', description: secret }); await click('[data-action=previousStep]'); await click('[data-action=saveDraft]'); await submit('#request-form'); await wait('!!document.querySelector("#description")');
  await click('#profile-menu-trigger'); await click('#profile-menu-dropdown [data-action=logout]'); await wait('!document.querySelector("#profile-menu-trigger")');
  await login('legal'); await nav('/novo?setor=advocacia'); await wait('!!document.querySelector("#request-form")');
  assert.equal(await evaluate('!!document.querySelector("#description")'), false);
  assert.equal(await evaluate('localStorage.getItem("mvp-draft")'), null);
  await fill('#request-form', {service:'Advocacia geral',region:'PE',city:'Recife'}); await submit('#request-form'); await wait('!!document.querySelector("#description")');
  assert.equal(await evaluate('document.querySelector("#description").value'), '');
  await screenshot('rascunho-isolado-outra-conta.png');
  findings.push({id:'DRAFT-LEAK',fixed:true,observed:'Após logout e login da outra conta, o rascunho anterior foi removido.'});
  await cdp('Page.reload'); await wait('!!document.querySelector("#request-form")');
  assert.equal(await evaluate('document.querySelector("#request-form").textContent.includes("SEGREDO-FICTICIO")'),false);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'browser-retest-results.json'), JSON.stringify({ completed: true, checks, findings, errors, database, ticketId, downloads: files }, null, 2));
  console.log(JSON.stringify({ completed: true, checks, findings, errors, database, ticketId, downloads: files }, null, 2));
} finally { await fetch(`${debug}/json/close/${target.id}`).catch(()=>{}); socket.close(); await c.app.close(); }
