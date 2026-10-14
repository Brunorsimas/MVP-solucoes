import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, act, projectState, activeCount, businessOpen, purgeExpired } from '../public/domain.js';
const NOW = '2026-10-14T13:00:00.000Z';
function setup() {
  const state = createState(NOW); const user = id => state.users.find(u => u.id === id);
  const run = (id, action, payload = {}, options = {}) => act(state, user(id), action, payload, { now: NOW, hour: 10, ...options });
  const create = (service = 'Suporte técnico', owner = 'cliente', extra = {}) => run(owner, 'createTicket', { sector: 'ti', service, region: 'PE', city: 'Recife', modality: 'Remoto', title: 'Notebook sem conexão', description: 'Meu notebook não está conseguindo conectar na rede de testes.', agreed: true, ...extra }).ticketId;
  return { state, user, run, create };
}
test('expediente considera 08:00 inclusivo e 19:00 exclusivo no fuso brasileiro', () => {
  assert.equal(businessOpen(new Date('2026-10-14T10:59:59Z')), false);
  assert.equal(businessOpen(new Date('2026-10-14T11:00:00Z')), true);
  assert.equal(businessOpen(new Date('2026-10-14T21:59:59Z')), true);
  assert.equal(businessOpen(new Date('2026-10-14T22:00:00Z')), false);
});
test('abertura fora do expediente é rejeitada no domínio', () => {
  const { run } = setup(); assert.throws(() => run('cliente', 'createTicket', {}, { hour: 19 }), /8h às 19h/);
});
test('aceite é exclusivo e o terceiro atendimento é bloqueado', () => {
  const { state, run, create } = setup(); const a = create(), b = create(), c = create();
  run('bruno', 'accept', { ticketId: a });
  assert.throws(() => run('kleber', 'accept', { ticketId: a }), /já foi assumido/);
  run('bruno', 'accept', { ticketId: b });
  assert.throws(() => run('bruno', 'accept', { ticketId: c }), /dois chamados/);
  assert.equal(activeCount(state, 'bruno'), 2);
});
test('engenheiros também respeitam dois projetos simultâneos', () => {
  const { state, run, create } = setup();
  const make = () => create('Projeto civil', 'cliente', { sector: 'engenharia', modality: 'Presencial' });
  run('marcos', 'accept', { ticketId: make() }); run('marcos', 'accept', { ticketId: make() });
  assert.throws(() => run('marcos', 'accept', { ticketId: make() }), /dois chamados/);
  assert.equal(activeCount(state, 'marcos'), 2);
});
test('especialidade e região são verificadas', () => {
  const { run, create } = setup(); const ticketId = create('Desenvolvimento de software');
  assert.throws(() => run('bruno', 'accept', { ticketId }), /compatível/);
  run('stefanny', 'accept', { ticketId });
  assert.throws(() => create('Suporte técnico', 'cliente', { region: 'SP' }), /Pernambuco/);
});
test('cancelamento antes do início libera a vaga', () => {
  const { state, run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId }); run('cliente', 'cancel', { ticketId });
  assert.equal(activeCount(state, 'bruno'), 0); assert.equal(state.tickets[0].status, 'cancelled');
});
test('primeira interação profissional impede cancelamento automático', () => {
  const { run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId }); run('bruno', 'message', { ticketId, text: 'Olá, vamos avaliar.' });
  assert.throws(() => run('cliente', 'cancel', { ticketId }), /Após o início/);
  run('cliente', 'support', { ticketId, category: 'Solicitar encerramento', message: 'Quero encerrar este atendimento.' });
});
test('proposta exige aprovação exata antes de execução', () => {
  const { state, run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId });
  assert.throws(() => run('bruno', 'startService', { ticketId }), /aprovada/);
  run('bruno', 'proposal', { ticketId, amount: 150, scope: 'Configurar a rede de teste', deadline: '2 dias', terms: 'Após entrega' });
  const first = state.tickets[0].proposals[0];
  run('bruno', 'proposal', { ticketId, amount: 180, scope: 'Configurar rede e impressora', deadline: '3 dias', terms: 'Após entrega' });
  assert.throws(() => run('cliente', 'proposalDecision', { ticketId, proposalId: first.id, decision: 'accepted' }), /não está mais/);
  const p = state.tickets[0].proposals[1]; run('cliente', 'proposalDecision', { ticketId, proposalId: p.id, decision: 'accepted' });
  assert.equal(p.decidedBy, 'cliente'); assert.equal(p.amount, 18000); run('bruno', 'startService', { ticketId });
});
test('fim do atendimento exige entrega e recebimento confirmado', () => {
  const { state, run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId });
  run('bruno', 'proposal', { ticketId, amount: 150, scope: 'Configurar a rede de teste', deadline: '2 dias', terms: 'Após entrega' });
  run('cliente', 'proposalDecision', { ticketId, proposalId: state.tickets[0].proposals[0].id, decision: 'accepted' });
  run('bruno', 'startService', { ticketId }); run('bruno', 'deliver', { ticketId });
  assert.throws(() => run('bruno', 'complete', { ticketId }), /recebimento/);
  run('cliente', 'upload', { ticketId, name: 'comprovante.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 teste').toString('base64'), receipt: true });
  assert.throws(() => run('bruno', 'complete', { ticketId }), /recebimento/);
  run('bruno', 'confirmReceipt', { ticketId, fileId: state.tickets[0].threads[0].files[0].id });
  run('bruno', 'complete', { ticketId }); assert.equal(state.tickets[0].status, 'completed'); assert.equal(activeCount(state, 'bruno'), 0);
});
test('comprovante não pode ser atribuído por um profissional', () => {
  const { run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId });
  assert.throws(() => run('bruno', 'upload', { ticketId, name: 'p.pdf', type: 'application/pdf', data: 'dGVzdGU=', receipt: true }), /Comprovantes/);
});
test('transferência isola mensagens, arquivos e propostas antigas', () => {
  const { state, user, run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId });
  run('cliente', 'message', { ticketId, text: 'Informação privada da conversa anterior.' });
  run('bruno', 'proposal', { ticketId, amount: 150, scope: 'Configurar a rede de teste', deadline: '2 dias', terms: 'Após entrega' });
  run('cliente', 'release', { ticketId, reason: 'Prefiro conversar com outro profissional.' });
  assert.equal(activeCount(state, 'bruno'), 0);
  run('kleber', 'accept', { ticketId });
  const view = projectState(state, user('kleber')).tickets.find(t => t.id === ticketId);
  assert.equal(view.threads.length, 1); assert.equal(view.threads[0].messages.length, 0); assert.equal(view.proposals.length, 0);
  assert.equal(projectState(state, user('bruno')).tickets[0].threads.length, 1);
  assert.equal(projectState(state, user('cliente')).tickets[0].threads.length, 2);
  assert.throws(() => run('bruno', 'message', { ticketId, text: 'Não pode' }), /não participa/);
});
test('administrador não acessa conversas privadas alheias', () => {
  const { state, user, run, create } = setup(); const ticketId = create('Desenvolvimento de software'); run('stefanny', 'accept', { ticketId });
  run('cliente', 'message', { ticketId, text: 'segredo-do-cliente' });
  const view = projectState(state, user('bruno'));
  assert.equal(view.admin.tickets.length, 1); assert.equal(view.tickets.length, 0); assert.ok(!JSON.stringify(view).includes('segredo-do-cliente'));
  assert.throws(() => run('bruno', 'message', { ticketId, text: 'Intrusão' }), /não participa/);
});
test('anexos não são incluídos em base64 na projeção geral', () => {
  const { state, user, run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId });
  run('cliente', 'upload', { ticketId, name: 'teste.pdf', type: 'application/pdf', data: 'c2VncmVkbw==', receipt: false });
  assert.ok(!JSON.stringify(projectState(state, user('cliente'))).includes('c2VncmVkbw=='));
});
test('retenção apaga mensagens e anexos exatamente após 30 dias', () => {
  const { state, run, create } = setup(); const ticketId = create(); run('bruno', 'accept', { ticketId }); run('cliente', 'message', { ticketId, text: 'Mensagem de teste.' });
  run('cliente', 'upload', { ticketId, name: 'teste.pdf', type: 'application/pdf', data: 'dGVzdGU=', receipt: false }); run('cliente', 'cancel', { ticketId });
  const before = new Date(Date.parse(NOW) + 30 * 86400000 - 1).toISOString();
  assert.equal(purgeExpired(state, before), false); assert.equal(state.tickets[0].threads[0].messages.length, 2);
  assert.equal(purgeExpired(state, new Date(Date.parse(NOW) + 30 * 86400000).toISOString()), true);
  assert.equal(state.tickets[0].threads[0].messages.length, 0); assert.equal(state.tickets[0].threads[0].files.length, 0);
});
test('alertas são enviados somente a profissionais compatíveis com vaga', () => {
  const { state, run, create } = setup(); const a = create(), b = create(); run('bruno', 'accept', { ticketId: a }); run('bruno', 'accept', { ticketId: b });
  state.notifications = []; const c = create();
  assert.ok(!state.notifications.some(n => n.userId === 'bruno'));
  assert.ok(state.notifications.some(n => n.userId === 'kleber' && n.ticketId === c));
  run('cliente', 'cancel', { ticketId: a }); assert.ok(state.notifications.some(n => n.userId === 'bruno' && n.title.includes('vaga')));
});
test('perfis suspensos não podem executar ações', () => {
  const { run, create } = setup(); const ticketId = create(); run('bruno', 'toggleProfessional', { id: 'kleber' });
  assert.throws(() => run('kleber', 'accept', { ticketId }), /conta ativa/);
});
