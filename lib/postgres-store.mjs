import { schema } from '../database/schema.mjs';
import { createState, normalizeState, purgeExpired, act, requireThat, uid, DEMO_USERS } from '../public/domain.js';

export function createPostgresStore(pool, { migrate = true } = {}) {
  let ready;
  function init() {
    return ready ||= (async () => {
      if (!migrate) { await pool.query('SELECT id FROM mvp_state WHERE id=1'); return; }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(68142001)');
        await client.query(schema);
        await client.query('INSERT INTO mvp_state(id,content) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING', [JSON.stringify(createState())]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    })().catch(error => { ready = undefined; throw error; });
  }
  async function transaction(fn) {
    await init();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT content FROM mvp_state WHERE id=1 FOR UPDATE');
      const state = normalizeState(rows[0].content);
      const result = await fn(state, client);
      await client.query('UPDATE mvp_state SET content=$1::jsonb WHERE id=1', [JSON.stringify(state)]);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function read() {
    await init();
    return normalizeState((await pool.query('SELECT content FROM mvp_state WHERE id=1')).rows[0].content);
  }
  return {
    init, read, transaction,
    async activeUser(id) {
      await init();
      return !!(await pool.query("SELECT 1 FROM mvp_state, jsonb_array_elements(content->'users') AS u WHERE mvp_state.id=1 AND u->>'id'=$1 AND u->>'active'='true'", [id])).rows.length;
    },
    async neonIdentity(subject) {
      await init();
      const identity = (await pool.query('SELECT id,name,email,"emailVerified",banned FROM neon_auth."user" WHERE id::text=$1', [subject])).rows[0];
      requireThat(identity && !identity.banned, 'Sua conta não está disponível.', 401);
      const linked = (await pool.query('SELECT user_id FROM mvp_neon_identities WHERE subject=$1', [subject])).rows[0];
      if (linked) return linked.user_id;
      return transaction(async (state, client) => {
        const existing = (await client.query('SELECT user_id FROM mvp_neon_identities WHERE subject=$1', [subject])).rows[0];
        if (existing) return existing.user_id;
        const id = uid(), name = String(identity.name || 'Cliente').slice(0, 70);
        state.users.push({ id, name, initials: name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase(), email: identity.email, role: 'client', active: true, available: true, createdAt: new Date().toISOString() });
        await client.query('INSERT INTO mvp_neon_identities(subject,user_id) VALUES($1,$2)', [subject, id]);
        return id;
      });
    },
    async linkNeonSpecialist(subject, professionalId) {
      return transaction(async (state, client) => {
        const target = state.users.find(u => u.id === professionalId && u.role === 'professional');
        requireThat(target, 'Especialista inexistente.');
        const identity = (await client.query('SELECT id,email,"emailVerified" FROM neon_auth."user" WHERE id::text=$1', [subject])).rows[0];
        requireThat(identity?.emailVerified, 'O especialista precisa criar a conta no Neon Auth e verificar seu e-mail primeiro.');
        requireThat(!(await client.query('SELECT subject FROM mvp_neon_identities WHERE user_id=$1 AND subject<>$2', [professionalId, subject])).rows.length, 'Este especialista já possui uma identidade vinculada.', 409);
        const previous = (await client.query('SELECT user_id FROM mvp_neon_identities WHERE subject=$1', [subject])).rows[0];
        requireThat(!previous || previous.user_id === professionalId || !state.tickets.some(t => t.clientId === previous.user_id || t.professionalId === previous.user_id), 'Esta conta já possui atendimentos como cliente; utilize uma conta profissional separada.', 409);
        await client.query('INSERT INTO mvp_neon_identities(subject,user_id) VALUES($1,$2) ON CONFLICT(subject) DO UPDATE SET user_id=EXCLUDED.user_id', [subject, professionalId]);
        target.email = identity.email;
      });
    },
    async register(user, credentials) {
      return transaction(async (state, client) => {
        requireThat(!state.users.some(u => u.email === user.email || u.username === credentials.login), 'Não foi possível criar a conta com este e-mail.', 409);
        await client.query('INSERT INTO mvp_accounts(user_id,login,email,salt,hash) VALUES($1,$2,$3,$4,$5)', [user.id, credentials.login, user.email, credentials.salt, credentials.hash]);
        state.users.push(user);
      });
    },
    async provision(id, email, credentials) {
      return transaction(async (state, client) => {
        const user = state.users.find(u => u.id === id);
        requireThat(user?.role === 'professional', 'Especialista inexistente.');
        await client.query('INSERT INTO mvp_accounts(user_id,login,email,salt,hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,salt=EXCLUDED.salt,hash=EXCLUDED.hash', [id, user.username, email, credentials.salt, credentials.hash]);
        user.email = email;
        await client.query('DELETE FROM mvp_sessions WHERE user_id=$1', [id]);
      });
    },
    async account(login) {
      await init();
      return (await pool.query('SELECT * FROM mvp_accounts WHERE login=$1 OR email=$1', [login])).rows[0];
    },
    async session(token, time = Date.now()) {
      await init();
      return (await pool.query('SELECT * FROM mvp_sessions WHERE token=$1 AND expires>$2', [token, time])).rows[0];
    },
    async startSession(token, userId, csrf, expires) {
      await init();
      await pool.query('INSERT INTO mvp_sessions(token,user_id,csrf,expires) VALUES($1,$2,$3,$4)', [token, userId, csrf, expires]);
    },
    async logout(token) { await pool.query('DELETE FROM mvp_sessions WHERE token=$1', [token]); },
    async testUser(id) {
      requireThat(DEMO_USERS.some(u => u.id === id), 'Usuário ou senha inválidos.', 401);
      const active = await this.activeUser(id);
      // Once a real identity is linked, the public test password cannot access it.
      const linked = (await pool.query('SELECT subject FROM mvp_neon_identities WHERE user_id=$1', [id])).rows.length;
      requireThat(active && !linked, 'Usuário ou senha inválidos.', 401);
      return id;
    },
    async startTestSession(token, userId, expires) {
      await this.testUser(userId);
      await pool.query('INSERT INTO mvp_test_sessions(token,user_id,expires) VALUES($1,$2,$3)', [token, userId, expires]);
    },
    async testSession(token, time = Date.now()) {
      await init();
      const session = (await pool.query('SELECT * FROM mvp_test_sessions WHERE token=$1 AND expires>$2', [token, time])).rows[0];
      requireThat(session, 'Sua sessão expirou. Entre novamente.', 401);
      await this.testUser(session.user_id);
      return session;
    },
    async logoutTestSession(token) { await pool.query('DELETE FROM mvp_test_sessions WHERE token=$1', [token]); },
    async action(userId, action, payload, options) {
      return transaction(state => {
        const user = state.users.find(u => u.id === userId && u.active);
        requireThat(user, 'Entre na sua conta para continuar.', 401);
        purgeExpired(state, options.now);
        // Keep profile writes on the original object, but never expose admin
        // capabilities through the publicly known demonstration password.
        const actor = options.testSession ? new Proxy(user, { get: (target, key) => key === 'admin' ? false : Reflect.get(target, key) }) : user;
        return act(state, actor, action, payload, options);
      });
    },
    async cleanup(now = new Date().toISOString()) {
      const state = await read();
      if (purgeExpired(state, now)) await transaction(s => purgeExpired(s, now));
      await pool.query('DELETE FROM mvp_sessions WHERE expires<$1', [Date.parse(now)]);
      await pool.query('DELETE FROM mvp_test_sessions WHERE expires<$1', [Date.parse(now)]);
      await pool.query('DELETE FROM mvp_rate_limits WHERE expires<$1', [Date.parse(now)]);
    },
    async throttle(id, max, time = Date.now()) {
      await init();
      const { rows } = await pool.query('INSERT INTO mvp_rate_limits(id,count,expires) VALUES($1,1,$2) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN mvp_rate_limits.expires<$3 THEN 1 ELSE mvp_rate_limits.count+1 END, expires=CASE WHEN mvp_rate_limits.expires<$3 THEN $2 ELSE mvp_rate_limits.expires END RETURNING count', [id, time + 60000, time]);
      requireThat(rows[0].count <= max, 'Muitas tentativas. Aguarde um minuto.', 429);
    }
  };
}

export async function connectPostgres(connectionString = process.env.DATABASE_URL, { migrate = true, attachPool } = {}) {
  requireThat(connectionString, 'O banco compartilhado ainda não foi configurado.', 503);
  const url = new URL(connectionString);
  requireThat(['postgres:', 'postgresql:'].includes(url.protocol), 'Conexão de banco inválida.', 503);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  url.searchParams.delete('sslmode'); url.searchParams.delete('ssl');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true }, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, statement_timeout: 15000, idle_in_transaction_session_timeout: 15000, allowExitOnIdle: true });
  if (attachPool) attachPool(pool);
  else pool.on('error', () => console.error('Conexão com o banco compartilhado interrompida.'));
  const store = createPostgresStore(pool, { migrate });
  try { await store.init(); } catch (error) { await pool.end(); throw error; }
  return { store, close: () => pool.end() };
}
