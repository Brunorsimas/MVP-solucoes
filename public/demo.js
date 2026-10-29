import { createState, normalizeState, demoUser, DEMO_PASSWORD, act, projectState, purgeExpired, businessOpen } from './domain.js';
const KEY = 'mvp-solucoes-static-v1';
const USER = 'mvp-solucoes-static-session-v2';
const read = () => { try { return normalizeState(JSON.parse(localStorage.getItem(KEY)) || createState()); } catch { return createState(); } };
const write = state => localStorage.setItem(KEY, JSON.stringify(state));
export function staticRequest(path, payload) {
  const state = read(); purgeExpired(state); const currentId = sessionStorage.getItem(USER); const user = state.users.find(u => u.id === currentId && u.active);
  if (path === '/state') { write(state); return { ...projectState(state, user, { now: new Date().toISOString() }), csrf: 'static', config: { mode: 'static-demo', simulatedHour: 10, open: businessOpen(new Date(), 10), serverTime: new Date().toISOString(), externalNotifications: false, retentionDays: 30 } }; }
  if (path === '/auth/login') {
    const target = demoUser(state, payload.login || payload.email);
    if (!target || payload.password !== DEMO_PASSWORD) throw new Error('Usuário ou senha inválidos.');
    if (!target.active) throw new Error('Usuário desativado, entre em contato como administrador do sistema.');
    write(state); sessionStorage.setItem(USER, target.id); return { csrf: 'static' };
  }
  if (path === '/auth/logout') { sessionStorage.removeItem(USER); return { ok: true }; }
  // This prototype has no password store: the shared test password lives in the code.
  if (path === '/auth/change-password') throw new Error('As contas desta demonstração usam a senha fixa de teste e não possuem senha própria.');
  if (path.startsWith('/auth/')) throw new Error('Use o login e a senha de teste. Cadastro de novas contas está disponível no servidor local.');
  // Without a password store the new profile could never sign in here.
  if (path === '/action' && payload.action === 'createUser') throw new Error('A criação de usuários exige o servidor. Esta demonstração não armazena senhas.');
  if (path === '/action') { const result = act(state, user, payload.action, payload.payload, { now: new Date().toISOString(), hour: 10 }); try { write(state); } catch { throw new Error('O armazenamento deste navegador está cheio. Remova dados de teste nas configurações do navegador.'); } return { ok: true, result }; }
  throw new Error('Operação indisponível.');
}
export function staticFile(id) {
  const state = read(); const currentId = sessionStorage.getItem(USER);
  for (const ticket of state.tickets) for (const thread of ticket.threads) if (ticket.clientId === currentId || thread.professionalId === currentId) { const file = thread.files.find(f => f.id === id); if (file) return file; }
  throw new Error('Arquivo não encontrado.');
}
