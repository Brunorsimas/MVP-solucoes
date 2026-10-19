import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, act, activeCount, professionalCapacity, profileCompletion, projectState } from '../public/domain.js';
import { context } from '../scripts/security-audit.mjs';

const full = { name: 'Especialista Teste', phone: '(81) 90000-0000', contactEmail: 'perfil@example.test', region: 'PE', city: 'Recife', bio: 'Apresentação profissional fictícia para testar o cadastro.' };
const options = { hour: 10, now: '2026-10-19T13:00:00.000Z' };

test('Perfil: terceira vaga em todos os setores, somente com seis informações válidas', () => {
  for (const id of ['tayane', 'marcos', 'bruno']) {
    const state = createState(), user = state.users.find(u => u.id === id);
    assert.equal(professionalCapacity(user), 2);
    act(state, user, 'profile', { ...full, capacity: 99, profileCompletion: { complete: true } }, options);
    assert.equal(professionalCapacity(user), 3);
    assert.equal(profileCompletion(user).filled, 6);
    for (const field of Object.keys(full)) assert.equal(professionalCapacity({ ...user, [field]: '' }), 2, field);
    assert.equal(professionalCapacity({ ...user, bio: 'curta' }), 2);
    assert.equal(professionalCapacity({ ...user, city: ' ' }), 2);
    const visible = projectState(state, null).professionals.find(u => u.id === id);
    assert.equal(visible.capacity, 3);
    for (const field of ['phone', 'contactEmail', 'city', 'region', 'profileCompletion']) assert.equal(Object.hasOwn(visible, field), false, field);
  }
});

test('API: limite transacional 2/3, concorrência, notificações e remoção de dados', async t => {
  const c = await context(); t.after(() => c.app.close());
  const ids = []; for (let i = 0; i < 5; i++) ids.push(await c.ticket('Capacidade de atendimento ' + i));
  await c.accept(ids[0]); await c.accept(ids[1]);
  await c.ok(c.legal.action('profile', { capacity: 3, profileCompletion: { complete: true } }));
  assert.equal((await c.legal.action('accept', { ticketId: ids[2] })).status, 409);
  await c.ok(c.legal.action('profile', full));
  let view = await c.legal.state();
  assert.equal(view.user.capacity, 3);
  assert.equal(view.notifications.some(n => n.title === 'Terceira vaga liberada'), true);
  assert.equal(view.notifications.some(n => n.title === 'Você tem uma vaga disponível'), true);
  const responses = await Promise.all(ids.slice(2, 4).map(ticketId => c.legal.action('accept', { ticketId })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(activeCount(c.app.load(), c.legalId), 3);
  await c.ok(c.legal.action('profile', { phone: '' }));
  assert.equal((await c.legal.state()).user.capacity, 2);
  assert.equal(activeCount(c.app.load(), c.legalId), 3);
  assert.equal((await c.legal.action('accept', { ticketId: ids[4] })).status, 409);
  await c.ok(c.client.action('cancel', { ticketId: ids[0] }));
  assert.equal((await c.legal.action('accept', { ticketId: ids[4] })).status, 409);
  await c.ok(c.client.action('cancel', { ticketId: ids[1] }));
  await c.ok(c.legal.action('accept', { ticketId: ids[4] }));
  // A complete specialist with two active cases must receive new queue alerts.
  await c.ok(c.legal.action('profile', full));
  const next = await c.ticket('Alerta para a terceira vaga');
  view = await c.legal.state();
  assert.equal(view.notifications.some(n => n.ticketId === next && n.title === 'Novo chamado disponível'), true);
});
