import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embeddedPostgres } from '../lib/embedded-postgres.mjs';
import { createPostgresStore } from '../lib/postgres-store.mjs';
import { createSharedHandler, passwordCredentials } from '../lib/shared-api.mjs';
import { createState, act, projectState, deletionCountdown, DELETED_RETENTION_DAYS, isAdmin } from '../public/domain.js';

const fixedTime = '2026-10-20T13:00:00.000Z';
function agent(handler, ip) {
  let cookie = '', csrf = '';
  return {
    async request(path, data, headers = {}) {
      const response = await handler(new Request('https://piloto.example.test/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie, 'X-CSRF-Token': csrf, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) }), { ip });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const body = await response.json(); if (body.csrf) csrf = body.csrf;
      return { response, body, status: response.status };
    },
    action(action, payload) { return this.request('/action', { action, payload }); }
  };
}

test('domínio: permissões nomeadas, criação, exclusão anonimizada e contagem de retenção', () => {
  const state = createState(fixedTime);
  const admin = state.users.find(u => u.id === 'bruno');
  const other = state.users.find(u => u.id === 'kleber');
  const client = state.users.find(u => u.id === 'cliente');

  // Administration belongs to the administrator alone; a specialist has none of it.
  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(other), false);
  for (const [name, payload] of [['createUser', { name: 'X', email: 'x@y.com' }], ['deleteUser', { id: client.id }], ['setSector', { id: other.id, sector: 'ti', services: ['Suporte técnico'] }], ['toggleProfessional', { id: client.id }], ['resolveSupport', { id: 'qualquer' }]]) {
    assert.throws(() => act(state, other, name, payload, { now: fixedTime }), /Acesso restrito/, name);
    assert.throws(() => act(state, client, name, payload, { now: fixedTime }), /Acesso restrito/, name);
  }

  // Every specialist already serves tickets: what is managed is the sector.
  assert.equal(other.sector, 'ti');
  assert.throws(() => act(state, admin, 'setSector', { id: other.id, sector: 'inexistente' }, { now: fixedTime }), /setor válido/);
  assert.throws(() => act(state, admin, 'setSector', { id: other.id, sector: 'advocacia', services: ['Suporte técnico'] }, { now: fixedTime }), /ao menos um serviço/);
  assert.throws(() => act(state, admin, 'setSector', { id: client.id, sector: 'ti', services: ['Suporte técnico'] }, { now: fixedTime }), /Apenas especialistas/);
  act(state, admin, 'setSector', { id: other.id, sector: 'advocacia', services: ['Advocacia geral', 'Direito criminal', 'Advocacia geral', 'inventado'] }, { now: fixedTime });
  assert.equal(other.sector, 'advocacia');
  assert.deepEqual(other.services, ['Advocacia geral', 'Direito criminal']);
  assert.deepEqual(other.modalities, ['Remoto', 'Presencial']);
  act(state, admin, 'setSector', { id: other.id, sector: 'engenharia', services: ['Projeto civil'] }, { now: fixedTime });
  assert.deepEqual(other.modalities, ['Presencial'], 'Engenharia é presencial');
  act(state, admin, 'setSector', { id: other.id, sector: 'ti', services: ['Suporte técnico'] }, { now: fixedTime });

  // The administrator is protected and nobody removes their own account.
  assert.throws(() => act(state, admin, 'deleteUser', { id: admin.id, confirm: admin.name }, { now: fixedTime }), /própria conta/);
  assert.throws(() => act(state, admin, 'toggleProfessional', { id: admin.id }, { now: fixedTime }), /Perfil inválido/);

  // Suspension reaches a client account too, not only specialists.
  act(state, admin, 'toggleProfessional', { id: client.id }, { now: fixedTime });
  assert.equal(client.active, false);
  act(state, admin, 'toggleProfessional', { id: client.id }, { now: fixedTime });
  assert.equal(client.active, true);

  // Creation validates the profile and requires a first-access password change.
  assert.throws(() => act(state, admin, 'createUser', { name: 'A', email: 'novo@teste.com' }, { now: fixedTime }), /dois caracteres/);
  assert.throws(() => act(state, admin, 'createUser', { name: 'Nova Pessoa', email: 'sem-arroba' }, { now: fixedTime }), /e-mail válido/);
  assert.throws(() => act(state, admin, 'createUser', { name: 'Nova Pessoa', email: 'novo@teste.com', role: 'professional' }, { now: fixedTime }), /setor válido/);
  const created = act(state, admin, 'createUser', { name: 'Nova Pessoa', email: 'Novo@Teste.com', role: 'professional', sector: 'ti', services: ['Suporte técnico', 'inexistente'] }, { now: fixedTime });
  const fresh = state.users.find(u => u.id === created.userId);
  assert.equal(created.login, 'novo@teste.com');
  assert.equal(fresh.mustChangePassword, true);
  assert.equal(fresh.sector, 'ti');
  assert.deepEqual(fresh.services, ['Suporte técnico']);
  assert.equal(fresh.initials, 'NP');
  assert.throws(() => act(state, admin, 'createUser', { name: 'Outra', email: 'novo@teste.com' }, { now: fixedTime }), /Já existe uma conta/);
  // A profile pending its first password change cannot act yet.
  assert.throws(() => act(state, fresh, 'readNotifications', {}, { now: fixedTime }), /nova senha/);

  // Deletion demands the exact name and anonymises instead of dropping history.
  const ticket = act(state, client, 'createTicket', { sector: 'ti', service: 'Suporte técnico', region: 'PE', city: 'Recife', title: 'Chamado de teste', description: 'Descrição fictícia com mais de vinte caracteres.', agreed: true }, { now: fixedTime, hour: 10 });
  assert.throws(() => act(state, admin, 'deleteUser', { id: client.id, confirm: 'nome errado' }, { now: fixedTime }), /nome exato/);
  act(state, admin, 'deleteUser', { id: client.id, confirm: client.name }, { now: fixedTime });
  assert.equal(client.name, 'Usuário removido');
  assert.equal(client.active, false);
  assert.equal(client.username, undefined);
  assert.equal(client.email, undefined);
  assert.equal(client.deletedAt, fixedTime);
  assert.ok(state.removed.includes('cliente'));
  // The ticket survives for the other party; only its status closes.
  assert.equal(state.tickets.find(t => t.id === ticket.ticketId).status, 'cancelled');
  assert.throws(() => act(state, admin, 'deleteUser', { id: client.id, confirm: 'Usuário removido' }, { now: fixedTime }), /já foi excluído/);

  // Nothing is ever deleted automatically: the countdown only reports the window.
  assert.equal(deletionCountdown(client, fixedTime), DELETED_RETENTION_DAYS);
  const after10 = new Date(Date.parse(fixedTime) + 10 * 86400000).toISOString();
  assert.equal(deletionCountdown(client, after10), DELETED_RETENTION_DAYS - 10);
  const afterEnd = new Date(Date.parse(fixedTime) + 400 * 86400000).toISOString();
  assert.equal(deletionCountdown(client, afterEnd), 0);
  assert.equal(deletionCountdown(admin, afterEnd), null);
  // Even past the window, the profile is still there until an admin acts.
  assert.ok(state.users.some(u => u.id === 'cliente'));

  // The deleted seed profile is never resurrected, with or without the row.
  assert.equal(projectState(state, admin, { now: fixedTime }).professionals.some(p => p.id === 'cliente'), false);
  state.users = state.users.filter(u => u.id !== 'cliente');
  projectState(state, admin, { now: fixedTime });
  assert.equal(state.users.some(u => u.id === 'cliente'), false);
});

test('API: troca de senha, login de conta criada e bloqueio de conta desativada', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mvp-admin-'));
  const db = await embeddedPostgres(directory);
  t.after(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  const store = createPostgresStore(db); await store.init();
  await store.provision('bruno', 'bruno@team.example.test', passwordCredentials('senha-bruno-individual'));
  await store.provision('kleber', 'kleber@team.example.test', passwordCredentials('senha-kleber-individual'));
  const handler = createSharedHandler({ store, now: () => fixedTime });
  const admin = agent(handler, 'admin'), pro = agent(handler, 'pro');
  await admin.request('/auth/login', { login: 'bruno', password: 'senha-bruno-individual' });
  assert.equal((await admin.request('/state')).body.user.admin, true);

  // Only the administration creates and removes profiles.
  assert.equal((await pro.request('/auth/login', { login: 'kleber', password: 'senha-kleber-individual' })).status, 200);
  const denied = await pro.action('createUser', { name: 'Intruso', email: 'intruso@teste.com', password: 'senha-do-intruso' });
  assert.equal(denied.status, 403);

  // Creating a user also creates its sign-in credentials.
  const created = await admin.action('createUser', { name: 'Ana Nova', email: 'ana.nova@teste.com', role: 'client', password: 'senha-inicial-ana' });
  assert.equal(created.status, 200);
  assert.equal((await store.accountById(created.body.result.userId)).login, 'ana.nova@teste.com');
  // A weak initial password creates nothing at all.
  const weak = await admin.action('createUser', { name: 'Fraca Senha', email: 'fraca@teste.com', role: 'client', password: 'curta' });
  assert.equal(weak.status, 400);
  assert.equal(await store.account('fraca@teste.com'), undefined);

  const ana = agent(handler, 'ana');
  assert.equal((await ana.request('/auth/login', { login: 'ana.nova@teste.com', password: 'senha-errada' })).status, 401);
  assert.equal((await ana.request('/auth/login', { login: 'ana.nova@teste.com', password: 'senha-inicial-ana' })).status, 200);
  assert.equal((await ana.request('/state')).body.user.mustChangePassword, true);
  // Pending the first change, the account cannot act.
  assert.equal((await ana.action('readNotifications', {})).status, 403);

  // Changing the password requires the current one and a matching confirmation.
  assert.equal((await ana.request('/auth/change-password', { currentPassword: 'errada', password: 'senha-propria-ana', confirmPassword: 'senha-propria-ana' })).status, 403);
  assert.equal((await ana.request('/auth/change-password', { currentPassword: 'senha-inicial-ana', password: 'senha-propria-ana', confirmPassword: 'outra-coisa-aqui' })).status, 400);
  assert.equal((await ana.request('/auth/change-password', { currentPassword: 'senha-inicial-ana', password: 'senha-inicial-ana', confirmPassword: 'senha-inicial-ana' })).status, 400);
  assert.equal((await ana.request('/auth/change-password', { currentPassword: 'senha-inicial-ana', password: 'curta', confirmPassword: 'curta' })).status, 400);
  assert.equal((await ana.request('/auth/change-password', { currentPassword: 'senha-inicial-ana', password: 'senha-propria-ana', confirmPassword: 'senha-propria-ana' })).status, 200);
  assert.equal((await ana.request('/state')).body.user.mustChangePassword, false);
  assert.equal((await ana.action('readNotifications', {})).status, 200);

  // The old password stops working and the session that changed it survives.
  const stale = agent(handler, 'stale');
  assert.equal((await stale.request('/auth/login', { login: 'ana.nova@teste.com', password: 'senha-inicial-ana' })).status, 401);
  assert.equal((await stale.request('/auth/login', { login: 'ana.nova@teste.com', password: 'senha-propria-ana' })).status, 200);

  // Other sessions of the same account are revoked by the change.
  assert.equal((await stale.request('/auth/change-password', { currentPassword: 'senha-propria-ana', password: 'terceira-senha-ana', confirmPassword: 'terceira-senha-ana' })).status, 200);
  assert.equal((await ana.request('/state')).body.user, null);

  // A suspended account is told to contact the administration.
  const suspended = await admin.action('toggleProfessional', { id: 'kleber' });
  assert.equal(suspended.status, 200);
  const blocked = await agent(handler, 'blocked').request('/auth/login', { login: 'kleber', password: 'senha-kleber-individual' });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /Usuário desativado, entre em contato como administrador do sistema/);
  // The suspension also ends the sessions that were already open.
  assert.equal((await pro.request('/state')).body.user, null);

  // Deleting a profile removes its credentials but keeps the retention notice.
  const target = (await admin.request('/state')).body.admin.users.find(u => u.id === created.body.result.userId);
  assert.equal((await admin.action('deleteUser', { id: target.id, confirm: 'nome errado' })).status, 400);
  assert.equal((await admin.action('deleteUser', { id: target.id, confirm: target.name })).status, 200);
  assert.equal(await store.accountById(target.id), undefined);
  assert.equal((await stale.request('/state')).body.user, null);
  const removedView = (await admin.request('/state')).body.admin.users.find(u => u.id === target.id);
  assert.equal(removedView.name, 'Usuário removido');
  assert.equal(removedView.retentionDays, DELETED_RETENTION_DAYS);
  assert.equal((await agent(handler, 'gone').request('/auth/login', { login: 'ana.nova@teste.com', password: 'terceira-senha-ana' })).status, 401);
});
