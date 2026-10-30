// End-to-end sign-up on the published site: a visitor creates an account, the
// profile is persisted on the Neon branch, survives a reload and a fresh sign-in,
// and lands as an ordinary client. Creates one real account per run.
import assert from 'node:assert/strict';
import { connectPostgres } from '../lib/postgres-store.mjs';

const site = process.env.SITE_URL || 'https://mpv-solucoes.netlify.app';
const debug = `http://127.0.0.1:${process.env.CDP_PORT || 9345}`;
const stamp = Date.now();
const email = process.env.SIGNUP_EMAIL || `verificacao.cadastro.${stamp}@exemplo.test`;
const password = `verificacao-${stamp}-ok`;
const name = `Verificacao Cadastro ${stamp}`;

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
async function wait(expression, limit = 30000) { const end = Date.now() + limit; let last; do { last = await evaluate(expression); if (last) return last; await new Promise(r => setTimeout(r, 250)); } while (Date.now() < end); throw new Error('Timeout: ' + expression); }
async function click(selector) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(selector, values) { await evaluate(`(() => {const f=document.querySelector(${JSON.stringify(selector)}); for(const [k,v] of Object.entries(${JSON.stringify(values)})){const e=f.elements[k]; e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}})()`); }
const checkbox = (selector, field) => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}).elements[${JSON.stringify(field)}]; e.checked=true; e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
// The tab button is bound on each render, so a click can land between renders
// and be lost. Retry until the form actually switches mode.
const openTab = async tab => {
  await cdp('Page.navigate', { url: `${site}/#/entrar` });
  await wait('!!document.querySelector("#auth-form")');
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await evaluate(`document.querySelector("#auth-form")?.dataset.mode==="${tab}"`)) return;
    await evaluate(`document.querySelector("[data-action=authTab][data-id=${tab}]")?.click()`);
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`a aba ${tab} não abriu: modo ${await evaluate('document.querySelector("#auth-form")?.dataset.mode')}`);
};
const formError = () => evaluate('document.querySelector("#form-error")?.textContent || ""');

const database = await connectPostgres(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');

  // The visitor fills in the public sign-up form and submits it.
  await openTab('register');
  await fill('#auth-form', { name, email, password });
  await checkbox('#auth-form', 'agreed');
  await submit('#auth-form');
  const signedIn = await wait('!!document.querySelector("#profile-menu-trigger") || (document.querySelector("#form-error")?.textContent || "").length > 0');
  const message = await formError();
  assert.equal(await evaluate('!!document.querySelector("#profile-menu-trigger")'), true, `o cadastro não abriu sessão: ${message || signedIn}`);
  checks.push('cadastro concluído no site publicado e sessão aberta na hora');

  // The account is an ordinary client, with no administration attached.
  const session = await evaluate('fetch(window.__apiBase ? window.__apiBase + "/api/state" : "/api/state").then(r=>r.json()).catch(()=>null)')
    || await evaluate('(window.__state ? { user: window.__state.user, admin: window.__state.admin } : null)');
  const profile = await wait('(() => { const n = document.querySelector("#profile-menu-trigger")?.textContent || ""; return n.trim() || false; })()');
  assert.ok(profile, 'o menu do perfil não exibiu o nome');
  const nav = await evaluate('[...document.querySelectorAll(".nav-link")].map(a=>a.getAttribute("href"))');
  assert.equal(nav.includes('#/admin'), false, 'conta nova recebeu o menu de administração');
  checks.push(`conta criada aparece no site como "${profile}" e sem menu de administração`);

  // The MVP profile is created on the first authenticated API call, not by the
  // sign-up itself: Neon Auth owns the credential, `neonIdentity()` links it to
  // a profile. Poll instead of assuming it is already there.
  const find = async () => {
    const state = await database.store.read();
    return state.users.find(u => u.email?.toLocaleLowerCase('pt-BR') === email.toLocaleLowerCase('pt-BR'));
  };
  let saved = null;
  for (let attempt = 0; attempt < 20 && !saved; attempt++) {
    saved = await find();
    if (!saved) { await evaluate('location.hash="/chamados"'); await new Promise(r => setTimeout(r, 1000)); }
  }
  assert.ok(saved, `o perfil não foi gravado no banco: ${email}`);
  assert.equal(saved.role, 'client', `o perfil foi salvo como ${saved.role}`);
  assert.equal(saved.admin === true, false, 'o perfil foi salvo como administrador');
  assert.equal(saved.active, true, 'o perfil foi salvo inativo');
  assert.ok(saved.createdAt, 'o perfil foi salvo sem data de criação');
  checks.push(`perfil gravado no banco Neon: id ${saved.id}, papel ${saved.role}, ativo, criado em ${saved.createdAt}`);

  // The session survives a full reload: the profile is not session-only state.
  await cdp('Page.navigate', { url: `${site}/#/` });
  await wait('!!document.querySelector("#profile-menu-trigger")');
  checks.push('sessão sobrevive ao recarregamento completo da página');

  // Signing out and back in proves the credential itself was stored.
  await click('#profile-menu-trigger');
  await click('#profile-menu-dropdown [data-action=logout]');
  // Sign-out goes through Neon Auth: wait for the session to actually drop,
  // otherwise /entrar redirects and the form never renders.
  await wait('!document.querySelector("#profile-menu-trigger")');
  await openTab('login');
  await fill('#auth-form', { login: email, password: `${password}-errada` });
  await submit('#auth-form');
  await wait('(document.querySelector("#form-error")?.textContent || "").length > 0');
  checks.push(`senha errada recusada no site: "${(await formError()).trim()}"`);

  await openTab('login');
  // Confirm the form really carries the values before submitting, so a failure
  // here is the application's answer and not a lost keystroke.
  await fill('#auth-form', { login: email, password });
  const typed = await evaluate('(() => { const f = document.querySelector("#auth-form"); return { login: f.elements.login.value, senha: f.elements.password.value.length }; })()');
  assert.equal(typed.login, email, `o campo de login ficou com "${typed.login}"`);
  assert.equal(typed.senha, password.length, 'o campo de senha não recebeu o valor completo');
  await evaluate('document.querySelector("#form-error").textContent = ""');
  await submit('#auth-form');
  await wait('!!document.querySelector("#profile-menu-trigger") || (document.querySelector("#form-error")?.textContent || "").length > 0');
  assert.equal(await evaluate('!!document.querySelector("#profile-menu-trigger")'), true, `o novo acesso falhou: ${(await formError()).trim()}`);
  checks.push('conta entra de novo com a própria senha depois de sair');

  // The client can reach what they signed up for.
  await evaluate('location.hash="/novo"');
  await wait('!!document.querySelector("#request-form")');
  checks.push('cliente recém-cadastrado alcança o formulário de nova solicitação');

  const noise = /favicon|404|ERR_|Failed to load resource/i;
  assert.deepEqual(errors.filter(e => !noise.test(e)), [], `erros de console: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ passed: true, site, email, checks, errors }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ passed: false, site, email, checks, errors, failure: error.message }, null, 2));
  process.exitCode = 1;
} finally { socket.close(); await database.close(); }
