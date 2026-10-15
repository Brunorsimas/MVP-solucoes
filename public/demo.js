import { createState, normalizeState, demoUser, DEMO_PASSWORD, act, projectState, purgeExpired, businessOpen } from './domain.js';
const KEY = 'mvp-solucoes-static-v1';
const USER = 'mvp-solucoes-static-session-v2';
const read = () => { try { return normalizeState(JSON.parse(localStorage.getItem(KEY)) || createState()); } catch { return createState(); } };
const write = state => localStorage.setItem(KEY, JSON.stringify(state));
export function staticRequest(path, payload) {
  const state = read(); purgeExpired(state); const currentId = sessionStorage.getItem(USER); const user = state.users.find(u => u.id === currentId && u.active);
  if (path === '/state') { write(state); return { ...projectState(state, user), csrf: 'static', config: { mode: 'static-demo', simulatedHour: 10, open: businessOpen(new Date(), 10), serverTime: new Date().toISOString(), externalNotifications: false, retentionDays: 30 } }; }
  if (path === '/auth/login') {
    const target = demoUser(state, payload.login || payload.email);
    if (!target?.active || payload.password !== DEMO_PASSWORD) throw new Error('Usuário ou senha inválidos.');
    write(state); sessionStorage.setItem(USER, target.id); return { csrf: 'static' };
  }
  if (path === '/auth/logout') { sessionStorage.removeItem(USER); return { ok: true }; }
  if (path.startsWith('/auth/')) throw new Error('Use o login e a senha de teste. Cadastro de novas contas está disponível no servidor local.');
  if (path === '/action') { const result = act(state, user, payload.action, payload.payload, { hour: 10 }); try { write(state); } catch { throw new Error('O armazenamento deste navegador está cheio. Remova dados de teste nas configurações do navegador.'); } return { ok: true, result }; }
  throw new Error('Operação indisponível.');
}
export function staticFile(id) {
  const state = read(); const currentId = sessionStorage.getItem(USER);
  for (const ticket of state.tickets) for (const thread of ticket.threads) if (ticket.clientId === currentId || thread.professionalId === currentId) { const file = thread.files.find(f => f.id === id); if (file) return file; }
  throw new Error('Arquivo não encontrado.');
}
