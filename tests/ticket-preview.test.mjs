import test from 'node:test';
import assert from 'node:assert/strict';
import { context } from '../scripts/security-audit.mjs';

test('API: especialista compatível lê a solicitação antes do aceite, sem abrir atendimento ou expor contatos', async t => {
  const c = await context(); t.after(() => c.app.close());
  await c.ok(c.client.action('profile', { phone: '(81) 95555-5555', contactEmail: 'privado.preview@example.test' }));
  const id = await c.ticket('Avaliar necessidade antes de aceitar', { description: 'Descrição fictícia completa para avaliar o serviço solicitado.', details: 'Detalhes complementares fictícios do pedido.' });
  const view = await c.legal.state(), waiting = view.tickets.find(t => t.id === id);
  assert.equal(waiting.description, 'Descrição fictícia completa para avaliar o serviço solicitado.');
  assert.equal(waiting.details, 'Detalhes complementares fictícios do pedido.');
  assert.equal(waiting.status, 'waiting'); assert.equal(waiting.startedAt, null); assert.equal(waiting.professionalId, null);
  assert.deepEqual(waiting.threads, []); assert.equal(waiting.clientId, undefined);
  assert.equal(JSON.stringify(view).includes('privado.preview@example.test'), false);
  assert.equal(JSON.stringify(view).includes('(81) 95555-5555'), false);
  assert.equal(view.user.activeCount, 0);
  for (const who of [c.agent(), c.outsider, c.admin]) assert.equal((await who.state()).tickets.some(t => t.id === id), false);
  assert.equal((await c.legal.action('message', { ticketId: id, text: 'Não posso conversar antes do aceite' })).status, 403);
  await c.accept(id);
  assert.equal((await c.alternate.state()).tickets.some(t => t.id === id), false);
  assert.equal((await c.legal.state()).user.activeCount, 1);
  assert.ok((await c.get(id)).startedAt);
});

test('API: novo especialista vê detalhes na fila de transferência sem receber chat, proposta ou anexo anterior', async t => {
  const c = await context(); t.after(() => c.app.close());
  const id = await c.ticket('Solicitação devolvida à fila', { details: 'Informações do pedido para avaliar o aceite.' });
  await c.accept(id); await c.ok(c.client.action('message', { ticketId: id, text: 'SEGREDO_DA_CONVERSA_ANTERIOR' }));
  const fileId = await c.upload(id); await c.proposal(id);
  await c.ok(c.client.action('release', { ticketId: id, reason: 'Sem acordo; retornar para a fila.' }));
  const view = (await c.alternate.state()).tickets.find(t => t.id === id);
  assert.equal(view.details, 'Informações do pedido para avaliar o aceite.');
  assert.ok(view.description); assert.deepEqual(view.threads, []); assert.equal(view.proposals, undefined);
  assert.equal(JSON.stringify(view).includes('SEGREDO_DA_CONVERSA_ANTERIOR'), false);
  assert.equal((await c.alternate(`/files/${fileId}`)).status, 404);
});
