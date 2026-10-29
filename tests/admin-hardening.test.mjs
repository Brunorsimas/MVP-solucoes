// Final hardening sweep over the administration: a non-admin must not reach any
// administrative action by any route, and no path may ever delete a profile
// without an explicit, confirmed administrator decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, act, projectState, isAdmin, sectorOf, DELETED_RETENTION_DAYS } from '../public/domain.js';

const at = '2026-10-29T13:00:00.000Z';
const fresh = () => {
  const state = createState(at);
  return [state, state.users.find(u => u.id === 'bruno'), state.users.find(u => u.id === 'kleber'), state.users.find(u => u.id === 'cliente')];
};

// Every administrative action refuses a specialist, a client, and a forged admin flag.
test('administração: nenhuma ação alcança quem não é o administrador', () => {
  const [state, admin, pro, client] = fresh();
  const forged = { ...pro, admin: 'true', permissions: ['manageUsers'] };
  const actions = [
    ['createUser', { name: 'Intruso', email: 'intruso@teste.com', password: 'senha-do-intruso-x' }],
    ['deleteUser', { id: client.id, confirm: client.name }],
    ['setSector', { id: pro.id, sector: 'ti', services: ['Suporte técnico'] }],
    ['toggleProfessional', { id: client.id }],
    ['resolveSupport', { id: 'inexistente' }]
  ];
  for (const [name, payload] of actions) for (const actor of [pro, client, forged]) {
    assert.throws(() => act(state, actor, name, payload, { now: at }), /Acesso restrito/, `${name} aceitou ${actor.id}`);
  }
  assert.equal(isAdmin(forged), false, 'admin:"true" como texto não autoriza');
  assert.equal(state.users.length, 9, 'nenhum perfil criado ou removido pelas tentativas');
  assert.ok(state.users.every(u => !u.deletedAt), 'nenhum perfil marcado como excluído');
  assert.equal(admin.active, true);
});

// A client profile never receives the specialist controls through the payload.
test("administração: cliente nunca recebe setor, serviços ou fila", () => {
  const [state, admin, , client] = fresh();
  assert.throws(() => act(state, admin, 'setSector', { id: client.id, sector: 'ti', services: ['Suporte técnico'] }, { now: at }), /Apenas especialistas/);
  assert.equal(client.sector, undefined, 'cliente continua sem setor');
  assert.equal(client.role, 'client', 'cliente não vira especialista');
  const view = projectState(state, admin, { now: at }).admin.users.find(u => u.id === client.id);
  assert.equal(view.sector, null);
  assert.deepEqual(view.services, []);
  assert.equal(view.capacity, undefined, 'cliente não tem capacidade de fila');
});

// The administrator cannot be deleted, suspended, or locked out by anyone.
test("administração: administrador não pode ser excluído nem suspenso", () => {
  const [state, admin, pro] = fresh();
  assert.throws(() => act(state, admin, 'deleteUser', { id: admin.id, confirm: admin.name }, { now: at }), /própria conta/);
  assert.throws(() => act(state, pro, 'deleteUser', { id: admin.id, confirm: admin.name }, { now: at }), /Acesso restrito/);
  assert.throws(() => act(state, admin, 'toggleProfessional', { id: admin.id }, { now: at }), /Perfil inválido/);
  assert.equal(admin.active, true);
  assert.equal(admin.deletedAt, undefined);
});

// Deletion is never implicit: the exact name is mandatory and nothing expires on its own.
test("administração: exclusão exige nome exato e nada expira sozinho", () => {
  const [state, admin, , client] = fresh();
  for (const confirm of [undefined, '', ' ', 'usuário', client.name.toUpperCase(), `${client.name} `, null]) {
    assert.throws(() => act(state, admin, 'deleteUser', { id: client.id, confirm }, { now: at }), /nome exato/, `confirmação aceita: ${JSON.stringify(confirm)}`);
  }
  assert.equal(client.deletedAt, undefined, 'nada foi excluído pelas confirmações inválidas');
  act(state, admin, 'deleteUser', { id: client.id, confirm: client.name }, { now: at });
  assert.equal(client.deletedAt, at);
  // Past the retention window the profile is still there: removal is always an act.
  const wayLater = new Date(Date.parse(at) + 5000 * 86400000).toISOString();
  projectState(state, admin, { now: wayLater });
  act(state, admin, 'readNotifications', {}, { now: wayLater });
  assert.ok(state.users.some(u => u.id === 'cliente'), 'perfil excluído continua guardado após o prazo');
  const view = projectState(state, admin, { now: wayLater }).admin.users.find(u => u.id === 'cliente');
  assert.equal(view.retentionDays, 0, 'a contagem chega a zero sem apagar nada');
  assert.equal(view.name, 'Usuário removido');
});

// A suspended specialist stops being matched; reactivation restores the queue.
test("administração: suspensão bloqueia e reativação devolve o acesso", () => {
  const [state, admin, pro] = fresh();
  const before = projectState(state, admin, { now: at }).professionals.find(p => p.id === pro.id);
  assert.equal(before.active, true);
  act(state, admin, 'toggleProfessional', { id: pro.id }, { now: at });
  assert.equal(pro.active, false);
  // No domínio o bloqueio é 401; a mensagem "Usuário desativado…" vem do login (403).
  assert.throws(() => act(state, pro, 'readNotifications', {}, { now: at }), /conta ativa/i);
  act(state, admin, 'toggleProfessional', { id: pro.id }, { now: at });
  assert.equal(pro.active, true);
  act(state, pro, 'readNotifications', {}, { now: at });
});

// Changing the sector never touches the ticket rules, only the queue.
test("administração: troca de setor preserva o atendimento em curso", () => {
  const [state, admin, pro, client] = fresh();
  const ticket = act(state, client, 'createTicket', { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Chamado de teste', description: 'Descrição fictícia com mais de vinte caracteres.', agreed: true }, { now: at, hour: 10 });
  act(state, pro, 'accept', { ticketId: ticket.ticketId }, { now: at, hour: 10 });
  act(state, admin, 'setSector', { id: pro.id, sector: 'advocacia', services: ['Advocacia geral'] }, { now: at });
  const open = state.tickets.find(t => t.id === ticket.ticketId);
  assert.equal(open.professionalId, pro.id, 'o atendimento em curso continua com o especialista');
  assert.notEqual(open.status, 'cancelled');
  act(state, pro, 'message', { ticketId: ticket.ticketId, text: 'Mensagem após a troca de setor.' }, { now: at, hour: 10 });
  assert.ok(open.threads.some(t => t.messages?.some(m => m.text?.includes('após a troca'))), 'o chat segue funcionando');
});

// Service list is always validated against the chosen sector.
test("administração: setor e serviços validados contra chaves de protótipo", () => {
  const [state, admin, pro] = fresh();
  assert.throws(() => act(state, admin, 'setSector', { id: pro.id, sector: 'advocacia', services: [] }, { now: at }), /ao menos um serviço/);
  assert.throws(() => act(state, admin, 'setSector', { id: pro.id, sector: 'advocacia', services: ['Suporte técnico'] }, { now: at }), /ao menos um serviço/);
  assert.throws(() => act(state, admin, 'setSector', { id: pro.id, sector: '__proto__', services: ['x'] }, { now: at }), /setor válido/);
  assert.throws(() => act(state, admin, 'setSector', { id: pro.id, sector: 'constructor', services: ['x'] }, { now: at }), /setor válido/);
  act(state, admin, 'setSector', { id: pro.id, sector: 'advocacia', services: ['Advocacia geral', 'Advocacia geral'] }, { now: at });
  assert.deepEqual(pro.services, ['Advocacia geral'], 'duplicatas são descartadas');
});

// The administration view exposes nothing extra to a regular account.
test("administração: conta comum não recebe o bloco de administração", () => {
  const [state, , pro, client] = fresh();
  for (const actor of [pro, client]) {
    const view = projectState(state, actor, { now: at });
    assert.equal(view.admin, null, `${actor.id} recebeu o bloco de administração`);
    assert.equal(view.user.admin, false);
    assert.equal('permissions' in view.user, false, 'a chave de permissões não existe mais');
  }
});
