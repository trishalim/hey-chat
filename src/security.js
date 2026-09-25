import { randomBytes, scrypt, timingSafeEqual, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [salt, value] = (hash || '').split(':');
  if (!salt || !value || typeof password !== 'string' || password.length > 1024) return false;
  const key = await derive(password, salt, 64);
  const expected = Buffer.from(value, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encrypt(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}
export function decrypt(value, key) {
  const [iv, tag, payload] = value.split('.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload, 'hex')), cipher.final()]).toString('utf8'));
}
export function validSignature(body, signature, secret) {
  return Boolean(secret) && safeEqual(signature, `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
}
export function csrfToken() { return randomBytes(32).toString('hex'); }
