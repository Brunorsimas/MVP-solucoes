// Read-only check of public sign-up on the published site. It stops short of
// creating an account: it only confirms the tab renders, the form validates and
// the Neon Auth endpoint accepts the published origin.
import assert from 'node:assert/strict';

const site = process.env.SITE_URL || 'https://mpv-solucoes.netlify.app';
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
async function wait(expression) { const end = Date.now() + 25000; do { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 200)); } while (Date.now() < end); throw new Error('Timeout: ' + expression); }
async function click(selector) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(selector, values) { await evaluate(`(() => {const f=document.querySelector(${JSON.stringify(selector)}); for(const [k,v] of Object.entries(${JSON.stringify(values)})){const e=f.elements[k]; e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}})()`); }

try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.navigate', { url: `${site}/#/entrar` });
  await wait('!!document.querySelector("#auth-form")');

  // The published build must not advertise the demonstration accounts.
  // The published site talks to the Neon Function on another host: the API base
  // and the auth base both come from the bundle, not from a relative path.
  const bundle = await (await fetch(`${site}/app.js`)).text().catch(() => '');
  const apiBase = (bundle.match(/https:\/\/[a-z0-9-]+\.compute\.[a-z0-9.-]+/) || [])[0];
  assert.ok(apiBase, 'não foi possível descobrir a URL da API no bundle publicado');
  const config = await fetch(`${apiBase}/api/state`).then(r => r.json()).then(s => ({ teste: s.config?.testLoginEnabled, modo: s.config?.mode, auth: s.config?.authProvider, authUrl: s.config?.authUrl }));
  assert.equal(config.teste, false, 'o acesso temporário continua ativo em produção');
  checks.push('API publicada confirma testLoginEnabled desativado');
  const page = await evaluate('document.body.innerText');
  assert.equal(page.includes('123'), false, 'a tela de acesso cita a senha de demonstração');
  assert.equal(await evaluate('!!document.querySelector(".test-credentials")'), false, 'a tabela de acessos de teste aparece no site');
  checks.push('tela de acesso publicada não lista acessos de demonstração nem a senha 123');

  // The sign-up tab is offered to the visitor.
  await click('[data-action=authTab][data-id=register]');
  await wait('document.querySelector("#auth-form")?.dataset.mode==="register"');
  const fields = await evaluate('[...document.querySelector("#auth-form").elements].map(e=>e.name).filter(Boolean)');
  for (const name of ['name', 'email', 'password', 'agreed']) assert.ok(fields.includes(name), `campo ausente: ${name}`);
  checks.push('aba Criar conta disponível em produção com nome, e-mail, senha e aceite');

  // The interface refuses the short password before any request leaves.
  await fill('#auth-form', { name: 'Visitante Producao', email: 'visitante.producao@exemplo.test', password: 'curta' });
  assert.equal(await evaluate('document.querySelector("#auth-form").checkValidity()'), false, 'senha curta passou na validação');
  checks.push('senha com menos de 10 caracteres é barrada antes do envio');

  // The published origin must be accepted by Neon Auth, otherwise sign-up and
  // sign-in are both broken for every visitor.
  const authUrl = config.authUrl || (bundle.match(/https:\/\/[a-z0-9-]+\.neonauth\.[a-z0-9.-]+\/[a-z]+\/auth/) || [])[0];
  assert.ok(authUrl, 'não foi possível descobrir a URL do Neon Auth');
  const probe = await evaluate(`fetch(${JSON.stringify(authUrl)} + '/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ninguem.existe@exemplo.test', password: 'senha-invalida-aqui' }) })
      .then(r => r.json().then(b => ({ url: ${JSON.stringify(authUrl)}, status: r.status, code: b.code || b.message })))
      .catch(e => ({ url: ${JSON.stringify(authUrl)}, erro: String(e) }))`);
  assert.notEqual(probe.code, 'INVALID_ORIGIN', `Neon Auth recusa a origem publicada: ${JSON.stringify(probe)}`);
  checks.push(`Neon Auth aceita a origem publicada (resposta ${probe.status} ${probe.code})`);

  assert.deepEqual(errors.filter(e => !/favicon|404/i.test(e)), [], `erros de console: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ passed: true, site, config, checks, errors }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ passed: false, site, checks, errors, failure: error.message }, null, 2));
  process.exitCode = 1;
} finally { socket.close(); }
