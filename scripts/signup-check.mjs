// Sweep over public sign-up against the local API: the public form must only
// ever produce ordinary client accounts, and must reject anything malformed.
import assert from 'node:assert/strict';

const base = process.env.SIGNUP_BASE || 'http://127.0.0.1:4173/api';
const checks = [];
const stamp = Date.now();
const mail = suffix => `teste.${stamp}.${suffix}@exemplo.test`;

// Sign-up is throttled at 10 per minute per IP, checked before any validation.
// The sweep needs more than that, so it waits out the window instead of
// weakening the limit. Check 10 below proves the limit still bites.
let registers = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function window_(count = 1) {
  if (registers + count > 9) { await sleep(61000); registers = 0; }
  registers += count;
}

async function post(path, payload, cookie) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body, cookie: response.headers.get('set-cookie') };
}
const read = async cookie => (await fetch(base + '/state', { headers: cookie ? { cookie } : {} })).json();

// 1. The happy path: a visitor registers and lands as a plain client.
{
  const email = mail('ok');
  await window_();
  const created = await post('/auth/register', { name: 'Visitante Teste', email, password: 'senha-de-visitante', agreed: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.cookie, 'o cadastro não abriu sessão');
  const state = await read(created.cookie);
  assert.equal(state.user.role, 'client');
  assert.equal(state.user.admin, false);
  assert.equal(state.admin ?? null, null, 'conta nova recebeu o bloco de administração');
  assert.equal(state.user.email, email);
  checks.push('cadastro público cria conta de cliente e abre sessão');
}

// 2. A forged payload never buys a role, admin rights or queue capacity.
{
  const email = mail('forjado');
  await window_();
  const created = await post('/auth/register', {
    name: 'Invasor Teste', email, password: 'senha-do-invasor', agreed: true,
    role: 'professional', admin: true, sector: 'ti', services: ['Suporte técnico'],
    active: true, capacity: 99, permissions: ['manageUsers'], id: 'bruno'
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const state = await read(created.cookie);
  assert.equal(state.user.role, 'client', 'payload forjado virou especialista');
  assert.equal(state.user.admin, false, 'payload forjado virou administrador');
  assert.equal(state.user.id === 'bruno', false, 'payload forjado assumiu o id do administrador');
  assert.equal(state.admin ?? null, null);
  assert.equal(state.user.capacity, undefined, 'cliente recebeu capacidade de fila');
  assert.equal('permissions' in state.user, false);
  checks.push('role, admin, id, setor e capacidade forjados no payload são ignorados');
}

// 3. Invalid input is refused, and nothing is created.
{
  const cases = [
    ['sem aceite dos termos', { name: 'Sem Aceite', email: mail('r1'), password: 'senha-valida-aqui' }],
    ['aceite como texto', { name: 'Aceite Texto', email: mail('r2'), password: 'senha-valida-aqui', agreed: 'true' }],
    ['senha curta', { name: 'Senha Curta', email: mail('r3'), password: 'curta', agreed: true }],
    ['senha ausente', { name: 'Sem Senha', email: mail('r4'), agreed: true }],
    ['nome de um caractere', { name: 'X', email: mail('r5'), password: 'senha-valida-aqui', agreed: true }],
    ['nome em branco', { name: '   ', email: mail('r6'), password: 'senha-valida-aqui', agreed: true }],
    ['e-mail sem arroba', { name: 'Email Ruim', email: 'nao-e-email', password: 'senha-valida-aqui', agreed: true }],
    ['e-mail sem domínio', { name: 'Email Ruim', email: 'alguem@', password: 'senha-valida-aqui', agreed: true }],
    ['e-mail ausente', { name: 'Sem Email', password: 'senha-valida-aqui', agreed: true }]
  ];
  for (const [label, payload] of cases) {
    await window_();
    const response = await post('/auth/register', payload);
    assert.equal(response.status, 400, `${label} foi aceito (${response.status})`);
    assert.ok(response.body.error, `${label} respondeu sem mensagem`);
  }
  checks.push(`${cases.length} cadastros inválidos recusados com 400 e mensagem`);
}

// 4. A duplicate e-mail is a conflict, never a crash and never a second account.
{
  const email = mail('dup');
  await window_(3);
  assert.equal((await post('/auth/register', { name: 'Primeiro Dono', email, password: 'senha-do-primeiro', agreed: true })).status, 201);
  const again = await post('/auth/register', { name: 'Outra Pessoa', email, password: 'senha-de-outro-x', agreed: true });
  assert.equal(again.status, 409, `e-mail repetido respondeu ${again.status}`);
  const upper = await post('/auth/register', { name: 'Caixa Alta', email: email.toUpperCase(), password: 'senha-de-outro-x', agreed: true });
  assert.equal(upper.status, 409, `o mesmo e-mail em maiúsculas respondeu ${upper.status}`);
  checks.push('e-mail repetido responde 409, inclusive em caixa alta, sem 500');
}

// 5. Two simultaneous sign-ups with the same e-mail: one wins, the other is a
//    clean conflict. This is the race that used to surface as a 500.
{
  const email = mail('corrida');
  const payload = { name: 'Corrida Teste', email, password: 'senha-da-corrida', agreed: true };
  await window_(2);
  const results = await Promise.all([post('/auth/register', payload), post('/auth/register', payload)]);
  const status = results.map(r => r.status).sort();
  assert.deepEqual(status, [201, 409], `corrida respondeu ${JSON.stringify(status)}`);
  checks.push('cadastro concorrente com o mesmo e-mail: um 201 e um 409, sem erro interno');
}

// 6. The new account can sign in with its own password and not with another's.
{
  const email = mail('login');
  await window_();
  await post('/auth/register', { name: 'Login Teste', email, password: 'senha-de-login-ok', agreed: true });
  assert.equal((await post('/auth/login', { login: email, password: 'senha-errada-aqui' })).status, 401);
  const ok = await post('/auth/login', { login: email, password: 'senha-de-login-ok' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await read(ok.cookie)).user.email, email);
  checks.push('a conta criada entra com a própria senha e recusa senha errada');
}

// 7. The stored password is never the plain text, and never comes back out.
{
  const email = mail('hash');
  const password = 'senha-secreta-unica';
  await window_();
  const created = await post('/auth/register', { name: 'Hash Teste', email, password, agreed: true });
  const state = await read(created.cookie);
  const dump = JSON.stringify(state);
  assert.equal(dump.includes(password), false, 'a senha aparece na resposta da API');
  assert.equal(dump.includes('"hash"'), false, 'o hash é exposto ao cliente');
  assert.equal(dump.includes('"salt"'), false, 'o salt é exposto ao cliente');
  checks.push('senha, hash e salt nunca voltam na resposta da API');
}

// 8. Oversized fields are cut or refused, never stored whole.
{
  const email = mail('grande');
  await window_(2);
  const created = await post('/auth/register', { name: 'N'.repeat(5000), email, password: 'senha-tamanho-ok', agreed: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const state = await read(created.cookie);
  assert.ok(state.user.name.length <= 70, `nome guardado com ${state.user.name.length} caracteres`);
  const longMail = await post('/auth/register', { name: 'Email Longo', email: 'a'.repeat(250) + '@exemplo.test', password: 'senha-tamanho-ok', agreed: true });
  assert.equal(longMail.status, 400, `e-mail de 260+ caracteres respondeu ${longMail.status}`);
  checks.push('nome é cortado em 70 caracteres e e-mail longo demais é recusado');
}

// 9. Script in the name is stored as text and escaped by the interface.
{
  const email = mail('xss');
  await window_();
  const created = await post('/auth/register', { name: '<script>alert(1)</script>', email, password: 'senha-tamanho-ok', agreed: true });
  assert.equal(created.status, 201);
  const state = await read(created.cookie);
  assert.equal(state.user.name, '<script>alert(1)</script>', 'o nome foi alterado na gravação');
  const page = await (await fetch(base.replace(/\/api$/, '') + '/')).text();
  assert.equal(page.includes('alert(1)'), false, 'o nome injetado apareceu no HTML servido');
  checks.push('nome com script é guardado como texto e não vaza para o HTML');
}

// 10. The per-IP limit still bites: it is the only brake on mass sign-up.
{
  await sleep(61000);
  const burst = [];
  for (let i = 0; i < 13; i++) burst.push(await post('/auth/register', { name: `Rajada ${i}`, email: mail(`burst${i}`), password: 'senha-tamanho-ok', agreed: true }));
  const blocked = burst.filter(r => r.status === 429).length;
  assert.ok(blocked >= 3, `a rajada de 13 cadastros teve apenas ${blocked} bloqueios`);
  assert.equal(burst.slice(0, 10).every(r => r.status === 201), true, 'cadastros dentro do limite foram recusados');
  registers = 99;
  checks.push(`limite por IP ativo: ${blocked} de 13 cadastros seguidos recusados com 429`);
}

console.log(JSON.stringify({ passed: true, checks }, null, 2));
