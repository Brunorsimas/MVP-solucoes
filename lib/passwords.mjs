import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { requireThat } from '../public/domain.js';

export function passwordCredentials(password) {
  requireThat(typeof password === 'string' && password.length >= 10 && password.length <= 128, 'A senha deve ter de 10 a 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
// Constant-time check that also runs when the account is missing, so a wrong
// login and a wrong password take the same time to answer.
export function passwordMatches(account, password) {
  const hash = scryptSync(String(password ?? '').slice(0, 128), account?.salt || 'dummy-salt', 64);
  return !!account && timingSafeEqual(hash, Buffer.from(account.hash, 'hex'));
}
