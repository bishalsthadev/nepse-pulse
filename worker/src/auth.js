/**
 * Authentication — register, login, JWT via Web Crypto API (no libraries).
 */

import { Hono } from 'hono';

const auth = new Hono();

// ----------------------------------------------------------------
// Crypto helpers (Web Crypto API, built into Workers runtime)
// ----------------------------------------------------------------

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashArr = new Uint8Array(bits);
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...hashArr].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashArr = new Uint8Array(bits);
  const computed = [...hashArr].map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hashHex;
}

export async function createJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const body = btoa(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 86400 }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${body}.${sigB64}`;
}

export async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// ----------------------------------------------------------------
// Middleware to extract user from JWT
// ----------------------------------------------------------------

export async function requireAuth(c, next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);
  c.set('userId', payload.sub);
  c.set('username', payload.username);
  await next();
}

// ----------------------------------------------------------------
// Routes
// ----------------------------------------------------------------

auth.post('/register', async (c) => {
  const { username, password } = await c.req.json();

  if (!username || !password) return c.json({ error: 'username and password required' }, 400);
  if (username.length < 3 || username.length > 30) return c.json({ error: 'Username must be 3–30 characters' }, 400);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return c.json({ error: 'Username can only contain letters, numbers, underscores' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return c.json({ error: 'Username already taken' }, 409);

  const hash = await hashPassword(password);
  const result = await c.env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').bind(username, hash).run();
  const userId = result.meta.last_row_id;

  const token = await createJWT({ sub: userId, username }, c.env.JWT_SECRET);
  return c.json({ token, username });
});

auth.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: 'username and password required' }, 400);

  const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE username = ?').bind(username).first();
  if (!user) return c.json({ error: 'Invalid credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

  const token = await createJWT({ sub: user.id, username }, c.env.JWT_SECRET);
  return c.json({ token, username });
});

auth.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare(
    'SELECT id, username, telegram_chat_id, paused, created_at FROM users WHERE id = ?'
  ).bind(userId).first();
  return c.json(user);
});

export default auth;
