// End-to-end API test: Telegram login → game session → result, against the
// real migrations running in PGlite (embedded PostgreSQL), reached through
// node-postgres exactly as in production. Run with `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';

const BOT_TOKEN = '123456:TEST_BOT_TOKEN';
const config = {
  telegramBotToken: BOT_TOKEN,
  sessionSecret: 'test-session-secret-0123456789abcdef',
  telegramAuthMaxAge: 86_400,
  sessionTtl: 3600,
};

let db, socketServer, pool, httpServer, base;

// Builds initData the way Telegram signs it.
function signInitData(fields, botToken = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

function initDataFor(user, { authDate = Math.floor(Date.now() / 1000), ...extra } = {}) {
  return signInitData({
    query_id: 'AAH_test',
    user: JSON.stringify(user),
    auth_date: String(authDate),
    chat_type: 'private',
    start_param: 'friend42',
    signature: 'unused-by-bot-token-validation',
    ...extra,
  });
}

async function call(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const TG_USER = { id: 987654321, first_name: 'Nino', last_name: 'B', username: 'nino_b', language_code: 'ka', is_premium: true };

before(async () => {
  db = new PGlite();
  const dir = new URL('../prisma/migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter((n) => /^\d/.test(n)).sort()) {
    await db.exec(readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8'));
  }

  const port = 56000 + Math.floor(Math.random() * 1000);
  socketServer = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await socketServer.start();

  // One connection: PGlite runs a single backend, so transactions from
  // parallel connections would interleave.
  pool = createPool(`postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`, { max: 1 });
  httpServer = createApp({ config, pool }).listen(0, '127.0.0.1');
  await new Promise((r) => httpServer.once('listening', r));
  base = `http://127.0.0.1:${httpServer.address().port}/api`;
});

after(async () => {
  await new Promise((r) => httpServer.close(r));
  await pool.end();
  await socketServer.stop();
  await db.close();
});

let token, userId;

test('health works', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('rejects forged, missing and expired initData', async () => {
  const forged = signInitData({ user: JSON.stringify(TG_USER), auth_date: String(Math.floor(Date.now() / 1000)) }, '999:OTHER');
  assert.equal((await call('POST', '/auth/telegram', { body: { initData: forged } })).status, 401);
  assert.equal((await call('POST', '/auth/telegram', { body: {} })).status, 401);

  const old = initDataFor(TG_USER, { authDate: Math.floor(Date.now() / 1000) - 2 * 86_400 });
  const res = await call('POST', '/auth/telegram', { body: { initData: old } });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'invalid_init_data');
});

test('first launch registers the player, profile and Telegram identity', async () => {
  const res = await call('POST', '/auth/telegram', {
    body: { initData: initDataFor(TG_USER), platform: 'ios', version: '8.0' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.player.isNew, true);
  assert.deepEqual(res.body.player.profile, { displayName: 'Nino B', avatarUrl: null, locale: 'ka' });
  assert.deepEqual(res.body.player.telegram, { id: '987654321', username: 'nino_b' });
  assert.deepEqual(res.body.bests.telegram_country_quiz.easy, { metric: 'score', best: null, plays: 0, lastPlayedAt: null });
  token = res.body.token;
  userId = res.body.player.id;

  const identity = await db.query(`SELECT user_id, provider_data, last_used_at FROM auth_identities WHERE provider = 'telegram'`);
  assert.equal(identity.rows.length, 1);
  assert.equal(identity.rows[0].user_id, userId);
  assert.equal(identity.rows[0].provider_data.username, 'nino_b');
  assert.equal(identity.rows[0].provider_data.last_launch.start_param, 'friend42');
  assert.equal(identity.rows[0].provider_data.last_launch.platform, 'ios');
  assert.ok(identity.rows[0].last_used_at);
});

test('next launch logs the same player in and refreshes the profile', async () => {
  const res = await call('POST', '/auth/telegram', {
    body: { initData: initDataFor({ ...TG_USER, first_name: 'Nina', photo_url: 'https://t.me/i/userpic/320/x.jpg' }) },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.player.isNew, false);
  assert.equal(res.body.player.id, userId);
  assert.equal(res.body.player.profile.displayName, 'Nina B');
  assert.equal(res.body.player.profile.avatarUrl, 'https://t.me/i/userpic/320/x.jpg');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 1);
});

test('game endpoints need a valid token', async () => {
  const body = { game: 'telegram_country_quiz', mode: 'easy' };
  assert.equal((await call('POST', '/sessions', { body })).status, 401);
  assert.equal((await call('POST', '/sessions', { body, token: token + 'x' })).status, 401);
  assert.equal((await call('GET', '/me', { token: 'v1.e30.AAAA' })).status, 401);
});

test('a played game is recorded with result, best and outbox event', async () => {
  const start = await call('POST', '/sessions', {
    token, body: { game: 'telegram_country_quiz', mode: 'easy', clientPlatform: 'telegram' },
  });
  assert.equal(start.status, 201);
  assert.equal(start.body.session.status, 'in_progress');
  assert.equal(start.body.session.roundsPerSession, 10);
  const sid = start.body.session.id;

  // 3 correct answers can be worth 300..330 points, never 9999.
  const bad = await call('POST', `/sessions/${sid}/complete`, { token, body: { score: 9999, correctCount: 3, bestStreak: 2 } });
  assert.equal(bad.status, 422);

  const done = await call('POST', `/sessions/${sid}/complete`, {
    token, body: { score: 310, correctCount: 3, bestStreak: 2, details: { rounds: [] } },
  });
  assert.equal(done.status, 201);
  assert.equal(done.body.result.totalRounds, 10);
  assert.equal(done.body.result.xpEarned, null);
  assert.deepEqual(done.body.best, { metric: 'score', value: 310, previous: null, isNew: true });

  const again = await call('POST', `/sessions/${sid}/complete`, { token, body: { score: 310, correctCount: 3 } });
  assert.equal(again.status, 409);

  const event = await db.query(`SELECT event_type, status, payload FROM outbox_events`);
  assert.equal(event.rows.length, 1);
  assert.equal(event.rows[0].event_type, 'game_result.recorded');
  assert.equal(event.rows[0].payload.mode, 'easy');
  assert.equal(event.rows[0].payload.score, 310);

  // A lower score keeps the best.
  const s2 = (await call('POST', '/sessions', { token, body: { game: 'telegram_country_quiz', mode: 'easy' } })).body.session.id;
  const lower = await call('POST', `/sessions/${s2}/complete`, { token, body: { score: 100, correctCount: 1, bestStreak: 1 } });
  assert.deepEqual(lower.body.best, { metric: 'score', value: 310, previous: 310, isNew: false });
});

test('leaving a game abandons the session', async () => {
  const a = (await call('POST', '/sessions', { token, body: { game: 'telegram_country_quiz', mode: 'hard' } })).body.session.id;
  const b = await call('POST', '/sessions', { token, body: { game: 'telegram_country_quiz', mode: 'easy' } });
  assert.equal(b.body.abandonedSessions, 1);
  const status = await db.query(`SELECT status FROM game_sessions WHERE id = $1`, [a]);
  assert.equal(status.rows[0].status, 'abandoned');

  const sid = b.body.session.id;
  assert.equal((await call('POST', `/sessions/${sid}/abandon`, { token })).status, 204);
  assert.equal((await call('POST', `/sessions/${sid}/abandon`, { token })).status, 409);
  assert.equal((await call('POST', '/sessions/not-a-uuid/abandon', { token })).status, 404);
});

test('unknown modes are rejected', async () => {
  const res = await call('POST', '/sessions', { token, body: { game: 'telegram_country_quiz', mode: 'impossible' } });
  assert.equal(res.status, 404);
  const bad = await call('POST', '/sessions', { token, body: { game: 'DROP TABLE', mode: 'easy' } });
  assert.equal(bad.status, 400);
});

test('/me returns profile and personal bests', async () => {
  const res = await call('GET', '/me', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.player.profile.displayName, 'Nina B');
  const easy = res.body.bests.telegram_country_quiz.easy;
  assert.equal(easy.best, 310);
  assert.equal(easy.plays, 2);
  assert.equal(res.body.bests.telegram_country_quiz.hard.best, null);
});

test('without login config the endpoints answer 503', async () => {
  const app = createApp({ config: { ...config, telegramBotToken: '' }, pool }).listen(0, '127.0.0.1');
  await new Promise((r) => app.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${app.address().port}/api/auth/telegram`, { method: 'POST' });
  assert.equal(res.status, 503);
  await new Promise((r) => app.close(r));
});
