import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { createPostgresStore } from '../lib/postgres-store.mjs';
import { createNeonHandler, neonVerifier } from '../lib/neon-api.mjs';

const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.set('sslmode', 'verify-full');
const pool = new Pool({ connectionString: connection.toString(), max: 5, connectionTimeoutMillis: 15000, statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 });
attachDatabasePool(pool);
const store = createPostgresStore(pool, { migrate: false });
const handle = createNeonHandler({ store, authUrl: process.env.NEON_AUTH_BASE_URL, verify: neonVerifier({ authUrl: process.env.NEON_AUTH_BASE_URL, jwksUrl: process.env.NEON_AUTH_JWKS_URL }), origins: String(process.env.APP_ORIGINS || '').split(',').filter(Boolean), simulatedHour: process.env.PILOT_TIME === '10' ? 10 : null });

export default {
  async fetch(request) {
    if (new URL(request.url).pathname === '/internal/retention') {
      const parsed = await parseTriggerDelivery(request);
      if (!parsed.ok) return new Response('Unauthorized', { status: 401 });
      await store.cleanup();
      return Response.json({ ok: true });
    }
    return handle(request);
  }
};
