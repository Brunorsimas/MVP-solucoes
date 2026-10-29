import { connectPostgres } from '../../lib/postgres-store.mjs';
import { createSharedHandler } from '../../lib/shared-api.mjs';
import { neonDeployment } from '../../lib/neon-deployment.mjs';

let application;
export default async function handler(request, context) {
  try {
    const deployment = neonDeployment();
    if (deployment) {
      const target = new URL(deployment.apiUrl);
      target.pathname = new URL(request.url).pathname;
      const headers = new Headers();
      for (const name of ['authorization', 'content-type', 'origin']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
      const body = request.body ? await request.arrayBuffer() : undefined;
      if (body?.byteLength > 3000000) return Response.json({ error: 'Conteúdo maior que o permitido.' }, { status: 413 });
      return fetch(target, { method: request.method, headers, body, redirect: 'manual' });
    }
    application ||= connectPostgres().then(({ store }) => createSharedHandler({ store, simulatedHour: process.env.PILOT_TIME === '10' ? 10 : null })).catch(error => { application = undefined; throw error; });
    return await (await application)(request, { ip: context.ip });
  } catch (error) {
    console.error('Netlify API failure', { id: context.requestId, code: error.code, name: error.name, message: error.message, stack: error.stack });
    return Response.json({ error: 'O banco compartilhado está indisponível. O administrador precisa conferir a configuração.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const config = { path: '/api/*' };
