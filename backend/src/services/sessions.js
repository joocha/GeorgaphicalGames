import { withTransaction } from '../db.js';
import { HttpError } from '../http-error.js';
import { assertLevelUnlocked, progressAfterResult } from './levels.js';
import { scoringSnapshot, scoreAnswer, sessionTotals, applyMultiplier, toMultiplier } from '../engine/scoring.js';
import { evaluateAnswer } from '../engine/evaluate.js';
import { publicQuestion, reveal, isMulti, QUESTION_COLUMNS, QUESTION_JOINS } from '../engine/present.js';

// Game sessions. Two kinds share one lifecycle (start → complete | abandon):
//
// - Client-run games (Level 1 Atlas Quest, the Web Game): the frontend plays
//   the rounds and submits a result; the backend checks it against the mode's
//   rules (validateResult) and applies the level multiplier.
// - Question-engine games (Levels 2-5): the backend picks the questions,
//   validates and scores every answer (submitAnswer) and computes the result
//   itself. Nothing the client sends about scores is trusted.
//
// Documentation: docs/API_REFERENCE.md, docs/SCORING_AND_PROGRESSION.md.

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

const isEngine = (config) => config?.engine === 'question_engine';

const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const MODE_COLUMNS = `
  gm.id, gm.game_id, gm.code, gm.name, gm.rounds_per_session, gm.best_metric, gm.config, g.code AS game_code,
  l.id AS level_id, l.number AS level_number, l.code AS level_code, l.name AS level_name,
  l.score_multiplier AS level_multiplier, l.unlock_rule AS level_unlock_rule, l.session_config AS level_session_config`;

// Resolves {game, mode} (existing clients) or {level, mode?} (level clients).
async function resolveMode(db, body) {
  if (body.level !== undefined && body.game === undefined) {
    const levelCode = code(body.level, 'level', 32);
    const modeCode = body.mode === undefined ? null : code(body.mode, 'mode');
    const { rows } = await db.query(
      `SELECT ${MODE_COLUMNS}
         FROM game_levels l
         JOIN game_modes gm ON gm.level_id = l.id
         JOIN games g ON g.id = gm.game_id
        WHERE l.code = $1 AND l.is_active AND gm.is_active AND g.is_active AND ($2::text IS NULL OR gm.code = $2)
        ORDER BY gm.sort_order LIMIT 1`,
      [levelCode, modeCode],
    );
    if (!rows[0]) throw new HttpError(404, 'mode_not_found', 'Unknown level or mode');
    return rows[0];
  }
  const gameCode = code(body.game, 'game');
  const modeCode = code(body.mode, 'mode');
  const { rows } = await db.query(
    `SELECT ${MODE_COLUMNS}
       FROM game_modes gm
       JOIN games g ON g.id = gm.game_id
       LEFT JOIN game_levels l ON l.id = gm.level_id
      WHERE g.code = $1 AND gm.code = $2 AND g.is_active AND gm.is_active`,
    [gameCode, modeCode],
  );
  if (!rows[0]) throw new HttpError(404, 'mode_not_found', 'Unknown game or mode');
  return rows[0];
}

// Picks `count` verified questions of the level, avoiding the ones the
// player saw in their last `window` rounds of that level when possible.
async function selectQuestions(db, { userId, levelId, count, difficulty, window }) {
  const { rows: candidates } = await db.query(
    `SELECT id FROM question_bank
      WHERE level_id = $1 AND verification_status = 'verified' AND is_active
        AND difficulty BETWEEN $2 AND $3`,
    [levelId, difficulty?.min ?? 1, difficulty?.max ?? 3],
  );
  const { rows: recent } = await db.query(
    `SELECT a.question_id
       FROM game_answers a JOIN game_sessions s ON s.id = a.session_id
      WHERE s.user_id = $1 AND s.level_id = $2
      ORDER BY s.started_at DESC, a.round_index DESC
      LIMIT $3`,
    [userId, levelId, window],
  );
  // Most recently seen last, so older repeats are used first when needed.
  const recentOrder = [...new Set(recent.map((r) => r.question_id))].reverse();
  const recentSet = new Set(recentOrder);
  const fresh = shuffle(candidates.map((c) => c.id).filter((id) => !recentSet.has(id)));
  const reused = recentOrder.filter((id) => candidates.some((c) => c.id === id));
  return [...fresh, ...reused].slice(0, count);
}

// Opens a game session (status in_progress). Any session the player left
// unfinished in the same game is closed as abandoned first. Question-engine
// sessions also get their questions here.
export async function startSession(pool, userId, body = {}) {
  const clientPlatform = code(body.clientPlatform ?? 'web', 'clientPlatform', 32);

  return withTransaction(pool, async (db) => {
    const mode = await resolveMode(db, body);
    const engine = isEngine(mode.config);
    const level = mode.level_id ? {
      id: mode.level_id, number: mode.level_number, code: mode.level_code, name: mode.level_name,
      score_multiplier: mode.level_multiplier, unlock_rule: mode.level_unlock_rule,
    } : null;
    if (level) await assertLevelUnlocked(db, userId, level);

    let rounds = mode.rounds_per_session;
    if (engine) {
      const cfg = mode.level_session_config || {};
      const allowed = cfg.allowedRounds || [cfg.defaultRounds || mode.rounds_per_session];
      rounds = body.rounds ?? cfg.defaultRounds ?? mode.rounds_per_session;
      if (!allowed.includes(rounds)) {
        throw new HttpError(422, 'invalid_rounds', `rounds must be one of ${allowed.join(', ')}`);
      }
    }

    const abandoned = await db.query(
      `UPDATE game_sessions s
          SET status = 'abandoned', ended_at = now(), updated_at = now()
         FROM game_modes gm
        WHERE s.game_mode_id = gm.id AND gm.game_id = $2
          AND s.user_id = $1 AND s.status = 'in_progress'`,
      [userId, mode.game_id],
    );

    let questionIds = [];
    if (engine) {
      questionIds = await selectQuestions(db, {
        userId, levelId: level.id, count: rounds,
        difficulty: mode.config.difficulty, window: mode.config.recentQuestionWindow ?? 30,
      });
      if (!questionIds.length) throw new HttpError(409, 'no_questions', 'This level has no published questions yet');
    }

    // Scoring snapshot: only for modes that belong to a level. Other games
    // (the Web Game) keep the v1 behaviour exactly.
    const snapshot = level ? scoringSnapshot({ level, mode }) : null;
    const { rows } = await db.query(
      `INSERT INTO game_sessions (user_id, game_mode_id, client_platform, level_id, score_multiplier, scoring_rules, rounds_planned)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, client_platform, started_at`,
      [userId, mode.id, clientPlatform, level?.id ?? null, snapshot ? snapshot.multiplier : null, snapshot,
        engine ? questionIds.length : null],
    );
    const session = rows[0];

    let questions;
    if (engine) {
      const { rows: qs } = await db.query(
        `SELECT ${QUESTION_COLUMNS} FROM question_bank q ${QUESTION_JOINS} WHERE q.id = ANY($1::uuid[])`,
        [questionIds],
      );
      const byId = new Map(qs.map((q) => [q.id, q]));
      questions = [];
      for (const [i, id] of questionIds.entries()) {
        const q = byId.get(id);
        await db.query(
          `INSERT INTO game_answers (session_id, round_index, question_id, question_version, correct_answers, score_multiplier)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [session.id, i, q.id, q.version, JSON.stringify(q.correct_answers), snapshot.multiplier],
        );
        questions.push(publicQuestion(q, i));
      }
    }

    return {
      session: {
        id: session.id,
        status: session.status,
        clientPlatform: session.client_platform,
        startedAt: session.started_at,
        game: mode.game_code,
        mode: mode.code,
        roundsPerSession: engine ? questionIds.length : mode.rounds_per_session,
        bestMetric: mode.best_metric,
        level: level ? { code: level.code, number: level.number, name: level.name } : null,
        scoring: snapshot ? { multiplier: snapshot.multiplier, engine: snapshot.engine } : null,
      },
      ...(engine && { questions }),
      abandonedSessions: abandoned.rowCount,
    };
  });
}

// Records the answer to one round of a question-engine session, scores it
// on the server and returns the result with the correct answer. Rounds are
// answered in order and exactly once.
export async function submitAnswer(pool, userId, rawSessionId, body = {}) {
  const id = sessionId(rawSessionId);
  const round = body.round;
  if (!Number.isInteger(round) || round < 0) throw new HttpError(422, 'invalid_answer', 'round must be a non-negative integer');

  return withTransaction(pool, async (db) => {
    const { rows } = await db.query(
      `SELECT s.id, s.status, s.started_at, s.score_multiplier, s.scoring_rules
         FROM game_sessions s WHERE s.id = $1 AND s.user_id = $2 FOR UPDATE`,
      [id, userId],
    );
    const session = rows[0];
    if (!session) throw new HttpError(404, 'session_not_found', 'Game session not found');
    if (session.status !== 'in_progress') throw new HttpError(409, 'session_closed', `Game session is already ${session.status}`);
    if (session.scoring_rules?.engine !== 'question_engine') {
      throw new HttpError(400, 'not_question_engine', 'This session is scored by its client; submit the result instead');
    }

    const { rows: roundRows } = await db.query(
      `SELECT a.id AS answer_id, a.round_index, a.question_id, a.correct_answers AS served_correct, a.answered_at,
              a.is_correct, a.points
         FROM game_answers a WHERE a.session_id = $1 ORDER BY a.round_index`,
      [id],
    );
    const target = roundRows.find((r) => r.round_index === round);
    if (!target) throw new HttpError(404, 'round_not_found', `Round ${round} does not exist in this session`);
    if (target.answered_at) throw new HttpError(409, 'round_already_answered', `Round ${round} is already answered`);
    const next = roundRows.find((r) => !r.answered_at);
    if (next.round_index !== round) throw new HttpError(409, 'round_out_of_order', `Answer round ${next.round_index} first`);

    const { rows: qs } = await db.query(
      `SELECT ${QUESTION_COLUMNS} FROM question_bank q ${QUESTION_JOINS} WHERE q.id = $1`,
      [target.question_id],
    );
    // Score against what was served, even if the question changed since.
    const question = { ...qs[0], correct_answers: target.served_correct };
    const evaluation = evaluateAnswer({ ...question, multi: isMulti(question) }, body.answer);

    const answered = roundRows.filter((r) => r.answered_at);
    let streakBefore = 0;
    for (let i = answered.length - 1; i >= 0 && answered[i].is_correct; i--) streakBefore++;
    const previousAt = answered.length ? answered[answered.length - 1].answered_at : session.started_at;

    const scored = scoreAnswer({
      fraction: evaluation.fraction,
      basePoints: question.base_points,
      streakBefore,
      multiplier: toMultiplier(session.score_multiplier),
      rules: session.scoring_rules.scoring,
    });

    const updated = await db.query(
      `UPDATE game_answers
          SET answered_at = now(), answer = $2, fraction = $3, is_correct = $4, base_points = $5, streak_bonus = $6,
              points = $7, response_ms = least(greatest(extract(epoch FROM (now() - $8::timestamptz)) * 1000, 0), 2147483647)::int
        WHERE id = $1 AND answered_at IS NULL
        RETURNING response_ms`,
      [target.answer_id, evaluation.answer, evaluation.fraction.toFixed(4), evaluation.isCorrect,
        scored.basePoints, scored.streakBonus, scored.points, previousAt],
    );
    if (!updated.rowCount) throw new HttpError(409, 'round_already_answered', `Round ${round} is already answered`);

    const score = answered.reduce((sum, r) => sum + r.points, 0) + scored.points;
    return {
      round,
      isCorrect: evaluation.isCorrect,
      fraction: evaluation.fraction,
      basePoints: scored.basePoints,
      streakBonus: scored.streakBonus,
      multiplier: toMultiplier(session.score_multiplier),
      points: scored.points,
      streak: scored.streak,
      score,
      answeredRounds: answered.length + 1,
      totalRounds: roundRows.length,
      responseMs: updated.rows[0].response_ms,
      ...reveal(question),
    };
  });
}

// Highest streak bonus total reachable with `correct` correct answers.
function maxStreakBonus(correct, step, cap) {
  let bonus = 0;
  for (let k = 1; k <= correct; k++) bonus += Math.min(cap, (k - 1) * step);
  return bonus;
}

// Checks a submitted result of a client-run game against the mode's rules in
// game_modes.config. The frontend runs the game; this only rejects
// impossible results. `score` here is the BASE score (before the multiplier).
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

  const details = validDetails(body.details);

  // Modes that award XP describe it as "round(score / 10)".
  const xpEarned = mode.config?.xp ? Math.round(score / 10) : null;

  return { score, correctCount, totalRounds, stars, bestStreak, xpEarned, details };
}

function validDetails(details) {
  if (details === undefined || details === null) return null;
  if (typeof details !== 'object' || Array.isArray(details)) {
    throw new HttpError(422, 'invalid_result', 'details must be an object');
  }
  if (Buffer.byteLength(JSON.stringify(details)) > MAX_DETAILS_BYTES) {
    throw new HttpError(422, 'invalid_result', 'details is too large');
  }
  return details;
}

// Result of a question-engine session, computed only from its scored rounds.
async function engineResult(db, sessionId) {
  const { rows } = await db.query(
    `SELECT a.round_index, a.answered_at, a.is_correct, a.base_points, a.streak_bonus, a.points, q.code
       FROM game_answers a JOIN question_bank q ON q.id = a.question_id
      WHERE a.session_id = $1 ORDER BY a.round_index`,
    [sessionId],
  );
  const open = rows.filter((r) => !r.answered_at).map((r) => r.round_index);
  if (open.length) throw new HttpError(409, 'rounds_unanswered', `Rounds ${open.join(', ')} are not answered yet`);
  const t = sessionTotals(rows.map((r) => ({ points: r.points, basePoints: r.base_points, streakBonus: r.streak_bonus, isCorrect: r.is_correct })));
  return {
    score: t.score,
    baseScore: t.baseScore,
    correctCount: t.correctCount,
    totalRounds: t.totalRounds,
    stars: null,
    bestStreak: t.bestStreak,
    xpEarned: null,
    details: { rounds: rows.map((r) => ({ q: r.code, correct: r.is_correct, points: r.points })) },
  };
}

const BEST_COLUMN = { score: 'score', correct_count: 'correct_count', stars: 'stars' };

// Records a finished game: completes the session, inserts its result and the
// outbox event in one transaction, then reports level progress.
export async function completeSession(pool, userId, rawSessionId, body) {
  const id = sessionId(rawSessionId);

  return withTransaction(pool, async (db) => {
    const { rows } = await db.query(
      `SELECT s.id, s.status, s.game_mode_id, s.level_id, s.score_multiplier, s.scoring_rules,
              gm.code AS mode_code, gm.rounds_per_session, gm.best_metric, gm.config,
              g.code AS game_code, l.code AS level_code, l.number AS level_number
         FROM game_sessions s
         JOIN game_modes gm ON gm.id = s.game_mode_id
         JOIN games g ON g.id = gm.game_id
         LEFT JOIN game_levels l ON l.id = s.level_id
        WHERE s.id = $1 AND s.user_id = $2
          FOR UPDATE OF s`,
      [id, userId],
    );
    const session = rows[0];
    if (!session) throw new HttpError(404, 'session_not_found', 'Game session not found');
    if (session.status !== 'in_progress') {
      throw new HttpError(409, 'session_closed', `Game session is already ${session.status}`);
    }

    // Score: computed by the engine, or validated client base × multiplier.
    // Sessions started before v2.0.0 have no multiplier and keep v1 values.
    let result;
    if (session.scoring_rules?.engine === 'question_engine') {
      result = await engineResult(db, id);
    } else {
      const base = validateResult(session, body);
      const hasMultiplier = session.score_multiplier !== null;
      result = {
        ...base,
        score: hasMultiplier ? applyMultiplier(base.score, session.score_multiplier) : base.score,
        baseScore: hasMultiplier ? base.score : null,
      };
    }
    const multiplier = session.score_multiplier === null ? null : toMultiplier(session.score_multiplier);
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
          stars, best_streak, xp_earned, duration_ms, details, base_score, score_multiplier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, score, correct_count, total_rounds, stars, best_streak,
                 xp_earned, duration_ms, completed_at, base_score`,
      [id, userId, session.game_mode_id, result.score, result.correctCount, result.totalRounds,
        result.stars, result.bestStreak, result.xpEarned, ended.rows[0].duration_ms, result.details,
        result.baseScore, multiplier],
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
        level: session.level_code,
        score: row.score,
        baseScore: row.base_score,
        scoreMultiplier: multiplier,
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
    const progress = session.level_id ? await progressAfterResult(db, userId, session.level_id) : null;

    return {
      result: {
        id: row.id,
        sessionId: id,
        score: row.score,
        baseScore: row.base_score,
        scoreMultiplier: multiplier,
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
      ...(progress && { level: progress.level, unlocked: progress.newlyUnlocked }),
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
