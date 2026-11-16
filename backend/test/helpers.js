// Shared test harness: an embedded PostgreSQL (PGlite) with the real
// migrations, reached through node-postgres exactly as in production, and the
// real Express app on a random port.
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { buildContent, loadContentFiles } from '../src/content/build.js';
import { importContent } from '../src/content/import.js';

export const BOT_TOKEN = '123456:TEST_BOT_TOKEN';
export const INTERNAL_TOKEN = 'internal-test-token-0123456789abcdef';
export const config = {
  telegramBotToken: BOT_TOKEN,
  sessionSecret: 'test-session-secret-0123456789abcdef',
  telegramAuthMaxAge: 300,
  sessionTtl: 3600,
  internalApiToken: INTERNAL_TOKEN,
};

const MIGRATIONS = new URL('../prisma/migrations/', import.meta.url);
export const migrationNames = () => readdirSync(MIGRATIONS).filter((n) => /^\d/.test(n)).sort();

export async function applyMigrations(db, filter = () => true) {
  for (const name of migrationNames().filter(filter)) {
    await db.exec(readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8'));
  }
}

export function signInitData(fields, botToken = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

export const initDataFor = (user) => signInitData({
  user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000)),
});

// Starts PGlite + the API. `prepare(db)` runs before the server starts
// (e.g. to apply only some migrations and insert legacy rows).
export async function startHarness({ migrate = true, importSeedContent = true, prepare } = {}) {
  const db = new PGlite();
  if (prepare) await prepare(db);
  else if (migrate) await applyMigrations(db);

  const port = 55000 + Math.floor(Math.random() * 4000);
  const socketServer = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await socketServer.start();
  const pool = createPool(`postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`, { max: 1 });

  let importSummary = null;
  if (importSeedContent) {
    try {
      const { content, errors } = buildContent(loadContentFiles());
      if (errors.length) throw new Error(`content errors: ${errors.join('; ')}`);
      importSummary = await importContent(pool, content);
    } catch (err) {
      // Don't leave the socket server holding the process open.
      await pool.end().catch(() => {});
      await socketServer.stop().catch(() => {});
      await db.close().catch(() => {});
      throw err;
    }
  }

  const httpServer = createApp({ config, pool }).listen(0, '127.0.0.1');
  await new Promise((r) => httpServer.once('listening', r));
  const base = `http://127.0.0.1:${httpServer.address().port}/api`;

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

  async function login(tgUser) {
    const res = await call('POST', '/auth/telegram', { body: { initData: initDataFor(tgUser) } });
    if (res.status >= 300) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.token, userId: res.body.player.id };
  }

  async function stop() {
    await new Promise((r) => httpServer.close(r));
    await pool.end();
    await socketServer.stop();
    await db.close();
  }

  return { db, pool, call, login, stop, importSummary };
}

// Builds a correct answer for a served question from the database (tests only).
export async function correctAnswerFor(db, sessionId, round) {
  const { rows: [r] } = await db.query(
    `SELECT a.correct_answers, q.answer_mode FROM game_answers a JOIN question_bank q ON q.id = a.question_id
      WHERE a.session_id = $1 AND a.round_index = $2`,
    [sessionId, round],
  );
  const c = r.correct_answers;
  switch (r.answer_mode) {
    case 'options': return { optionIds: c };
    case 'map_single': return { countries: [c[0]] };
    case 'map_multi': return { countries: c };
    case 'pairs': return { pairs: c };
    default: throw new Error(r.answer_mode);
  }
}

// A wrong answer of the right shape.
export function wrongAnswerFor(question) {
  switch (question.answerMode) {
    case 'options': return null; // decided by the caller from the reveal
    case 'map_single':
    case 'map_multi': return { countries: ['Iceland'] };
    case 'pairs': return { pairs: [] };
    default: throw new Error(question.answerMode);
  }
}
