import { schema } from '../database/schema.mjs';
import { requireThat } from '../public/domain.js';

// Applies the schema to a database that was created before a table or trigger
// existed. The Function itself runs with migrate:false, so this is the only path.
const connectionString = process.argv[2] || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
requireThat(connectionString, 'Informe a URL direta (sem -pooler): npm run db:migrate -- "postgresql://..."');
requireThat(!new URL(connectionString).hostname.includes('-pooler'), 'Use a conexão direta, não a pooled, para migrações.');
const { Pool } = await import('pg');
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000 });
try {
  await pool.query('BEGIN');
  await pool.query('SELECT pg_advisory_xact_lock(68142001)');
  await pool.query(schema);
  await pool.query('COMMIT');
  const { rows } = await pool.query("SELECT to_regclass('public.mvp_files') AS files, (SELECT count(*) FROM pg_trigger WHERE tgname='mvp_state_changed') AS trigger");
  console.log(`Migração aplicada em ${new URL(connectionString).hostname}. mvp_files=${rows[0].files} trigger=${rows[0].trigger}`);
} catch (error) { await pool.query('ROLLBACK'); throw error; }
finally { await pool.end(); }
