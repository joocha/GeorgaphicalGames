import { config } from './config.js';
import { createApp } from './app.js';
import { createPool } from './db.js';

// Logs go to stdout/stderr; under systemd they land in the journal
// (journalctl -u geography-game-api).

const pool = createPool(config.databaseUrl);
if (!pool) console.warn('DATABASE_URL is not set; player and game session endpoints answer 503.');
if (!config.telegramBotToken || !config.sessionSecret) {
  console.warn('TELEGRAM_BOT_TOKEN or SESSION_SECRET is not set; Telegram login answers 503.');
}

const app = createApp({ config, pool });

const server = app.listen(config.port, config.host, () => {
  console.log(`Geography Game API listening on http://${config.host}:${config.port} (${config.env})`);
});

server.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

// systemd sends SIGINT (KillSignal=SIGINT) and waits TimeoutStopSec=30.
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  server.close(async () => {
    await pool?.end().catch(() => {});
    process.exit(0);
  });
  server.closeIdleConnections();

  setTimeout(() => {
    console.error('Forcing shutdown after 25s');
    process.exit(1);
  }, 25_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
