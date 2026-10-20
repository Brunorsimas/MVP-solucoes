// Development/test adapter: real PostgreSQL WASM engine, one serialized connection.
// This file is never imported by Netlify Functions.
import { PGlite } from '@electric-sql/pglite';
export async function embeddedPostgres(path) {
  const database = new PGlite(path); await database.waitReady;
  let pending = Promise.resolve();
  async function acquire() {
    const previous = pending; let release;
    pending = new Promise(resolve => { release = resolve; });
    await previous; return release;
  }
  const query = (sql, values) => !values && sql.split(';').filter(v => v.trim()).length > 1 ? database.exec(sql).then(() => ({ rows: [] })) : database.query(sql, values);
  return {
    async query(sql, values) { const release = await acquire(); try { return await query(sql, values); } finally { release(); } },
    async connect() { const release = await acquire(); return { query, release }; },
    async listen(channel, callback) {
      const release = await acquire(); let stop;
      try { stop = await database.listen(channel, () => callback('change')); } finally { release(); }
      return async () => { const unlock = await acquire(); try { await stop(); } finally { unlock(); } };
    },
    async close() { const release = await acquire(); try { await database.close(); } finally { release(); } }
  };
}
