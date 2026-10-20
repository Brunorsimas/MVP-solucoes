import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/api.mjs';
import retention from '../netlify/functions/retention.mjs';
import { neonDeployment } from '../lib/neon-deployment.mjs';

test('Netlify: encaminha para Neon sem variáveis de build no runtime e não duplica retenção', async () => {
  const keys = ['SITE_ID', 'NEON_AUTH_BASE_URL', 'NEON_FUNCTION_HELLO_BASE_URL', 'DATABASE_URL'];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]])), fetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const key of keys) delete process.env[key];
    process.env.SITE_ID = 'netlify-test-site';
    const deployment = neonDeployment(); assert.match(deployment.apiUrl, /^https:\/\//);
    globalThis.fetch = async (target, options) => {
      calls++; assert.equal(target.origin, new URL(deployment.apiUrl).origin);
      assert.equal(target.pathname, '/api/state');
      assert.equal(options.headers.get('authorization'), 'Bearer test-token');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.get('cookie'), null);
      return Response.json({ config: { authProvider: 'neon' } });
    };
    const response = await handler(new Request('https://site.example.test/api/state', { headers: { Authorization: 'Bearer test-token', Cookie: 'unrelated=private' } }), {});
    assert.equal(response.status, 200); assert.equal((await response.json()).config.authProvider, 'neon');
    await retention(); assert.equal(calls, 1);
    delete process.env.SITE_ID; assert.equal(neonDeployment(), null);
  } finally {
    globalThis.fetch = fetch;
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
});
