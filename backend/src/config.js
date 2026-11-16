// Environment comes from systemd's EnvironmentFile in production and from
// `node --env-file=.env` in development (npm run dev).

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '3020', 10);

// Port 3020 must never be publicly reachable; Nginx is the only entry point.
if (!LOOPBACK_HOSTS.has(host)) {
  throw new Error(`HOST must be a loopback address (got "${host}"). Use 127.0.0.1.`);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a valid TCP port (got "${process.env.PORT}").`);
}

// `names` are tried in order; later ones are older spellings kept so an
// existing .env keeps working.
function positiveInt(names, fallback) {
  const name = [].concat(names).find((n) => process.env[n] !== undefined && process.env[n] !== '');
  if (!name) return fallback;
  const raw = process.env[name];
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}").`);
  }
  return value;
}

// Missing secrets don't stop the server: /api/health keeps working (the
// deploy checks it) and the endpoints that need them answer 503 instead.
const sessionSecret = process.env.SESSION_SECRET || '';
if (sessionSecret && sessionSecret.length < 32) {
  console.warn('SESSION_SECRET is shorter than 32 characters; player login is disabled.');
}

const internalApiToken = process.env.INTERNAL_API_TOKEN || '';
if (internalApiToken && internalApiToken.length < 32) {
  console.warn('INTERNAL_API_TOKEN is shorter than 32 characters; the internal API is disabled.');
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  host,
  port,
  databaseUrl: process.env.DATABASE_URL || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  // Reject Telegram initData older than this (seconds since auth_date).
  // Telegram signs fresh initData on every launch, so a short window only
  // limits how long a leaked copy can be replayed.
  telegramAuthMaxAge: positiveInt(['TELEGRAM_AUTH_MAX_AGE', 'TELEGRAM_AUTH_MAX_AGE_SECONDS'], 300),
  sessionSecret: sessionSecret.length >= 32 ? sessionSecret : '',
  // Lifetime of the API access token returned by /api/auth/telegram.
  sessionTtl: positiveInt('SESSION_TTL_SECONDS', 86_400),
  // Shared secret for /api/internal/* (n8n). Empty: those endpoints answer 503.
  internalApiToken: internalApiToken.length >= 32 ? internalApiToken : '',
};
