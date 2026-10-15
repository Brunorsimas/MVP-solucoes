import test from 'node:test';
import assert from 'node:assert/strict';
import { staticRequest } from '../public/demo.js';
import { createState, DEMO_USERS } from '../public/domain.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function reset() { globalThis.localStorage = storage(); globalThis.sessionStorage = storage(); }

test('demonstração exige senha e aceita todas as contas temporárias', () => {
  reset();
  assert.throws(() => staticRequest('/auth/login', { login: 'user', password: 'errada' }), /inválidos/);
  assert.throws(() => staticRequest('/auth/demo', { id: 'bruno' }), /login e a senha/);
  assert.equal(staticRequest('/state').user, null);
  for (const u of DEMO_USERS) {
    staticRequest('/auth/login', { login: u.username, password: '123' });
    assert.equal(staticRequest('/state').user.id, u.id);
    staticRequest('/auth/logout', {});
    assert.equal(staticRequest('/state').user, null);
  }
});
test('migração mantém histórico e atualiza a antiga conta de cliente', () => {
  reset();
  const old = createState();
  const client = old.users.find(u => u.id === 'cliente');
  client.name = 'Ana Oliveira'; client.email = 'ana@example.test'; delete client.username;
  delete old.support; delete old.audit; delete old.createdAt;
  old.notifications.push({ id: 'notice', userId: 'cliente', title: 'Preservar histórico', read: false });
  localStorage.setItem('mvp-solucoes-static-v1', JSON.stringify(old));
  staticRequest('/auth/login', { login: 'user', password: '123' });
  const view = staticRequest('/state');
  assert.equal(view.user.name, 'user');
  assert.equal(view.notifications[0].id, 'notice');
  assert.deepEqual(view.support, []);
});
