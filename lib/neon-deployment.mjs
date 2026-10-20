// Public URLs for this application's deployment. No credentials belong here.
const production = {
  authUrl: 'https://ep-quiet-grass-b4esd0a1.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth',
  apiUrl: 'https://br-lingering-bonus-b4ixzdjv-hello.compute.c-6.us-east-2.aws.neon.tech/'
};
export function neonDeployment(env = process.env) {
  if (env.NEON_AUTH_BASE_URL && env.NEON_FUNCTION_HELLO_BASE_URL) return { authUrl: env.NEON_AUTH_BASE_URL, apiUrl: env.NEON_FUNCTION_HELLO_BASE_URL };
  // SITE_ID is provided by Netlify at runtime; netlify.toml build variables aren't.
  return env.SITE_ID ? production : null;
}
