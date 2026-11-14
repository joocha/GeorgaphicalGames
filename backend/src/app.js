import express from 'express';
import { verifyTelegramInitData, InitDataError } from './auth/telegram.js';
import { issueToken, verifyToken } from './auth/token.js';
import { HttpError } from './http-error.js';
import { loginTelegramPlayer, getProfile, getPersonalBests } from './services/players.js';
import { startSession, completeSession, abandonSession } from './services/sessions.js';

// The game the Telegram Mini App (index.html) plays.
const TELEGRAM_GAME = 'telegram_country_quiz';

export function createApp({ config, pool }) {
  const app = express();

  // Requests arrive through Nginx on the same machine; trust its
  // X-Forwarded-* headers so req.ip and req.protocol are correct.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Nginx forwards the full path (proxy_pass has no trailing URI),
  // so every route lives under /api.
  const api = express.Router();

  api.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  // --- guards --------------------------------------------------------------

  const requireDb = (req, res, next) => {
    if (!pool) return next(new HttpError(503, 'database_not_configured', 'Database is not configured'));
    next();
  };

  const requireLoginConfig = (req, res, next) => {
    if (!config.telegramBotToken || !config.sessionSecret) {
      return next(new HttpError(503, 'auth_not_configured', 'Player login is not configured'));
    }
    next();
  };

  // Bearer token from /api/auth/telegram. Also refreshes users.last_seen_at
  // and rejects tokens of users that no longer exist.
  const requireUser = async (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const userId = token && verifyToken(token, config.sessionSecret);
    if (!userId) throw new HttpError(401, 'unauthorized', 'Missing or invalid access token');

    const { rows } = await pool.query(
      `UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING id`,
      [userId],
    );
    if (!rows.length) throw new HttpError(401, 'unauthorized', 'Player no longer exists');
    req.userId = userId;
    next();
  };

  const authed = [requireDb, requireLoginConfig, requireUser];

  // --- player --------------------------------------------------------------

  // Mini App launch: verifies Telegram initData, registers the player on
  // first launch (user + profile + Telegram identity), refreshes the profile,
  // and returns an access token plus the player's personal bests.
  api.post('/auth/telegram', requireDb, requireLoginConfig, async (req, res) => {
    const { initData, platform, version } = req.body || {};

    let launch;
    try {
      launch = verifyTelegramInitData(initData, config.telegramBotToken, {
        maxAgeSeconds: config.telegramAuthMaxAge,
      });
    } catch (err) {
      if (err instanceof InitDataError) throw new HttpError(401, 'invalid_init_data', err.message);
      throw err;
    }

    const player = await loginTelegramPlayer(pool, launch, { platform, version });
    const { token, expiresAt } = issueToken(player.userId, config.sessionSecret, config.sessionTtl);
    const bests = await getPersonalBests(pool, player.userId, TELEGRAM_GAME);

    res.status(player.isNew ? 201 : 200).json({
      token,
      expiresAt,
      player: {
        id: player.userId,
        isNew: player.isNew,
        profile: player.profile,
        telegram: player.telegram,
      },
      bests: { [TELEGRAM_GAME]: bests },
    });
  });

  // Profile and personal bests. ?game=<code> selects the game (default:
  // the Telegram Mini App's).
  api.get('/me', authed, async (req, res) => {
    const game = typeof req.query.game === 'string' ? req.query.game : TELEGRAM_GAME;
    const [profile, bests] = await Promise.all([
      getProfile(pool, req.userId),
      getPersonalBests(pool, req.userId, game),
    ]);
    res.json({ player: { id: req.userId, profile }, bests: { [game]: bests } });
  });

  // --- game sessions -------------------------------------------------------

  // Body: {game, mode, clientPlatform}
  api.post('/sessions', authed, async (req, res) => {
    res.status(201).json(await startSession(pool, req.userId, req.body));
  });

  // Body: {score, correctCount, bestStreak?, stars?, details?}
  api.post('/sessions/:id/complete', authed, async (req, res) => {
    res.status(201).json(await completeSession(pool, req.userId, req.params.id, req.body));
  });

  api.post('/sessions/:id/abandon', authed, async (req, res) => {
    await abandonSession(pool, req.userId, req.params.id);
    res.status(204).end();
  });

  app.use('/api', api);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err, req, res, next) => {
    // Our own errors, and client errors from Express (e.g. malformed JSON).
    const clientError = err.expose && err.status >= 400 && err.status < 500;
    if (err instanceof HttpError || clientError) {
      return res.status(err.status).json({ error: err.message, code: err.code || err.type || 'bad_request' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
  });

  return app;
}
