import crypto from 'node:crypto';

const COOKIE_NAME = 'egp_master_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function getSecret() {
  return process.env.MASTER_SESSION_SECRET || process.env.MASTER_PASSWORD || '';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

export function createSessionToken() {
  const payload = base64url(
    JSON.stringify({
      role: 'master',
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    })
  );
  return `${payload}.${sign(payload)}`;
}

export function isValidSessionToken(token) {
  if (!token || !getSecret()) return false;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'master' && Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function readCookie(req, name = COOKIE_NAME) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((part) => part.trim());
  for (const part of parts) {
    const [key, ...value] = part.split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

export function setMasterCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  );
}

export function clearMasterCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

export function requireMaster(req, res) {
  if (isValidSessionToken(readCookie(req))) return true;
  res.status(401).json({ error: 'Não autorizado.' });
  return false;
}

export function credentialsAreValid(login, password) {
  const expectedLogin = process.env.MASTER_LOGIN || '';
  const expectedPassword = process.env.MASTER_PASSWORD || '';
  return Boolean(
    expectedLogin &&
      expectedPassword &&
      login === expectedLogin &&
      password === expectedPassword
  );
}
