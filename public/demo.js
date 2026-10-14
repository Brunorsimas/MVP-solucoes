import { createState, act, projectState, purgeExpired, businessOpen } from './domain.js';
const KEY = 'mvp-solucoes-static-v1';
const USER = 'mvp-solucoes-static-session';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || createState(); } catch { return createState(); } };
const write = state => localStorage.setItem(KEY, JSON.stringify(state));
export function staticRequest(path, payload) {
  const state = read(); purgeExpired(state); const currentId = sessionStorage.getItem(USER); const user = state.users.find(u => u.id === currentId && u.active);
  if (path === '/state') { write(state); return { ...projectState(state, user), csrf: 'static', config: { mode: 'static-demo', simulatedHour: 10, open: businessOpen(new Date(), 10), serverTime: new Date().toISOString(), externalNotifications: false, retentionDays: 30 } }; }
  if (path === '/auth/demo') { if (!state.users.find(u => u.id === payload.id && u.active)) throw new Error('Perfil indisponível.'); sessionStorage.setItem(USER, payload.id); return { csrf: 'static' }; }
  if (path === '/auth/logout') { sessionStorage.removeItem(USER); return { ok: true }; }
  if (path.startsWith('/auth/')) throw new Error('Esta é uma demonstração estática. Use os perfis de teste ou execute o servidor local para cadastrar uma conta.');
  if (path === '/action') { const result = act(state, user, payload.action, payload.payload, { hour: 10 }); try { write(state); } catch { throw new Error('O armazenamento deste navegador está cheio. Remova dados de teste nas configurações do navegador.'); } return { ok: true, result }; }
  throw new Error('Operação indisponível.');
}
export function staticFile(id) {
  const state = read(); const currentId = sessionStorage.getItem(USER);
  for (const ticket of state.tickets) for (const thread of ticket.threads) if (ticket.clientId === currentId || thread.professionalId === currentId) { const file = thread.files.find(f => f.id === id); if (file) return file; }
  throw new Error('Arquivo não encontrado.');
}
