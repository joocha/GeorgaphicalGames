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

export const config = {
  env: process.env.NODE_ENV || 'development',
  host,
  port,
};
