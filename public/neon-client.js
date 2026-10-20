import { DEMO_USERS, DEMO_PASSWORD } from './domain.js';

const config = typeof __NEON_PUBLIC_CONFIG__ === 'undefined' ? {} : __NEON_PUBLIC_CONFIG__;
export const neonEnabled = !!(config.authUrl && config.apiUrl);
let client, tokenCache;
const testSessionKey = 'mvp-test-session:' + (config.apiUrl || '');
let testAccess;
try { testAccess = sessionStorage.getItem(testSessionKey) ?? undefined; } catch {}
function setTestAccess(value) {
  testAccess = value;
  try { if (value === undefined) sessionStorage.removeItem(testSessionKey); else sessionStorage.setItem(testSessionKey, value); } catch {}
}
function apiFetch(path, payload, token) {
  const url = new URL('api' + path, config.apiUrl.endsWith('/') ? config.apiUrl : config.apiUrl + '/');
  return fetch(url, { method: payload === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: payload === undefined ? undefined : JSON.stringify(payload), credentials: 'omit' });
}
async function jsonResponse(response) {
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Falha na conexão.');
  return data;
}
async function revokeTestSession() {
  if (testAccess) {
    const response = await apiFetch('/auth/logout', {}, testAccess);
    if (response.status !== 401) await jsonResponse(response);
  }
}
async function leaveTestSession() {
  await revokeTestSession();
  setTestAccess(undefined);
}
export async function neonAuth() {
  if (!client) {
    const { createAuthClient } = await import('@neondatabase/auth');
    client = createAuthClient(config.authUrl);
  }
  return client;
}
function checked(result) {
  if (result?.error) throw new Error(result.error.message || 'Não foi possível autenticar.');
  return result?.data;
}
export async function neonFetch(path, payload) {
  // An empty value records an explicit test sign-out. Do not unexpectedly
  // restore an older managed account hidden behind that demonstration session.
  if (testAccess !== undefined) {
    const response = await apiFetch(path, payload, testAccess);
    if (response.status === 401 && testAccess) {
      setTestAccess('');
      if (path === '/state' && payload === undefined) return apiFetch(path);
    }
    return response;
  }
  const auth = await neonAuth(), session = checked(await auth.getSession());
  let token;
  if (session?.user) {
    if (!tokenCache || tokenCache.user !== session.user.id || tokenCache.expires <= Date.now()) {
      // SDK 0.6 beta can return cached session data for /token. Force the
      // documented fetch path and keep the JWT only in memory until refresh.
      token = checked(await auth.token({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } }))?.token;
      if (token) {
        const { exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        tokenCache = { user: session.user.id, token, expires: Number(exp) * 1000 - 60000 };
      }
    } else token = tokenCache.token;
    if (!token) throw Error('Não foi possível verificar sua sessão. Entre novamente.');
  }
  return apiFetch(path, payload, token);
}
export async function neonRequest(path, payload) {
  const identifier = String(payload?.login || payload?.email || '').trim().toLocaleLowerCase('pt-BR');
  // The shared password only routes the explicit demonstration aliases here.
  // Other emails and real passwords keep using Managed Neon Auth.
  const testAlias = DEMO_USERS.some(u => u.email === identifier) && payload?.password === DEMO_PASSWORD;
  if (path === '/auth/login' && (!identifier.includes('@') || testAlias)) {
    const data = await jsonResponse(await apiFetch('/auth/test-login', { login: payload.login || payload.email, password: payload.password }));
    if (!/^mvp-test-[a-f0-9]{64}$/.test(data.token)) throw Error('Não foi possível iniciar a sessão de teste.');
    await revokeTestSession();
    tokenCache = null; setTestAccess(data.token);
    return { ok: true };
  }
  if (path === '/auth/logout' && testAccess !== undefined) {
    await revokeTestSession();
    tokenCache = null; setTestAccess('');
    return { ok: true };
  }
  const auth = await neonAuth();
  if (path === '/auth/register') {
    if (!payload.agreed) throw Error('Leia e aceite os termos para criar sua conta.');
    if (typeof payload.password !== 'string' || payload.password.length < 10 || payload.password.length > 128) throw Error('A senha deve ter de 10 a 128 caracteres.');
    checked(await auth.signUp.email({ name: payload.name, email: payload.email, password: payload.password }));
    if (!checked(await auth.getSession({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } }))?.user) throw Error('Conta criada. Confirme seu e-mail antes de entrar.');
    await leaveTestSession(); tokenCache = null;
    return { ok: true };
  }
  if (path === '/auth/login') {
    tokenCache = null;
    const email = String(payload.login || payload.email || '').trim();
    if (!email.includes('@')) throw Error('Nesta versão, entre com o e-mail cadastrado da sua conta.');
    checked(await auth.signIn.email({ email, password: payload.password }));
    if (!checked(await auth.getSession({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } }))?.user) throw Error('Sua sessão não foi restaurada. Tente entrar novamente.');
    await leaveTestSession();
    return { ok: true };
  }
  if (path === '/auth/logout') { tokenCache = null; checked(await auth.signOut()); return { ok: true }; }
  if (path === '/auth/recover') {
    checked(await auth.requestPasswordReset({ email: payload.email, redirectTo: location.origin + '/#/entrar' }));
    return { message: 'Se houver uma conta com este e-mail, siga as instruções de recuperação enviadas pelo Neon Auth.' };
  }
  if (path === '/auth/reset') { checked(await auth.resetPassword({ token: payload.token, newPassword: payload.password })); return { ok: true }; }
  if (path === '/auth/send-verification') { checked(await auth.emailOtp.sendVerificationOtp({ email: payload.email, type: 'email-verification' })); return { ok: true }; }
  if (path === '/auth/verify-email') { checked(await auth.emailOtp.verifyEmail({ email: payload.email, otp: payload.otp })); return { ok: true }; }
  const response = await neonFetch(path, payload);
  return jsonResponse(response);
}
