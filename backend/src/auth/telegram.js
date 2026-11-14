import { createHmac, timingSafeEqual } from 'node:crypto';

// Validates Telegram Mini App launch data (Telegram.WebApp.initData).
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
//   secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
//   hash       = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
//
// data_check_string is every received field except `hash`, as `key=value`,
// sorted by key and joined with "\n".

const MAX_INIT_DATA_LENGTH = 8192;

export class InitDataError extends Error {}

export function verifyTelegramInitData(initData, botToken, { maxAgeSeconds, now = Date.now() } = {}) {
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > MAX_INIT_DATA_LENGTH) {
    throw new InitDataError('initData is missing or too long');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new InitDataError('initData has no valid hash');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) {
    throw new InitDataError('initData signature does not match');
  }

  const authDate = Number.parseInt(params.get('auth_date') || '', 10);
  if (!Number.isInteger(authDate)) {
    throw new InitDataError('initData has no auth_date');
  }
  const ageSeconds = now / 1000 - authDate;
  if (maxAgeSeconds && ageSeconds > maxAgeSeconds) {
    throw new InitDataError('initData has expired');
  }
  if (ageSeconds < -300) {
    throw new InitDataError('initData auth_date is in the future');
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    throw new InitDataError('initData user is not valid JSON');
  }
  if (!user || typeof user !== 'object' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new InitDataError('initData has no user');
  }

  return {
    user,
    authDate: new Date(authDate * 1000),
    queryId: params.get('query_id') || null,
    chatType: params.get('chat_type') || null,
    chatInstance: params.get('chat_instance') || null,
    startParam: params.get('start_param') || null,
  };
}
