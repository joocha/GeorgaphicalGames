import { createHmac, timingSafeEqual } from 'node:crypto';

// Stateless API access token: "v1.<payload>.<signature>", both base64url.
// The payload is {sub: userId, iat, exp}; the signature is HMAC-SHA256 with
// SESSION_SECRET. A player gets a fresh token every time the Mini App opens.

const PREFIX = 'v1';

function sign(data, secret) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function issueToken(userId, secret, ttlSeconds, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat, exp: iat + ttlSeconds })).toString('base64url');
  const body = `${PREFIX}.${payload}`;
  return { token: `${body}.${sign(body, secret)}`, expiresAt: new Date((iat + ttlSeconds) * 1000) };
}

// Returns the user ID, or null if the token is malformed, forged or expired.
export function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;

  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string' || !Number.isInteger(payload.exp)) return null;
  if (payload.exp <= Math.floor(now / 1000)) return null;
  return payload.sub;
}
