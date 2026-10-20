import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, normalizeState, act, projectState } from '../public/domain.js';

const options = { now: '2026-10-20T13:00:00.000Z', hour: 10 };
test('Especialidades jurídicas: migra perfis existentes sem alterar atendimentos e contatos', () => {
  const state = createState(), tayane = state.users.find(u => u.id === 'tayane'), miguel = state.users.find(u => u.id === 'miguel');
  Object.assign(tayane, { specialty: 'Perfil anterior de teste', services: ['Advocacia geral'], phone: '(81) 90000-0000' });
  const client = state.users.find(u => u.id === 'cliente');
  const { ticketId } = act(state, client, 'createTicket', { sector: 'advocacia', service: 'Advocacia geral', region: 'PE', city: 'Recife', title: 'Caso de teste anterior', description: 'Caso fictício aberto antes da atualização dos perfis jurídicos.', agreed: true }, options);
  act(state, tayane, 'accept', { ticketId }, options);
  act(state, tayane, 'message', { ticketId, text: 'Histórico anterior preservado.' }, options);
  tayane.specialty = 'Advogado geral';
  Object.assign(miguel, { specialty: 'Advogado criminal', services: ['Direito criminal'], contactEmail: 'contato@empresa.example' });
  const history = JSON.stringify(state.tickets);
  normalizeState(state);
  assert.equal(tayane.specialty, 'Direito criminal'); assert.deepEqual(tayane.services, ['Direito criminal']);
  assert.equal(miguel.specialty, 'Advogado geral'); assert.deepEqual(miguel.services, ['Advocacia geral']);
  assert.equal(tayane.phone, '(81) 90000-0000'); assert.equal(miguel.contactEmail, 'contato@empresa.example');
  assert.equal(JSON.stringify(state.tickets), history);
  const once = JSON.stringify(state); assert.equal(JSON.stringify(normalizeState(state)), once);
  act(state, tayane, 'message', { ticketId, text: 'Atendimento anterior continua disponível.' }, options);
  assert.ok(state.tickets[0].threads[0].messages.some(m => m.text.includes('continua disponível')));
});

test('Especialidades jurídicas: fila e aceite respeitam Tayane criminal e Miguel geral', () => {
  const state = createState(), client = state.users.find(u => u.id === 'cliente');
  const tayane = state.users.find(u => u.id === 'tayane'), miguel = state.users.find(u => u.id === 'miguel');
  const create = service => act(state, client, 'createTicket', { sector: 'advocacia', service, region: 'PE', city: 'Recife', title: 'Consulta jurídica fictícia', description: 'Solicitação fictícia para verificar o encaminhamento por especialidade.', agreed: true }, options).ticketId;
  const general = create('Advocacia geral'), criminal = create('Direito criminal');
  assert.deepEqual(projectState(state, tayane).tickets.map(t => t.id), [criminal]);
  assert.deepEqual(projectState(state, miguel).tickets.map(t => t.id), [general]);
  assert.throws(() => act(state, tayane, 'accept', { ticketId: general }, options), e => e.status === 403);
  assert.throws(() => act(state, miguel, 'accept', { ticketId: criminal }, options), e => e.status === 403);
  act(state, tayane, 'accept', { ticketId: criminal }, options);
  act(state, miguel, 'accept', { ticketId: general }, options);
  assert.equal(state.tickets.find(t => t.id === criminal).professionalId, 'tayane');
  assert.equal(state.tickets.find(t => t.id === general).professionalId, 'miguel');
});
