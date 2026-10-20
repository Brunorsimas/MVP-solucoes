import { connectPostgres } from '../../lib/postgres-store.mjs';
import { neonDeployment } from '../../lib/neon-deployment.mjs';

export default async function retention() {
  if (neonDeployment()) return; // Neon Trigger owns the shared retention schedule.
  const database = await connectPostgres();
  try { await database.store.cleanup(); } finally { await database.close(); }
}
export const config = { schedule: '0 * * * *' };
