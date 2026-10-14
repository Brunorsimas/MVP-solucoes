export const SECTORS = {
  advocacia: { name: 'Advocacia', icon: 'scale', color: 'violet', description: 'Orientação para os seus próximos passos.', services: ['Advocacia geral', 'Direito criminal'] },
  engenharia: { name: 'Engenharia civil', icon: 'building', color: 'orange', description: 'Do primeiro projeto à próxima conquista.', services: ['Projeto civil', 'Vistoria e visita técnica', 'Reforma e acompanhamento'] },
  ti: { name: 'Tecnologia da informação', short: 'Tecnologia', icon: 'monitor', color: 'teal', description: 'Seu computador, seus dados e suas ideias.', services: ['Suporte técnico', 'Conserto de computador', 'Montagem de PC', 'Desenvolvimento de software', 'Engenharia de dados'] }
};
export const STATUS = { waiting: 'Aguardando especialista', conversation: 'Em conversa', proposal: 'Proposta enviada', contracted: 'Contratado', progress: 'Em atendimento', delivery: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado', released: 'Encaminhado a outro especialista' };
export const CLOSED = ['completed', 'cancelled'];
export const DEMO_USERS = [
  { id: 'cliente', name: 'Ana Oliveira', role: 'client', email: 'ana@example.test', initials: 'AO' },
  { id: 'tayane', name: 'Tayane', role: 'professional', sector: 'advocacia', specialty: 'Advocacia geral', services: ['Advocacia geral'], initials: 'TA' },
  { id: 'miguel', name: 'Miguel', role: 'professional', sector: 'advocacia', specialty: 'Direito criminal', services: ['Direito criminal'], initials: 'MI' },
  { id: 'feuzer', name: 'Feuzer', role: 'professional', sector: 'advocacia', specialty: 'Advocacia geral', services: ['Advocacia geral'], initials: 'FE' },
  { id: 'marcos', name: 'Marcos', role: 'professional', sector: 'engenharia', specialty: 'Engenheiro civil', services: SECTORS.engenharia.services, initials: 'MA' },
  { id: 'maria', name: 'Maria', role: 'professional', sector: 'engenharia', specialty: 'Engenheira civil', services: SECTORS.engenharia.services, initials: 'MR' },
  { id: 'bruno', name: 'Bruno', role: 'professional', admin: true, sector: 'ti', specialty: 'Hardware e suporte técnico', services: ['Suporte técnico', 'Conserto de computador', 'Montagem de PC'], initials: 'BR' },
  { id: 'stefanny', name: 'Stefanny', role: 'professional', sector: 'ti', specialty: 'Desenvolvimento de software', services: ['Desenvolvimento de software'], initials: 'ST' },
  { id: 'kleber', name: 'Kleber', role: 'professional', sector: 'ti', specialty: 'Engenharia de dados e suporte', services: ['Engenharia de dados', 'Suporte técnico'], initials: 'KL' }
].map(u => ({ ...u, email: u.email || `${u.id}@example.test`, active: true, available: true, regions: ['PE', 'Belem'], modalities: u.sector === 'engenharia' ? ['Presencial'] : ['Remoto', 'Presencial'], bio: u.sector ? 'Perfil demonstrativo da equipe MVP Soluções. Especialidades e qualificações serão validadas antes da operação real.' : '' }));
export const uid = () => globalThis.crypto.randomUUID();
export function createState(now = new Date().toISOString()) {
  return { version: 1, users: structuredClone(DEMO_USERS), tickets: [], notifications: [], support: [], audit: [], createdAt: now };
}
export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export function requireThat(condition, message, status = 400) { if (!condition) fail(message, status); }
export function text(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
export function activeCount(state, userId) { return state.tickets.filter(t => t.professionalId === userId && !CLOSED.includes(t.status)).length; }
export function compatible(user, ticket) { return user.active && user.available && user.role === 'professional' && user.sector === ticket.sector && user.services.includes(ticket.service) && user.regions.includes(ticket.region) && user.modalities.includes(ticket.modality); }
export function businessOpen(date = new Date(), simulatedHour = null) {
  const hour = simulatedHour === null ? Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Recife' }).format(date)) : Number(simulatedHour);
  return hour >= 8 && hour < 19;
}
function notify(state, userId, title, body, ticketId, now) {
  state.notifications.unshift({ id: uid(), userId, title, body, ticketId, read: false, at: now, delivery: 'simulated' });
  state.notifications = state.notifications.slice(0, 1000);
}
export function notifyEligible(state, ticket, now) {
  for (const user of state.users.filter(u => compatible(u, ticket) && u.id !== ticket.clientId && u.id !== ticket.excludedProfessionalId && activeCount(state, u.id) < 2)) notify(state, user.id, 'Novo chamado disponível', `${SECTORS[ticket.sector].name} · ${ticket.service}`, ticket.id, now);
}
function notifyVacancy(state, userId, now) {
  const user = state.users.find(u => u.id === userId);
  if (!user || activeCount(state, userId) >= 2) return;
  const ticket = state.tickets.find(t => t.status === 'waiting' && t.clientId !== userId && t.excludedProfessionalId !== userId && compatible(user, t));
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
  return { id, name, role, sector, specialty, services, initials, available, active, regions, modalities, bio, activeCount: activeCount(state, id) };
}
export function projectState(state, user) {
  return {
    user: user ? { ...publicUser(user, state), email: user.email, admin: !!user.admin } : null,
    professionals: state.users.filter(u => u.role === 'professional').map(u => publicUser(u, state)),
    tickets: user ? state.tickets.filter(t => t.clientId === user.id || t.professionalId === user.id || t.threads.some(th => th.professionalId === user.id) || (t.status === 'waiting' && compatible(user, t) && t.excludedProfessionalId !== user.id)).map(t => {
      const own = t.clientId === user.id || t.professionalId === user.id;
      const allowedThreads = t.threads.filter(th => t.clientId === user.id || th.professionalId === user.id);
      const result = { ...t, proposals: t.proposals.filter(p => allowedThreads.some(th => th.id === p.threadId)), appointments: t.appointments.filter(a => allowedThreads.some(th => th.id === a.threadId)), threads: allowedThreads.map(th => ({ ...th, files: th.files.map(({ data, ...file }) => file) })) };
      if (!own) { delete result.description; delete result.details; delete result.clientId; delete result.preferences; delete result.proposals; delete result.appointments; delete result.review; }
      return result;
    }) : [],
    notifications: user ? state.notifications.filter(n => n.userId === user.id) : [],
    support: user ? state.support.filter(s => s.userId === user.id || user.admin).map(s => ({ ...s })) : [],
    admin: user?.admin ? {
      tickets: state.tickets.map(t => ({ id: t.id, code: t.code, sector: t.sector, service: t.service, status: t.status, professionalId: t.professionalId, createdAt: t.createdAt, updatedAt: t.updatedAt })),
      audit: state.audit.slice(-100).reverse(), users: state.users.map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active }))
    } : null
  };
}
export function act(state, user, action, payload = {}, options = {}) {
  requireThat(user?.active, 'Entre em uma conta ativa para continuar.', 401);
  const now = options.now || new Date().toISOString();
  let result = {};
  const record = (name, ticketId = null) => { state.audit.push({ id: uid(), actor: user.id, action: name, ticketId, at: now }); };
  if (action === 'createTicket') {
    requireThat(businessOpen(new Date(now), options.hour ?? null), 'Novos chamados podem ser abertos das 8h às 19h, horário de Brasília. Salve seu rascunho.');
    const sector = SECTORS[payload.sector];
    requireThat(sector && sector.services.includes(payload.service), 'Selecione um setor e um serviço válidos.');
    requireThat(['PE', 'Belem'].includes(payload.region), 'Atendemos Pernambuco e Belém–PA.');
    requireThat(['Remoto', 'Presencial'].includes(payload.modality), 'Escolha a modalidade.');
    requireThat(payload.sector !== 'engenharia' || payload.modality === 'Presencial', 'Engenharia civil está disponível presencialmente neste piloto.');
    requireThat(text(payload.title).length >= 5 && text(payload.description).length >= 20, 'Informe um título e descreva sua necessidade em pelo menos 20 caracteres.');
    requireThat(payload.agreed === true, 'Confirme que leu as condições da solicitação.');
    const ticket = { id: uid(), code: `MVP-${String(state.tickets.length + 1).padStart(4, '0')}`, clientId: user.id, sector: payload.sector, service: payload.service, region: payload.region, city: payload.region === 'Belem' ? 'Belém' : text(payload.city, 80), modality: payload.modality, title: text(payload.title, 100), description: text(payload.description), details: text(payload.details, 1000), preferences: text(payload.preferences, 200), status: 'waiting', professionalId: null, startedAt: null, createdAt: now, updatedAt: now, closedAt: null, threads: [], proposals: [], appointments: [], review: null };
    requireThat(ticket.city.length >= 2, 'Informe a cidade de atendimento.');
    requireThat(state.tickets.filter(t => t.clientId === user.id && !CLOSED.includes(t.status)).length < 10, 'Você já possui dez solicitações abertas. Conclua ou cancele uma antes de continuar.');
    state.tickets.unshift(ticket); notifyEligible(state, ticket, now); record(action, ticket.id); return { ticketId: ticket.id };
  }
  if (action === 'readNotifications') { state.notifications.filter(n => n.userId === user.id).forEach(n => n.read = true); return {}; }
  if (action === 'profile') {
    user.name = text(payload.name || user.name, 70); requireThat(user.name.length >= 2, 'Informe seu nome.');
    if (user.role === 'professional') { user.available = !!payload.available; user.bio = text(payload.bio, 800); }
    record(action); return {};
  }
  if (action === 'support') {
    requireThat(text(payload.message).length >= 10, 'Descreva sua solicitação em pelo menos 10 caracteres.');
    if (payload.ticketId) requireThat(state.tickets.some(t => t.id === payload.ticketId && (t.clientId === user.id || t.professionalId === user.id)), 'Atendimento não encontrado.', 404);
    state.support.unshift({ id: uid(), userId: user.id, ticketId: payload.ticketId || null, category: text(payload.category, 80), message: text(payload.message, 2000), status: 'open', createdAt: now });
    record(action, payload.ticketId); return {};
  }
  if (action === 'resolveSupport') { requireThat(user.admin, 'Acesso restrito.', 403); const s = state.support.find(s => s.id === payload.id); requireThat(s, 'Solicitação não encontrada.', 404); s.status = 'resolved'; record(action, s.ticketId); return {}; }
  if (action === 'toggleProfessional') {
    requireThat(user.admin, 'Acesso restrito.', 403); const target = state.users.find(u => u.id === payload.id && u.role === 'professional'); requireThat(target && target.id !== user.id, 'Perfil inválido.'); target.active = !target.active; record(action); return {};
  }
  const ticket = state.tickets.find(t => t.id === payload.ticketId);
  requireThat(ticket, 'Chamado não encontrado.', 404);
  const client = ticket.clientId === user.id;
  const pro = ticket.professionalId === user.id;
  const thread = ticket.threads.at(-1);
  const open = !CLOSED.includes(ticket.status);
  if (action === 'accept') {
    requireThat(ticket.status === 'waiting' && !ticket.professionalId, 'Este chamado já foi assumido.', 409);
    requireThat(!client && compatible(user, ticket) && ticket.excludedProfessionalId !== user.id, 'Este chamado não é compatível com seu perfil.', 403);
    requireThat(activeCount(state, user.id) < 2, 'Você já está atendendo dois chamados.', 409);
    ticket.professionalId = user.id; ticket.status = 'conversation'; ticket.threads.push({ id: uid(), professionalId: user.id, createdAt: now, closedAt: null, messages: [], files: [] });
    notify(state, ticket.clientId, 'Seu chamado foi aceito', `${user.name} está disponível para conversar.`, ticket.id, now);
  } else {
    requireThat(client || pro, 'Você não participa deste atendimento.', 403);
    if (action === 'cancel') {
      requireThat(client && !ticket.startedAt && !['contracted', 'progress', 'delivery'].includes(ticket.status) && open, 'Após o início, solicite o encerramento pelo suporte.');
      ticket.status = 'cancelled'; ticket.closedAt = now; if (thread) thread.closedAt = now;
      if (ticket.professionalId) { notify(state, ticket.professionalId, 'Chamado cancelado', ticket.code, ticket.id, now); notifyVacancy(state, ticket.professionalId, now); }
    } else if (action === 'release') {
      requireThat(['conversation', 'proposal'].includes(ticket.status), 'Após a contratação, solicite suporte para tratar a transferência.');
      requireThat(text(payload.reason).length >= 5, 'Informe o motivo do novo encaminhamento.');
      const previous = ticket.professionalId;
      thread.messages.push({ id: uid(), authorId: user.id, text: `Solicitado novo encaminhamento: ${text(payload.reason, 500)}`, at: now, system: true }); thread.closedAt = now;
      ticket.proposals.filter(p => p.status === 'pending').forEach(p => p.status = 'superseded');
      ticket.appointments.filter(a => a.status === 'pending' || a.status === 'confirmed').forEach(a => a.status = 'cancelled');
      ticket.excludedProfessionalId = previous; ticket.professionalId = null; ticket.startedAt = null; ticket.status = 'waiting';
      notifyEligible(state, ticket, now); notify(state, ticket.clientId, 'Novo encaminhamento', 'O chamado voltou à fila de especialistas.', ticket.id, now); notifyVacancy(state, previous, now);
    } else if (action === 'message' || action === 'upload') {
      requireThat(open && thread && !thread.closedAt, 'Esta conversa está encerrada.');
      if (action === 'message') {
        requireThat(text(payload.text).length > 0, 'Escreva uma mensagem.');
        thread.messages.push({ id: uid(), authorId: user.id, text: text(payload.text), at: now });
      } else {
        requireThat(['application/pdf', 'image/png', 'image/jpeg'].includes(payload.type), 'Envie PDF, PNG ou JPG.');
        requireThat(typeof payload.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(payload.data) && payload.data.length > 0 && payload.data.length <= 2800000, 'Arquivo inválido ou maior que 2 MB.');
        requireThat(thread.files.length < 15, 'Limite de 15 anexos por conversa.');
        requireThat(!payload.receipt || (client && ticket.proposals.some(p => p.status === 'accepted' && p.threadId === thread.id)), 'Comprovantes exigem uma proposta aprovada.');
        const file = { id: uid(), name: text(payload.name, 120).replace(/[\\/<>:"|?*\r\n]/g, '_'), type: payload.type, data: payload.data, receipt: !!payload.receipt, authorId: user.id, at: now };
        thread.files.push(file); thread.messages.push({ id: uid(), authorId: user.id, text: file.receipt ? 'Comprovante anexado. Aguardando conferência do profissional.' : 'Arquivo compartilhado.', fileId: file.id, at: now });
      }
      if (pro && !ticket.startedAt) ticket.startedAt = now;
      notify(state, client ? ticket.professionalId : ticket.clientId, 'Nova mensagem', `Você recebeu uma mensagem em ${ticket.code}.`, ticket.id, now);
    } else if (action === 'proposal') {
      requireThat(pro && ['conversation', 'proposal', 'contracted', 'progress'].includes(ticket.status), 'Não é possível enviar proposta neste momento.');
      const amount = Number(payload.amount);
      requireThat(Number.isFinite(amount) && amount > 0 && amount <= 10000000, 'Informe um valor válido maior que zero.');
      requireThat(text(payload.scope).length >= 10 && text(payload.deadline).length >= 2 && text(payload.terms).length >= 3, 'Preencha escopo, prazo e condições de pagamento.');
      ticket.proposals.filter(p => p.status === 'pending').forEach(p => p.status = 'superseded');
      ticket.proposals.push({ id: uid(), threadId: thread.id, version: ticket.proposals.length + 1, professionalId: user.id, amount: Math.round(amount * 100), scope: text(payload.scope, 2000), exclusions: text(payload.exclusions, 1000), deadline: text(payload.deadline, 200), terms: text(payload.terms, 1000), validity: text(payload.validity || '7 dias', 100), status: 'pending', at: now });
      if (!ticket.proposals.some(p => p.status === 'accepted')) ticket.status = 'proposal';
      if (!ticket.startedAt) ticket.startedAt = now;
      notify(state, ticket.clientId, 'Uma proposta chegou', 'Confira o escopo e as condições antes de aprovar.', ticket.id, now);
    } else if (action === 'proposalDecision') {
      requireThat(client && open, 'Somente o cliente pode avaliar esta proposta.');
      const proposal = ticket.proposals.find(p => p.id === payload.proposalId && p.status === 'pending' && p.threadId === thread.id);
      requireThat(proposal, 'Proposta não está mais disponível.', 409);
      requireThat(['accepted', 'declined'].includes(payload.decision), 'Decisão inválida.');
      proposal.status = payload.decision; proposal.decidedAt = now; proposal.decidedBy = user.id;
      if (proposal.status === 'accepted') { ticket.proposals.filter(p => p.id !== proposal.id && p.status === 'accepted').forEach(p => p.status = 'replaced'); ticket.status = 'contracted'; }
      else if (ticket.status === 'proposal') ticket.status = 'conversation';
      notify(state, ticket.professionalId, proposal.status === 'accepted' ? 'Proposta aprovada' : 'Proposta recusada', ticket.code, ticket.id, now);
    } else if (action === 'startService') {
      requireThat(pro && ticket.status === 'contracted', 'É necessária uma proposta aprovada.'); ticket.status = 'progress';
    } else if (action === 'deliver') {
      requireThat(pro && ticket.status === 'progress', 'Inicie a execução antes de registrar a entrega.'); ticket.status = 'delivery'; notify(state, ticket.clientId, 'Serviço entregue', 'Revise a entrega e anexe seu comprovante, se ainda não o enviou.', ticket.id, now);
    } else if (action === 'confirmReceipt') {
      requireThat(pro && ['contracted', 'progress', 'delivery'].includes(ticket.status), 'A confirmação exige um serviço contratado.');
      const file = thread.files.find(f => f.id === payload.fileId && f.receipt); requireThat(file, 'Comprovante não encontrado.');
      file.confirmedAt = now; file.confirmedBy = user.id;
    } else if (action === 'complete') {
      requireThat(pro && ticket.status === 'delivery', 'Registre a entrega antes de concluir.');
      requireThat(thread.files.some(f => f.receipt && f.confirmedAt), 'Confira e confirme o recebimento do pagamento antes de concluir.');
      ticket.status = 'completed'; ticket.closedAt = now; thread.closedAt = now;
      notify(state, ticket.clientId, 'Atendimento concluído', 'Seu histórico estará disponível por 30 dias.', ticket.id, now); notifyVacancy(state, user.id, now);
    } else if (action === 'closeNoCharge') {
      requireThat(pro && ['conversation', 'proposal'].includes(ticket.status) && text(payload.reason).length >= 5, 'Informe um motivo. Serviços contratados exigem tratamento pelo suporte.');
      ticket.status = 'cancelled'; ticket.closedAt = now; ticket.closeReason = text(payload.reason, 300); thread.closedAt = now; notifyVacancy(state, user.id, now);
      notify(state, ticket.clientId, 'Atendimento encerrado sem cobrança', ticket.code, ticket.id, now);
    } else if (action === 'appointment') {
      requireThat(open && thread, 'Atendimento indisponível.');
      requireThat(Number.isFinite(Date.parse(payload.date)) && Date.parse(payload.date) > Date.parse(now), 'Escolha uma data futura.');
      requireThat(text(payload.location).length >= 3, 'Informe local ou orientação para a reunião.');
      ticket.appointments.push({ id: uid(), authorId: user.id, threadId: thread.id, date: new Date(payload.date).toISOString(), location: text(payload.location, 300), status: 'pending', at: now });
      notify(state, client ? ticket.professionalId : ticket.clientId, 'Novo horário proposto', ticket.code, ticket.id, now);
    } else if (action === 'appointmentDecision') {
      const appointment = ticket.appointments.find(a => a.id === payload.id && a.threadId === thread?.id);
      requireThat(open && appointment && appointment.authorId !== user.id && appointment.status === 'pending', 'Agendamento indisponível.');
      requireThat(['confirmed', 'declined'].includes(payload.decision), 'Decisão inválida.'); appointment.status = payload.decision;
    } else if (action === 'review') {
      requireThat(client && ticket.status === 'completed' && !ticket.review, 'Avaliação indisponível.');
      requireThat(Number.isInteger(Number(payload.rating)) && Number(payload.rating) >= 1 && Number(payload.rating) <= 5, 'Escolha uma nota de 1 a 5.');
      ticket.review = { rating: Number(payload.rating), comment: text(payload.comment, 1000), at: now };
    } else fail('Ação desconhecida.', 404);
  }
  ticket.updatedAt = now; record(action, ticket.id); result.ticketId = ticket.id; return result;
}
