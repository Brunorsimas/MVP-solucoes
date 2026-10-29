export const SECTORS = {
  advocacia: { name: 'Advocacia', icon: 'scale', color: 'violet', description: 'Orientação para os seus próximos passos.', services: ['Advocacia geral', 'Direito criminal'] },
  engenharia: { name: 'Engenharia civil', icon: 'building', color: 'orange', description: 'Do primeiro projeto à próxima conquista.', services: ['Projeto civil', 'Vistoria e visita técnica', 'Reforma e acompanhamento'] },
  ti: { name: 'Tecnologia da informação', short: 'Tecnologia', icon: 'monitor', color: 'teal', description: 'Seu computador, seus dados e suas ideias.', services: ['Suporte técnico', 'Conserto de computador', 'Montagem de PC', 'Desenvolvimento de software', 'Engenharia de dados'] }
};
export const STATUS = { waiting: 'Aguardando especialista', conversation: 'Em conversa', proposal: 'Proposta enviada', contracted: 'Contratado', progress: 'Em atendimento', delivery: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado', released: 'Encaminhado a outro especialista' };
export const CLOSED = ['completed', 'cancelled', 'released'];
export const DEMO_USERS = [
  { id: 'cliente', username: 'user', name: 'user', role: 'client', initials: 'US' },
  { id: 'tayane', name: 'Tayane', role: 'professional', sector: 'advocacia', specialty: 'Direito criminal', services: ['Direito criminal'], initials: 'TA' },
  { id: 'miguel', name: 'Miguel', role: 'professional', sector: 'advocacia', specialty: 'Advogado geral', services: ['Advocacia geral'], initials: 'MI' },
  { id: 'feuzer', name: 'Feuzer', role: 'professional', sector: 'advocacia', specialty: 'Especialista em advocacia geral', services: ['Advocacia geral'], initials: 'FE' },
  { id: 'marcos', name: 'Marcos', role: 'professional', sector: 'engenharia', specialty: 'Engenheiro civil', services: SECTORS.engenharia.services, initials: 'MA' },
  { id: 'maria', name: 'Maria', role: 'professional', sector: 'engenharia', specialty: 'Engenheira civil', services: SECTORS.engenharia.services, initials: 'MR' },
  { id: 'bruno', name: 'Bruno', role: 'professional', admin: true, sector: 'ti', specialty: 'Hardware e suporte técnico', services: ['Suporte técnico', 'Conserto de computador', 'Montagem de PC'], initials: 'BR' },
  { id: 'stefanny', name: 'Stefanny', role: 'professional', sector: 'ti', specialty: 'Desenvolvimento de software', services: ['Desenvolvimento de software'], initials: 'ST' },
  { id: 'kleber', name: 'Kleber', role: 'professional', sector: 'ti', specialty: 'Engenharia de dados e suporte', services: ['Engenharia de dados', 'Suporte técnico'], initials: 'KL' }
].map(u => ({ ...u, username: u.username || u.id, email: `${u.username || u.id}@teste.com`, active: true, available: true, regions: ['PE', 'Belem'], modalities: u.sector === 'engenharia' ? ['Presencial'] : ['Remoto', 'Presencial'], bio: u.sector ? 'Perfil demonstrativo da equipe MVP Soluções. Especialidades e qualificações serão validadas antes da operação real.' : '' }));
export const DEMO_PASSWORD = '123';
// Administration belongs to the administrator alone. Every specialist serves
// tickets by default; what the administration manages is the sector each one
// answers for. `role` stays limited to client/professional so the matching,
// capacity and queue rules keep working untouched.
export const isAdmin = user => user?.admin === true;
// Sector lookup for values that come from a request: a key like `__proto__` or
// `constructor` would otherwise return an inherited object and pass as valid.
export const sectorOf = key => (typeof key === 'string' && Object.hasOwn(SECTORS, key) ? SECTORS[key] : undefined);
// Removed profiles are kept this long so the administration can still read the
// history. Nothing deletes them automatically: only an explicit admin action.
export const DELETED_RETENTION_DAYS = 360;
export function deletionCountdown(user, now = new Date().toISOString()) {
  if (!user?.deletedAt) return null;
  const elapsed = Math.floor((Date.parse(now) - Date.parse(user.deletedAt)) / 86400000);
  return Math.max(0, DELETED_RETENTION_DAYS - elapsed);
}
const legacyLegalProfiles = {
  tayane: { specialty: 'Advogado geral', service: 'Advocacia geral' },
  miguel: { specialty: 'Advogado criminal', service: 'Direito criminal' }
};
export function normalizeState(state) {
  state.version = 2;
  for (const key of ['users', 'tickets', 'notifications', 'support', 'audit', 'removed']) state[key] ||= [];
  state.createdAt ||= new Date().toISOString();
  for (const seed of DEMO_USERS) {
    const user = state.users.find(u => u.id === seed.id);
    // A profile removed by the administration is never re-seeded, and its
    // anonymised fields are never restored from the demonstration data.
    if (!user) { if (!state.removed?.includes(seed.id)) state.users.push(structuredClone(seed)); }
    else if (!user.deletedAt) {
      user.username = seed.username;
      const previous = legacyLegalProfiles[user.id];
      if (previous && user.specialty === previous.specialty && user.services?.length === 1 && user.services[0] === previous.service) {
        user.specialty = seed.specialty; user.services = [...seed.services];
      }
      if (!user.email || [`${seed.id}@example.test`, `${seed.username}@example.test`].includes(user.email.toLowerCase())) user.email = seed.email;
      if (user.id === 'cliente' && user.name === 'Ana Oliveira') { user.name = seed.name; user.initials = seed.initials; user.email = seed.email; }
    }
  }
  for (const ticket of state.tickets) {
    for (const thread of ticket.threads || []) {
      if (!thread.releaseReason) {
        const message = thread.messages?.find(m => m.system && m.text.startsWith('Solicitado novo encaminhamento: '));
        if (message) thread.releaseReason = message.text.slice('Solicitado novo encaminhamento: '.length);
      }
    }
    if (['completed', 'cancelled'].includes(ticket.status) && ticket.closedAt) finalizePending(ticket, ticket.closedAt);
  }
  return state;
}
export function demoUser(state, identifier) {
  const login = String(identifier || '').trim().toLocaleLowerCase('pt-BR');
  return state.users.find(user => DEMO_USERS.some(seed => seed.id === user.id) && !user.deletedAt && [user.username, user.email].some(value => value?.toLocaleLowerCase('pt-BR') === login));
}
export const uid = () => globalThis.crypto.randomUUID();
export function createState(now = new Date().toISOString()) {
  return normalizeState({ version: 2, users: structuredClone(DEMO_USERS), tickets: [], notifications: [], support: [], audit: [], removed: [], createdAt: now });
}
export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export function requireThat(condition, message, status = 400) { if (!condition) fail(message, status); }
export function text(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
export function priceInCents(value) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 1000000000 ? cents : null;
}
export const proposalAuthor = proposal => proposal.authorId || proposal.professionalId;
export function proposalExpiresAt(proposal) {
  if (proposal.expiresAt) return proposal.expiresAt;
  const days = /^(\d{1,3})(?:\s*dias?)?$/.exec(String(proposal.validity || '').trim())?.[1];
  const at = Date.parse(proposal.at);
  return days && Number(days) >= 1 && Number(days) <= 365 && Number.isFinite(at) ? new Date(at + Number(days) * 86400000).toISOString() : null;
}
export function proposalExpired(proposal, now = new Date().toISOString()) {
  const expires = proposalExpiresAt(proposal);
  return !expires || !Number.isFinite(Date.parse(expires)) || Date.parse(now) >= Date.parse(expires);
}
export function currentProposal(ticket) { return (ticket.proposals || []).find(p => p.status === 'accepted' && p.threadId === ticket.threads.at(-1)?.id); }
export function receiptConfirmed(file, proposal) {
  return !!(proposal && file.receipt && file.confirmedAt && file.confirmedProposalId === proposal.id && file.confirmedAmount === proposal.amount);
}
function cancelAppointments(ticket, now) {
  for (const a of ticket.appointments) if (['pending', 'confirmed'].includes(a.status)) { a.status = 'cancelled'; a.cancelledAt = now; }
}
function finalizePending(ticket, now) {
  for (const p of ticket.proposals || []) if (p.status === 'pending') { p.status = 'cancelled'; p.cancelledAt = now; }
  for (const a of ticket.appointments || []) if (['pending', 'confirmed'].includes(a.status)) {
    a.status = ticket.status === 'completed' && a.status === 'confirmed' && Date.parse(a.date) <= Date.parse(now) ? 'closed' : 'cancelled';
    a.closedAt = now;
    if (a.status === 'cancelled') a.cancelledAt = now;
    a.closeReason = 'Atendimento encerrado.';
  }
  for (const th of ticket.threads || []) th.closedAt ||= now;
}
export function validateProposalInput(payload) {
  const amount = priceInCents(payload.amount);
  requireThat(amount !== null, 'Informe um valor positivo com até duas casas decimais. O preço é combinado entre cliente e especialista.');
  const validityDays = Number(payload.validityDays ?? /^(\d{1,3})(?:\s*dias?)?$/.exec(text(payload.validity || '7 dias'))?.[1]);
  requireThat(Number.isInteger(validityDays) && validityDays >= 1 && validityDays <= 365, 'A validade deve ser de 1 a 365 dias.');
  const source = payload.source || 'form';
  requireThat(['form', 'document'].includes(source), 'Escolha formulário ou documento para a proposta.');
  requireThat(!(payload.fileId && payload.attachment), 'Envie um único documento para a proposta.');
  if (source === 'document') requireThat(payload.fileId || payload.attachment, 'Anexe o documento da proposta.');
  if (source === 'form') requireThat(text(payload.scope).length >= 10 && text(payload.deadline).length >= 2 && text(payload.terms).length >= 3, 'Preencha escopo, prazo e condições de pagamento.');
  return { amount, validityDays, source };
}
export function validateAttachment(payload, verifyContent = true) {
  requireThat(['application/pdf', 'image/png', 'image/jpeg'].includes(payload.type), 'Envie PDF, PNG ou JPG.');
  requireThat(typeof payload.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(payload.data) && payload.data.length > 0 && payload.data.length <= 2800000, 'Arquivo inválido ou maior que 2 MB.');
  let bytes; try { bytes = atob(payload.data); } catch { fail('Arquivo inválido.'); }
  requireThat(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024, 'Arquivo maior que 2 MB ou vazio.');
  if (verifyContent) requireThat((payload.type === 'application/pdf' && bytes.startsWith('%PDF-')) || (payload.type === 'image/png' && bytes.slice(0, 8) === '\x89PNG\r\n\x1a\n') || (payload.type === 'image/jpeg' && bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(2) === 255), 'O conteúdo do arquivo não corresponde ao formato informado.');
}
function prepareFile(thread, user, payload, now, verifyContent = false) {
  validateAttachment(payload, verifyContent);
  requireThat(payload.receipt || thread.files.filter(f => !f.receipt).length < 15, 'Limite de 15 anexos comuns por conversa. Comprovantes têm espaço separado.');
  return { id: uid(), name: text(payload.name, 120).replace(/[\\/<>:"|?*\r\n]/g, '_'), type: payload.type, data: payload.data, receipt: !!payload.receipt, authorId: user.id, at: now };
}
function appendFile(thread, file, user, now) {
  thread.files.push(file);
  thread.messages.push({ id: uid(), authorId: user.id, text: file.receipt ? 'Comprovante anexado. Aguardando conferência do profissional.' : 'Arquivo compartilhado.', fileId: file.id, at: now });
}
function canPreview(user, ticket) {
  return ticket.status === 'waiting' && compatible(user, ticket) && ticket.excludedProfessionalId !== user.id && !ticket.threads.some(th => th.professionalId === user.id);
}
function releaseNote(thread) { return thread?.releaseReason ? { reason: thread.releaseReason, at: thread.closedAt } : null; }
function closeTicket(state, ticket, now, reason) {
  ticket.status = 'cancelled'; ticket.closedAt = now; ticket.updatedAt = now; ticket.closeReason = reason;
  finalizePending(ticket, now);
  notify(state, ticket.clientId, 'Atendimento encerrado', reason, ticket.id, now);
  if (ticket.professionalId) { notify(state, ticket.professionalId, 'Atendimento encerrado', reason, ticket.id, now); notifyVacancy(state, ticket.professionalId, now); }
}
export function activeCount(state, userId) { return state.tickets.filter(t => t.professionalId === userId && !CLOSED.includes(t.status)).length; }
export const contactEmail = user => user.contactEmail ?? (user.email?.endsWith('@example.test') ? '' : user.email || '');
export function initialsOf(name) {
  const names = text(name).split(/\s+/).filter(Boolean);
  return (names.length > 1 ? names[0][0] + names.at(-1)[0] : (names[0] || '').slice(0, 2)).toLocaleUpperCase('pt-BR');
}
export function profileCompletion(user) {
  const fields = [
    ['Nome', text(user.name).length >= 2],
    ['E-mail para contato', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail(user))],
    ['Telefone com DDD', /^[+\d()\s-]+$/.test(user.phone || '') && /^\d{8,15}$/.test(String(user.phone || '').replace(/\D/g, ''))],
    ['Estado', ['PE', 'PA'].includes(user.region)],
    ['Cidade', text(user.city).length >= 2]
  ];
  if (user.role === 'professional') fields.push(['Apresentação', text(user.bio).length >= 20]);
  const missing = fields.filter(([, filled]) => !filled).map(([label]) => label);
  return { total: fields.length, filled: fields.length - missing.length, complete: missing.length === 0, missing };
}
export function professionalCapacity(user) { return user.role === 'professional' && profileCompletion(user).complete ? 3 : 2; }
export function compatible(user, ticket) { return user.active && user.available && user.role === 'professional' && user.sector === ticket.sector && user.services.includes(ticket.service) && user.regions.includes(ticket.region) && (!ticket.modality || ticket.modality === 'A combinar' || user.modalities.includes(ticket.modality)); }
export function businessOpen(date = new Date(), simulatedHour = null) {
  const hour = simulatedHour === null ? Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Recife' }).format(date)) : Number(simulatedHour);
  return hour >= 8 && hour < 19;
}
function notify(state, userId, title, body, ticketId, now) {
  state.notifications.unshift({ id: uid(), userId, title, body, ticketId, read: false, at: now, delivery: 'simulated' });
  state.notifications = state.notifications.slice(0, 1000);
}
export function notifyEligible(state, ticket, now) {
  for (const user of state.users.filter(u => canPreview(u, ticket) && u.id !== ticket.clientId && activeCount(state, u.id) < professionalCapacity(u))) notify(state, user.id, 'Novo chamado disponível', `${SECTORS[ticket.sector].name} · ${ticket.service}`, ticket.id, now);
}
function notifyVacancy(state, userId, now) {
  const user = state.users.find(u => u.id === userId);
  if (!user || activeCount(state, userId) >= professionalCapacity(user)) return;
  const ticket = state.tickets.find(t => t.clientId !== userId && canPreview(user, t));
  if (ticket) notify(state, userId, 'Você tem uma vaga disponível', 'Há solicitações compatíveis aguardando na fila.', ticket.id, now);
}
export function purgeExpired(state, now = new Date().toISOString()) {
  let changed = false;
  for (const ticket of state.tickets) {
    for (const thread of ticket.threads) {
      if (thread.closedAt && Date.parse(now) >= Date.parse(thread.closedAt) + 30 * 86400000 && !thread.purgedAt) {
        thread.messages = []; thread.files = []; thread.purgedAt = now; changed = true;
      }
    }
  }
  return changed;
}
function publicUser(user, state) {
  const { id, name, role, sector, specialty, services, initials, available, active, regions, modalities, bio } = user;
  return { id, name, role, sector, specialty, services, initials, available, active, regions, modalities, bio, activeCount: activeCount(state, id), capacity: role === 'professional' ? professionalCapacity(user) : undefined };
}
export function projectState(state, user, options = {}) {
  normalizeState(state);
  return {
    user: user ? { ...publicUser(user, state), username: user.username, email: user.email, phone: user.phone || '', contactEmail: contactEmail(user), city: user.city || '', region: user.region || '', admin: !!user.admin, mustChangePassword: !!user.mustChangePassword, profileCompletion: profileCompletion(user) } : null,
    professionals: state.users.filter(u => u.role === 'professional' && !u.deletedAt).map(u => publicUser(u, state)),
    tickets: user ? state.tickets.filter(t => t.clientId === user.id || t.professionalId === user.id || t.threads.some(th => th.professionalId === user.id) || canPreview(user, t)).map(t => {
      const client = t.clientId === user.id, assigned = t.professionalId === user.id;
      const allowedThreads = t.threads.filter(th => t.clientId === user.id || th.professionalId === user.id);
      const base = Object.fromEntries(['id', 'code', 'sector', 'service', 'region', 'city', 'modality', 'title', 'description', 'details', 'createdAt'].map(k => [k, t[k]]));
      if (!client && !assigned && !allowedThreads.length) return { ...base, status: 'waiting', professionalId: null, startedAt: null, closedAt: null, updatedAt: t.updatedAt, threads: [], releaseNote: releaseNote(t.threads.at(-1)) };
      const last = allowedThreads.at(-1);
      const result = { ...base, proposals: t.proposals.filter(p => allowedThreads.some(th => th.id === p.threadId)), appointments: t.appointments.filter(a => allowedThreads.some(th => th.id === a.threadId)), threads: allowedThreads.map(th => ({ ...th, files: th.files.map(({ data, ...file }) => file) })) };
      if (client || assigned) {
        Object.assign(result, { clientId: t.clientId, status: t.status, professionalId: t.professionalId, startedAt: t.startedAt, closedAt: t.closedAt, updatedAt: t.updatedAt, closeReason: t.closeReason, review: t.review, releaseNote: client ? releaseNote(t.threads.filter(th => th.releaseReason).at(-1)) : last?.receivedReleaseNote || releaseNote(t.threads[t.threads.indexOf(last) - 1]) });
      } else {
        Object.assign(result, { status: 'released', professionalId: user.id, startedAt: last.createdAt, updatedAt: last.closedAt, closedAt: last.closedAt, closeReason: last.releaseReason, releaseNote: last.receivedReleaseNote || null });
      }
      return result;
    }) : [],
    notifications: user ? state.notifications.filter(n => n.userId === user.id) : [],
    support: user ? state.support.filter(s => s.userId === user.id || isAdmin(user)).map(s => ({ ...s })) : [],
    admin: isAdmin(user) ? {
      tickets: state.tickets.map(t => ({ id: t.id, code: t.code, sector: t.sector, service: t.service, status: t.status, professionalId: t.professionalId, createdAt: t.createdAt, closedAt: t.closedAt, updatedAt: t.updatedAt })),
      audit: state.audit.slice(-100).reverse(),
      // Clients and specialists are listed apart: a client profile never gains
      // the sector and queue controls that only make sense for a specialist.
      users: state.users.map(u => ({
        id: u.id, name: u.name, role: u.role, active: u.active, admin: !!u.admin, initials: u.initials,
        login: u.username || u.email || '', sector: u.sector || null, services: [...(u.services || [])],
        activeCount: activeCount(state, u.id), capacity: u.role === 'professional' ? professionalCapacity(u) : undefined,
        deletedAt: u.deletedAt || null, retentionDays: deletionCountdown(u, options.now)
      }))
    } : null
  };
}
export function act(state, user, action, payload = {}, options = {}) {
  normalizeState(state);
  requireThat(user?.active, 'Entre em uma conta ativa para continuar.', 401);
  requireThat(!user.mustChangePassword, 'Defina uma nova senha na sua conta antes de continuar.', 403);
  const now = options.now || new Date().toISOString();
  let result = {};
  const record = (name, ticketId = null) => { state.audit.push({ id: uid(), actor: user.id, action: name, ticketId, at: now }); };
  if (action === 'createTicket') {
    requireThat(businessOpen(new Date(now), options.hour ?? null), 'Novos chamados podem ser abertos das 8h às 19h, horário de Brasília. Salve seu rascunho.');
    const sector = sectorOf(payload.sector);
    requireThat(sector && sector.services.includes(payload.service), 'Selecione um setor e um serviço válidos.');
    requireThat(['PE', 'Belem'].includes(payload.region), 'Atendemos Pernambuco e Belém–PA.');
    requireThat(text(payload.title).length >= 5 && text(payload.description).length >= 20, 'Informe um título e descreva sua necessidade em pelo menos 20 caracteres.');
    requireThat(payload.agreed === true, 'Confirme que leu as condições da solicitação.');
    const ticket = { id: uid(), code: `MVP-${String(state.tickets.length + 1).padStart(4, '0')}`, clientId: user.id, sector: payload.sector, service: payload.service, region: payload.region, city: payload.region === 'Belem' ? 'Belém' : text(payload.city, 80), modality: 'A combinar', title: text(payload.title, 100), description: text(payload.description), details: text(payload.details, 1000), status: 'waiting', professionalId: null, startedAt: null, createdAt: now, updatedAt: now, closedAt: null, threads: [], proposals: [], appointments: [], review: null };
    requireThat(ticket.city.length >= 2, 'Informe a cidade de atendimento.');
    requireThat(state.tickets.filter(t => t.clientId === user.id && !CLOSED.includes(t.status)).length < 10, 'Você já possui dez solicitações abertas. Conclua ou cancele uma antes de continuar.');
    state.tickets.unshift(ticket); notifyEligible(state, ticket, now); record(action, ticket.id); return { ticketId: ticket.id };
  }
  if (action === 'readNotifications') { state.notifications.filter(n => n.userId === user.id).forEach(n => n.read = true); return {}; }
  if (action === 'profile') {
    const previousCapacity = professionalCapacity(user);
    const profile = { name: text(payload.name ?? user.name, 70) };
    requireThat(profile.name.length >= 2, 'Informe seu nome com pelo menos dois caracteres.');
    for (const key of ['phone', 'contactEmail', 'city', 'region']) if (Object.hasOwn(payload, key)) profile[key] = text(payload[key], key === 'contactEmail' ? 254 : key === 'city' ? 80 : 25);
    if (profile.phone) requireThat(/^[+\d()\s-]+$/.test(profile.phone) && profile.phone.replace(/\D/g, '').length >= 8 && profile.phone.replace(/\D/g, '').length <= 15, 'Informe um telefone válido com DDD, ou deixe em branco.');
    if (profile.contactEmail) requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.contactEmail), 'Informe um e-mail de contato válido, ou deixe em branco.');
    if (Object.hasOwn(profile, 'region')) requireThat(['', 'PE', 'PA'].includes(profile.region), 'Selecione Pernambuco ou Pará, ou deixe em branco.');
    profile.initials = initialsOf(profile.name);
    Object.assign(user, profile);
    if (user.role === 'professional') {
      if (Object.hasOwn(payload, 'available')) user.available = !!payload.available;
      if (Object.hasOwn(payload, 'bio')) user.bio = text(payload.bio, 800);
      if (professionalCapacity(user) > previousCapacity) {
        notify(state, user.id, 'Terceira vaga liberada', 'Seu perfil está completo. Você pode atender até três chamados simultâneos.', null, now);
        notifyVacancy(state, user.id, now);
      }
    }
    record(action); return {};
  }
  if (action === 'support') {
    requireThat(text(payload.message).length >= 10, 'Descreva sua solicitação em pelo menos 10 caracteres.');
    if (payload.ticketId) requireThat(state.tickets.some(t => t.id === payload.ticketId && (t.clientId === user.id || t.professionalId === user.id)), 'Atendimento não encontrado.', 404);
    state.support.unshift({ id: uid(), userId: user.id, ticketId: payload.ticketId || null, category: text(payload.category, 80), message: text(payload.message, 2000), status: 'open', createdAt: now });
    record(action, payload.ticketId); return {};
  }
  if (action === 'resolveSupport') {
    requireThat(isAdmin(user), 'Acesso restrito.', 403);
    const s = state.support.find(s => s.id === payload.id); requireThat(s, 'Solicitação não encontrada.', 404);
    requireThat(s.status === 'open', 'Este suporte já foi finalizado.', 409);
    const t = s.ticketId && state.tickets.find(t => t.id === s.ticketId);
    if (t && !CLOSED.includes(t.status)) {
      closeTicket(state, t, now, 'Chamado encerrado pela administração ao finalizar o suporte.');
      t.closedBySupportId = s.id;
    }
    s.status = 'resolved'; s.resolvedAt = now; s.resolvedBy = user.id;
    record(action, s.ticketId); return {};
  }
  if (action === 'toggleProfessional') {
    requireThat(isAdmin(user), 'Acesso restrito.', 403);
    // Suspension reaches every profile: a client account is disabled the same way.
    const target = state.users.find(u => u.id === payload.id && !u.deletedAt);
    requireThat(target && target.id !== user.id && !target.admin, 'Perfil inválido.');
    target.active = !target.active; record(action); return {};
  }
  if (action === 'createUser') {
    requireThat(isAdmin(user), 'Acesso restrito.', 403);
    const name = text(payload.name, 70), email = text(payload.email, 254).toLocaleLowerCase('pt-BR');
    const role = payload.role === 'professional' ? 'professional' : 'client';
    requireThat(name.length >= 2, 'Informe o nome com pelo menos dois caracteres.');
    requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Informe um e-mail válido.');
    requireThat(!state.users.some(u => u.email?.toLocaleLowerCase('pt-BR') === email), 'Já existe uma conta com este e-mail.', 409);
    const profile = { id: uid(), name, email, username: email, role, initials: initialsOf(name), active: true, available: true, createdAt: now, createdBy: user.id, mustChangePassword: true };
    if (role === 'professional') {
      const sector = sectorOf(payload.sector);
      requireThat(sector, 'Selecione um setor válido para o especialista.');
      const services = [].concat(payload.services || []).filter(s => sector.services.includes(s));
      requireThat(services.length, 'Selecione ao menos um serviço do setor.');
      Object.assign(profile, { sector: payload.sector, specialty: text(payload.specialty, 80) || sector.name, services, regions: ['PE', 'Belem'], modalities: payload.sector === 'engenharia' ? ['Presencial'] : ['Remoto', 'Presencial'], bio: text(payload.bio, 800) });
    }
    state.users.push(profile);
    record(action); return { userId: profile.id, login: email };
  }
  if (action === 'setSector') {
    // Every specialist serves tickets; the administration only decides which
    // sector and services they answer for.
    requireThat(isAdmin(user), 'Acesso restrito.', 403);
    const target = state.users.find(u => u.id === payload.id && !u.deletedAt);
    requireThat(target, 'Perfil não encontrado.', 404);
    requireThat(target.role === 'professional', 'Apenas especialistas atendem chamados por setor.');
    const sector = sectorOf(payload.sector);
    requireThat(sector, 'Selecione um setor válido para o especialista.');
    const services = [...new Set([].concat(payload.services || []).filter(s => sector.services.includes(s)))];
    requireThat(services.length, 'Selecione ao menos um serviço do setor.');
    Object.assign(target, { sector: payload.sector, services, specialty: target.sector === payload.sector ? target.specialty : sector.name, modalities: payload.sector === 'engenharia' ? ['Presencial'] : ['Remoto', 'Presencial'] });
    record(action); return { sector: target.sector, services: target.services };
  }
  if (action === 'deleteUser') {
    requireThat(isAdmin(user), 'Acesso restrito.', 403);
    const target = state.users.find(u => u.id === payload.id);
    requireThat(target, 'Perfil não encontrado.', 404);
    requireThat(target.id !== user.id, 'Você não pode excluir a própria conta.');
    requireThat(!target.admin, 'O administrador responsável não pode ser excluído.');
    requireThat(!target.deletedAt, 'Este perfil já foi excluído.', 409);
    requireThat(payload.confirm === target.name, 'Digite o nome exato do perfil para confirmar a exclusão.');
    // Anonymise instead of dropping the row: tickets, messages and proposals
    // reference this id and the other party must keep reading its own history.
    for (const ticket of state.tickets) {
      if (ticket.professionalId === target.id && !CLOSED.includes(ticket.status)) closeTicket(state, ticket, now, 'Atendimento encerrado: o especialista foi removido pela administração.');
      else if (ticket.clientId === target.id && !CLOSED.includes(ticket.status)) closeTicket(state, ticket, now, 'Atendimento encerrado: a conta do cliente foi removida pela administração.');
    }
    state.notifications = state.notifications.filter(n => n.userId !== target.id);
    Object.assign(target, { deletedAt: now, deletedBy: user.id, active: false, available: false, previousName: target.name, name: 'Usuário removido', initials: '--', phone: '', contactEmail: '', city: '', region: '', bio: '' });
    delete target.username; delete target.email;
    if (!state.removed.includes(target.id)) state.removed.push(target.id);
    record(action); return {};
  }
  const ticket = state.tickets.find(t => t.id === payload.ticketId);
  requireThat(ticket, 'Chamado não encontrado.', 404);
  const client = ticket.clientId === user.id;
  const pro = ticket.professionalId === user.id;
  const thread = ticket.threads.at(-1);
  const open = !CLOSED.includes(ticket.status);
  if (action === 'accept') {
    requireThat(ticket.status === 'waiting' && !ticket.professionalId, 'Este chamado já foi assumido.', 409);
    requireThat(!client && canPreview(user, ticket), 'Este chamado não é compatível com seu perfil.', 403);
    requireThat(activeCount(state, user.id) < professionalCapacity(user), `Seu limite atual é de ${professionalCapacity(user)} chamados simultâneos.`, 409);
    const receivedReleaseNote = releaseNote(ticket.threads.at(-1));
    ticket.professionalId = user.id; ticket.startedAt = now; ticket.status = 'conversation'; ticket.threads.push({ id: uid(), professionalId: user.id, createdAt: now, closedAt: null, messages: [], files: [], receivedReleaseNote });
    notify(state, ticket.clientId, 'Seu chamado foi aceito', `${user.name} está disponível para conversar.`, ticket.id, now);
  } else {
    requireThat(client || pro, 'Você não participa deste atendimento.', 403);
    if (action === 'cancel') {
      requireThat(client && ['waiting', 'conversation', 'proposal'].includes(ticket.status), 'Após aprovar a contratação, solicite o encerramento pelo suporte.');
      closeTicket(state, ticket, now, 'Solicitação cancelada pelo cliente antes da contratação.');
    } else if (action === 'release') {
      requireThat(['conversation', 'proposal'].includes(ticket.status), 'Após a contratação, solicite suporte para tratar a transferência.');
      requireThat(text(payload.reason).length >= 5, 'Informe o motivo do novo encaminhamento.');
      const previous = ticket.professionalId;
      thread.releaseReason = text(payload.reason, 500);
      thread.messages.push({ id: uid(), authorId: user.id, text: `Solicitado novo encaminhamento: ${text(payload.reason, 500)}`, at: now, system: true }); thread.closedAt = now;
      ticket.proposals.filter(p => p.status === 'pending').forEach(p => p.status = 'superseded');
      cancelAppointments(ticket, now);
      ticket.excludedProfessionalId = previous; ticket.professionalId = null; ticket.startedAt = null; ticket.status = 'waiting';
      notifyEligible(state, ticket, now); notify(state, ticket.clientId, 'Novo encaminhamento', 'O chamado voltou à fila de especialistas.', ticket.id, now); notifyVacancy(state, previous, now);
    } else if (action === 'message' || action === 'upload') {
      requireThat(open && thread && !thread.closedAt, 'Esta conversa está encerrada.');
      if (action === 'message') {
        requireThat(text(payload.text).length > 0, 'Escreva uma mensagem.');
        thread.messages.push({ id: uid(), authorId: user.id, text: text(payload.text), at: now });
      } else {
        requireThat(!payload.receipt || (client && ticket.proposals.some(p => p.status === 'accepted' && p.threadId === thread.id)), 'Comprovantes exigem uma proposta aprovada.');
        const file = prepareFile(thread, user, payload, now);
        appendFile(thread, file, user, now);
        result.fileId = file.id;
      }
      if (pro && !ticket.startedAt) ticket.startedAt = now;
      notify(state, client ? ticket.professionalId : ticket.clientId, 'Nova mensagem', `Você recebeu uma mensagem em ${ticket.code}.`, ticket.id, now);
    } else if (action === 'proposal') {
      requireThat(thread && !thread.closedAt && ['conversation', 'proposal', 'contracted', 'progress'].includes(ticket.status), 'Não é possível enviar proposta neste momento.');
      const { amount, validityDays, source } = validateProposalInput(payload);
      const file = payload.attachment ? prepareFile(thread, user, { ...payload.attachment, receipt: false }, now, true) : payload.fileId ? thread.files.find(f => f.id === payload.fileId && f.authorId === user.id && !f.receipt) : null;
      requireThat(!payload.fileId || file, 'Anexe um documento seu nesta conversa para enviar a proposta.', 403);
      requireThat(source !== 'document' || file, 'Anexe o documento da proposta.');
      if (payload.attachment) appendFile(thread, file, user, now);
      ticket.proposals.filter(p => p.status === 'pending').forEach(p => p.status = 'superseded');
      const documentTerms = file ? `Conforme documento: ${file.name}` : '';
      const proposal = { id: uid(), threadId: thread.id, version: ticket.proposals.length + 1, professionalId: ticket.professionalId, authorId: user.id, source, fileId: file?.id || null, fileName: file?.name || null, amount, scope: source === 'document' ? documentTerms : text(payload.scope, 2000), exclusions: source === 'document' ? '' : text(payload.exclusions, 1000), deadline: source === 'document' ? documentTerms : text(payload.deadline, 200), terms: source === 'document' ? documentTerms : text(payload.terms, 1000), validity: `${validityDays} dias`, validityDays, expiresAt: new Date(Date.parse(now) + validityDays * 86400000).toISOString(), status: 'pending', at: now };
      ticket.proposals.push(proposal);
      thread.messages.push({ id: uid(), authorId: user.id, text: `Proposta versão ${proposal.version} enviada por ${user.name}: R$ ${(amount / 100).toFixed(2).replace('.', ',')}. Aguarda aprovação da outra parte.`, at: now, system: true });
      if (!ticket.proposals.some(p => p.status === 'accepted')) ticket.status = 'proposal';
      if (!ticket.startedAt) ticket.startedAt = now;
      notify(state, client ? ticket.professionalId : ticket.clientId, 'Uma proposta chegou', 'Confira o valor e as condições antes de aprovar ou enviar uma contraproposta.', ticket.id, now);
    } else if (action === 'proposalDecision') {
      requireThat(open, 'Este atendimento está encerrado.');
      const proposal = ticket.proposals.find(p => p.id === payload.proposalId && p.status === 'pending' && p.threadId === thread.id);
      requireThat(proposal, 'Proposta não está mais disponível.', 409);
      requireThat(proposalAuthor(proposal) !== user.id, 'Somente a outra parte pode aprovar ou recusar esta proposta.', 403);
      requireThat(['accepted', 'declined'].includes(payload.decision), 'Decisão inválida.');
      if (payload.decision === 'accepted') {
        requireThat(!proposalExpired(proposal, now), 'Esta proposta venceu. Solicite uma nova proposta atualizada.', 409);
        requireThat(Number.isSafeInteger(proposal.amount) && proposal.amount > 0, 'Solicite uma proposta com valor monetário válido.', 409);
      }
      proposal.status = payload.decision; proposal.decidedAt = now; proposal.decidedBy = user.id;
      if (proposal.status === 'accepted') { ticket.proposals.filter(p => p.id !== proposal.id && p.status === 'accepted').forEach(p => p.status = 'replaced'); ticket.status = 'contracted'; }
      else if (ticket.status === 'proposal') ticket.status = 'conversation';
      notify(state, proposalAuthor(proposal), proposal.status === 'accepted' ? 'Proposta aprovada' : 'Proposta recusada', ticket.code, ticket.id, now);
    } else if (action === 'startService') {
      requireThat(pro && ticket.status === 'contracted', 'É necessária uma proposta aprovada.'); ticket.status = 'progress';
    } else if (action === 'deliver') {
      requireThat(pro && ticket.status === 'progress', 'Inicie a execução antes de registrar a entrega.'); ticket.status = 'delivery'; notify(state, ticket.clientId, 'Serviço entregue', 'Revise a entrega e anexe seu comprovante, se ainda não o enviou.', ticket.id, now);
    } else if (action === 'confirmReceipt') {
      requireThat(pro && ['contracted', 'progress', 'delivery'].includes(ticket.status), 'A confirmação exige um serviço contratado.');
      const file = thread.files.find(f => f.id === payload.fileId && f.receipt); requireThat(file, 'Comprovante não encontrado.');
      const proposal = currentProposal(ticket);
      requireThat(proposal && payload.proposalId === proposal.id, 'A proposta mudou. Atualize a página e confira o pagamento do acordo atual.', 409);
      file.confirmations ||= [];
      file.confirmations.push({ at: now, by: user.id, proposalId: proposal.id, amount: proposal.amount });
      file.confirmedAt = now; file.confirmedBy = user.id; file.confirmedProposalId = proposal.id; file.confirmedAmount = proposal.amount;
    } else if (action === 'complete') {
      requireThat(pro && ticket.status === 'delivery', 'Registre a entrega antes de concluir.');
      requireThat(thread.files.some(f => receiptConfirmed(f, currentProposal(ticket))), 'Confira e confirme o recebimento do pagamento da proposta atual antes de concluir.');
      ticket.status = 'completed'; ticket.closedAt = now; thread.closedAt = now;
      finalizePending(ticket, now);
      notify(state, ticket.clientId, 'Atendimento concluído', 'Seu histórico estará disponível por 30 dias.', ticket.id, now); notifyVacancy(state, user.id, now);
    } else if (action === 'closeNoCharge') {
      requireThat(pro && ['conversation', 'proposal'].includes(ticket.status) && text(payload.reason).length >= 5, 'Informe um motivo. Serviços contratados exigem tratamento pelo suporte.');
      closeTicket(state, ticket, now, text(payload.reason, 300));
    } else if (action === 'appointment') {
      requireThat(pro && open && thread, 'Somente o especialista responsável pode registrar o agendamento.', 403);
      requireThat(Number.isFinite(Date.parse(payload.date)) && Date.parse(payload.date) > Date.parse(now), 'Escolha uma data futura.');
      requireThat(text(payload.location).length >= 3, 'Informe local ou orientação para a reunião.');
      if (payload.replacesId) {
        const original = ticket.appointments.find(a => a.id === payload.replacesId && a.threadId === thread.id);
        requireThat(original && ['pending', 'confirmed'].includes(original.status), 'O horário original não está mais disponível para reagendar.', 409);
        requireThat(!ticket.appointments.some(a => a.replacesId === original.id && a.status === 'pending'), 'Já existe um reagendamento aguardando resposta para este encontro.', 409);
      }
      ticket.appointments.push({ id: uid(), authorId: user.id, threadId: thread.id, date: new Date(payload.date).toISOString(), location: text(payload.location, 300), status: 'pending', at: now, replacesId: payload.replacesId || null });
      if (!ticket.startedAt) ticket.startedAt = now;
      notify(state, client ? ticket.professionalId : ticket.clientId, 'Novo horário proposto', ticket.code, ticket.id, now);
    } else if (action === 'appointmentDecision') {
      const appointment = ticket.appointments.find(a => a.id === payload.id && a.threadId === thread?.id);
      requireThat(open && appointment && appointment.authorId !== user.id && appointment.status === 'pending', 'Agendamento indisponível.');
      requireThat(['confirmed', 'declined'].includes(payload.decision), 'Decisão inválida.');
      if (payload.decision === 'confirmed' && appointment.replacesId) {
        const original = ticket.appointments.find(a => a.id === appointment.replacesId && a.threadId === thread.id);
        requireThat(original && ['pending', 'confirmed'].includes(original.status), 'O encontro original foi alterado. Solicite um novo agendamento.', 409);
        original.status = 'superseded'; original.supersededAt = now; original.supersededBy = appointment.id;
      }
      appointment.status = payload.decision; appointment.decidedAt = now; appointment.decidedBy = user.id;
      notify(state, ticket.professionalId, 'Agendamento atualizado', ticket.code, ticket.id, now);
    } else if (action === 'cancelAppointment') {
      const appointment = ticket.appointments.find(a => a.id === payload.id && a.threadId === thread?.id);
      requireThat(open && appointment && ['pending', 'confirmed'].includes(appointment.status), 'Agendamento indisponível.', 409);
      requireThat(text(payload.reason).length >= 5, 'Informe o motivo do cancelamento em pelo menos 5 caracteres.');
      for (const a of ticket.appointments.filter(a => a.id === appointment.id || (a.replacesId === appointment.id && a.status === 'pending'))) {
        a.status = 'cancelled'; a.cancelledAt = now; a.cancelledBy = user.id; a.cancelReason = text(payload.reason, 300);
      }
      thread.messages.push({ id: uid(), authorId: user.id, text: `Agendamento de ${appointment.date} cancelado: ${text(payload.reason, 300)}`, at: now, system: true });
      notify(state, client ? ticket.professionalId : ticket.clientId, 'Agendamento cancelado', ticket.code, ticket.id, now);
    } else if (action === 'review') {
      requireThat(client && ticket.status === 'completed' && ticket.professionalId && !ticket.review, 'A avaliação exige um atendimento concluído e só pode ser enviada uma vez.');
      requireThat(Number.isInteger(Number(payload.rating)) && Number(payload.rating) >= 1 && Number(payload.rating) <= 5, 'Escolha uma nota de 1 a 5.');
      ticket.review = { professionalId: ticket.professionalId, rating: Number(payload.rating), comment: text(payload.comment, 1000), at: now };
      notify(state, ticket.professionalId, 'Você recebeu uma avaliação', `O cliente avaliou o atendimento ${ticket.code}.`, ticket.id, now);
    } else fail('Ação desconhecida.', 404);
  }
  ticket.updatedAt = now; record(action, ticket.id); result.ticketId = ticket.id; return result;
}
