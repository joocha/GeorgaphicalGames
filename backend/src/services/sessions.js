import { withTransaction } from '../db.js';
import { HttpError } from '../http-error.js';

const CODE_RE = /^[a-z][a-z0-9_]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DETAILS_BYTES = 16 * 1024;

function code(value, field, max = 64) {
  if (typeof value !== 'string' || value.length > max || !CODE_RE.test(value)) {
    throw new HttpError(400, 'invalid_request', `${field} must be a lower-case code`);
  }
  return value;
}

function sessionId(value) {
  // Anything that isn't a UUID can't exist; answer 404 instead of letting
  // PostgreSQL reject the cast.
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new HttpError(404, 'session_not_found', 'Game session not found');
  }
  return value;
}

function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new HttpError(422, 'invalid_result', `${field} is required`);
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(422, 'invalid_result', `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

// Opens a game session (status in_progress) for the player. Any session the
// player left unfinished in the same game is closed as abandoned first.
export async function startSession(pool, userId, body = {}) {
  const gameCode = code(body.game, 'game');
  const modeCode = code(body.mode, 'mode');
  const clientPlatform = code(body.clientPlatform ?? 'web', 'clientPlatform', 32);

  return withTransaction(pool, async (db) => {
    const { rows: modes } = await db.query(
      `SELECT gm.id, gm.game_id, gm.code, gm.name, gm.rounds_per_session, gm.best_metric
         FROM game_modes gm
         JOIN games g ON g.id = gm.game_id
        WHERE g.code = $1 AND gm.code = $2 AND g.is_active AND gm.is_active`,
      [gameCode, modeCode],
    );
    const mode = modes[0];
    if (!mode) throw new HttpError(404, 'mode_not_found', 'Unknown game or mode');

    const abandoned = await db.query(
      `UPDATE game_sessions s
          SET status = 'abandoned', ended_at = now(), updated_at = now()
         FROM game_modes gm
        WHERE s.game_mode_id = gm.id AND gm.game_id = $2
          AND s.user_id = $1 AND s.status = 'in_progress'`,
      [userId, mode.game_id],
    );

    const { rows } = await db.query(
      `INSERT INTO game_sessions (user_id, game_mode_id, client_platform)
       VALUES ($1, $2, $3)
       RETURNING id, status, client_platform, started_at`,
      [userId, mode.id, clientPlatform],
    );

    return {
      session: {
        id: rows[0].id,
        status: rows[0].status,
        clientPlatform: rows[0].client_platform,
        startedAt: rows[0].started_at,
        game: gameCode,
        mode: mode.code,
        roundsPerSession: mode.rounds_per_session,
        bestMetric: mode.best_metric,
      },
      abandonedSessions: abandoned.rowCount,
    };
  });
}

// Highest streak bonus total reachable with `correct` correct answers.
function maxStreakBonus(correct, step, cap) {
  let bonus = 0;
  for (let k = 1; k <= correct; k++) bonus += Math.min(cap, (k - 1) * step);
  return bonus;
}

// Checks a submitted result against the mode's rules in game_modes.config.
// The frontend still runs the game; this only rejects impossible results.
export function validateResult(mode, body = {}) {
  const totalRounds = mode.rounds_per_session;
  const scoring = mode.config?.scoring || {};

  const correctCount = int(body.correctCount, 'correctCount', { max: totalRounds });
  const score = int(body.score, 'score', { max: scoring.maxScore ?? 1_000_000 });
  const bestStreak = int(body.bestStreak, 'bestStreak', { max: correctCount, optional: true });
  let stars = null;

  if (Number.isInteger(scoring.correctBase)) {
    const step = scoring.streakBonusPerStep ?? 0;
    const cap = scoring.streakBonusCap ?? 0;
    const min = correctCount * scoring.correctBase;
    const max = min + maxStreakBonus(correctCount, step, cap);
    if (score < min || score > max) {
      throw new HttpError(422, 'invalid_result', `score must be between ${min} and ${max} for ${correctCount} correct answers`);
    }
    if (bestStreak === 0 && correctCount > 0) {
      throw new HttpError(422, 'invalid_result', 'bestStreak must be at least 1 when an answer was correct');
    }
  }

  if (Number.isInteger(scoring.pointsPerStar)) {
    stars = int(body.stars, 'stars', { max: 3 * totalRounds });
    if (score !== stars * scoring.pointsPerStar) {
      throw new HttpError(422, 'invalid_result', 'score must equal stars × pointsPerStar');
    }
  } else if (body.stars !== undefined && body.stars !== null) {
    throw new HttpError(422, 'invalid_result', 'stars are not used in this mode');
  }

  let details = null;
  if (body.details !== undefined && body.details !== null) {
    if (typeof body.details !== 'object' || Array.isArray(body.details)) {
      throw new HttpError(422, 'invalid_result', 'details must be an object');
    }
    if (Buffer.byteLength(JSON.stringify(body.details)) > MAX_DETAILS_BYTES) {
      throw new HttpError(422, 'invalid_result', 'details is too large');
    }
    details = body.details;
  }

  // Modes that award XP describe it as "round(score / 10)".
  const xpEarned = mode.config?.xp ? Math.round(score / 10) : null;

  return { score, correctCount, totalRounds, stars, bestStreak, xpEarned, details };
}

const BEST_COLUMN = { score: 'score', correct_count: 'correct_count', stars: 'stars' };

// Records a finished game (docs/database.md, section 7): completes the
// session, inserts its result and the outbox event in one transaction.
export async function completeSession(pool, userId, rawSessionId, body) {
  const id = sessionId(rawSessionId);

  return withTransaction(pool, async (db) => {
    const { rows } = await db.query(
      `SELECT s.id, s.status, s.game_mode_id,
              gm.code AS mode_code, gm.rounds_per_session, gm.best_metric, gm.config,
              g.code AS game_code
         FROM game_sessions s
         JOIN game_modes gm ON gm.id = s.game_mode_id
         JOIN games g ON g.id = gm.game_id
        WHERE s.id = $1 AND s.user_id = $2
          FOR UPDATE OF s`,
      [id, userId],
    );
    const session = rows[0];
    if (!session) throw new HttpError(404, 'session_not_found', 'Game session not found');
    if (session.status !== 'in_progress') {
      throw new HttpError(409, 'session_closed', `Game session is already ${session.status}`);
    }

    const result = validateResult(session, body);
    const column = BEST_COLUMN[session.best_metric];

    const previous = await db.query(
      `SELECT max(${column}) AS best FROM game_results WHERE user_id = $1 AND game_mode_id = $2`,
      [userId, session.game_mode_id],
    );
    const previousBest = previous.rows[0].best;

    const ended = await db.query(
      `UPDATE game_sessions
          SET status = 'completed', ended_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING ended_at,
                  least(extract(epoch FROM (ended_at - started_at)) * 1000, 2147483647)::int AS duration_ms`,
      [id],
    );

    const inserted = await db.query(
      `INSERT INTO game_results
         (session_id, user_id, game_mode_id, score, correct_count, total_rounds,
          stars, best_streak, xp_earned, duration_ms, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, score, correct_count, total_rounds, stars, best_streak,
                 xp_earned, duration_ms, completed_at`,
      [id, userId, session.game_mode_id, result.score, result.correctCount, result.totalRounds,
        result.stars, result.bestStreak, result.xpEarned, ended.rows[0].duration_ms, result.details],
    );
    const row = inserted.rows[0];

    await db.query(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('game_result', $1, 'game_result.recorded', $2)`,
      [row.id, {
        resultId: row.id,
        sessionId: id,
        userId,
        game: session.game_code,
        mode: session.mode_code,
        score: row.score,
        correctCount: row.correct_count,
        totalRounds: row.total_rounds,
        stars: row.stars,
        bestStreak: row.best_streak,
        xpEarned: row.xp_earned,
        durationMs: row.duration_ms,
        completedAt: row.completed_at,
      }],
    );

    const value = { score: row.score, correct_count: row.correct_count, stars: row.stars }[session.best_metric];
    const isNewBest = previousBest === null || value > previousBest;

    return {
      result: {
        id: row.id,
        sessionId: id,
        score: row.score,
        correctCount: row.correct_count,
        totalRounds: row.total_rounds,
        stars: row.stars,
        bestStreak: row.best_streak,
        xpEarned: row.xp_earned,
        durationMs: row.duration_ms,
        completedAt: row.completed_at,
      },
      best: {
        metric: session.best_metric,
        value: isNewBest ? value : previousBest,
        previous: previousBest,
        isNew: isNewBest,
      },
    };
  });
}

// Marks an unfinished session as abandoned (the player left mid-game).
export async function abandonSession(pool, userId, rawSessionId) {
  const id = sessionId(rawSessionId);
  const { rows } = await pool.query(
    `UPDATE game_sessions
        SET status = 'abandoned', ended_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
      RETURNING id`,
    [id, userId],
  );
  if (rows.length) return;

  const exists = await pool.query(`SELECT status FROM game_sessions WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!exists.rows.length) throw new HttpError(404, 'session_not_found', 'Game session not found');
  throw new HttpError(409, 'session_closed', `Game session is already ${exists.rows[0].status}`);
}
