// Levels and progression. All rules live in game_levels (database), are
// evaluated here, on the backend, and are never hard-coded in the frontend.
// Documentation: docs/SCORING_AND_PROGRESSION.md
//
// Completion: a level is completed once the player has at least
//   completion_rule.minCompletedSessions results in the level's modes with
//   score >= minScore and correct_count / total_rounds >= minAccuracy.
//   Results are immutable history, so completion can't be lost.
//
// Unlocking (unlock_rule), evaluated against the player's progress:
//   {"type":"always"}
//   {"type":"total_score","min":S}   lifetime score (all results, current scale) >= S
//   {"type":"level_completed","level":N}
//   {"type":"level_best_score","level":N,"min":S}
//   {"type":"level_sessions","level":N,"min":K}
//   {"type":"all","rules":[...]}  /  {"type":"any","rules":[...]}
//   {"type":"admin_only"}         (only user_level_unlocks rows unlock it)
// A level unlocked by its rule is recorded in user_level_unlocks (source
// 'rule') the first time, so a later, stricter rule never locks it again.
// Administrators can grant a level with source 'admin' (scripts/admin-unlock.js).
//
// user_profiles.level (v2.1) is the highest N with levels 1..N unlocked. It
// is raised here, in the same transaction as the result that earned it, and
// also counts as an unlock: every level up to it stays open for good.
import { HttpError } from '../http-error.js';
import { pointsSummary } from '../engine/scoring.js';
import {
  progressScoreSql, scoreTotals, lockProfileLevel, raiseProfileLevel, contiguousLevel,
} from './progression.js';

const levelName = (levels, number) => levels.find((l) => l.number === number);
const fmt = (n) => Number(n).toLocaleString('en-US');

// `progress`: Map level number → {completed, best, plays};
// `totals`:   {totalScore} of the player (scoreTotals()).
export function evaluateUnlockRule(rule, progress, totals = {}) {
  switch (rule?.type) {
    case 'always': return true;
    case 'total_score': return (totals.totalScore ?? 0) >= rule.min;
    case 'level_completed': return !!progress.get(rule.level)?.completed;
    case 'level_best_score': return (progress.get(rule.level)?.best ?? -1) >= rule.min;
    case 'level_sessions': return (progress.get(rule.level)?.plays ?? 0) >= rule.min;
    case 'all': return (rule.rules || []).every((r) => evaluateUnlockRule(r, progress, totals));
    case 'any': return (rule.rules || []).some((r) => evaluateUnlockRule(r, progress, totals));
    case 'admin_only': return false;
    default: return false;
  }
}

// Human-readable unlock condition for the level card.
export function describeUnlockRule(rule, levels) {
  const name = (n) => { const l = levelName(levels, n); return l ? `Level ${n} · ${l.name}` : `Level ${n}`; };
  switch (rule?.type) {
    case 'always': return 'Unlocked from the start';
    case 'total_score': return `Reach ${fmt(rule.min)} total points to unlock`;
    case 'level_completed': return `Complete ${name(rule.level)} to unlock`;
    case 'level_best_score': return `Score ${fmt(rule.min)}+ in ${name(rule.level)} to unlock`;
    case 'level_sessions': return `Play ${name(rule.level)} ${rule.min} times to unlock`;
    case 'all': return (rule.rules || []).map((r) => describeUnlockRule(r, levels)).join(' and ');
    case 'any': return (rule.rules || []).map((r) => describeUnlockRule(r, levels)).join(' or ');
    case 'admin_only': return 'Unlocked by invitation';
    default: return 'Locked';
  }
}

export async function loadLevels(db, { activeOnly = true } = {}) {
  const { rows } = await db.query(
    `SELECT id, number, code, name, short_description, description, icon, score_multiplier::float8 AS score_multiplier,
            categories, unlock_rule, completion_rule, session_config, is_active, sort_order
       FROM game_levels ${activeOnly ? 'WHERE is_active' : ''} ORDER BY number`,
  );
  return rows;
}

// Per-level progress of one player: plays, best, completion, mastery.
async function levelProgress(db, userId, levels) {
  const { rows } = await db.query(
    `SELECT l.id AS level_id,
            count(r.id)::int AS plays,
            max(${progressScoreSql('r')}) AS best,
            count(r.id) FILTER (
              WHERE ${progressScoreSql('r')} >= coalesce((l.completion_rule->>'minScore')::int, 0)
                AND r.correct_count::numeric / r.total_rounds >= coalesce((l.completion_rule->>'minAccuracy')::numeric, 0)
            )::int AS qualifying,
            max(r.completed_at) AS last_played_at,
            coalesce(sum(r.correct_count), 0)::int AS correct,
            coalesce(sum(r.total_rounds), 0)::int AS rounds
       FROM game_levels l
       LEFT JOIN game_modes gm ON gm.level_id = l.id
       LEFT JOIN game_results r ON r.game_mode_id = gm.id AND r.user_id = $1
      GROUP BY l.id`,
    [userId],
  );
  // Mastery: distinct verified questions of the level answered fully correctly.
  const mastery = await db.query(
    `SELECT q.level_id,
            count(*) FILTER (WHERE q.verification_status = 'verified' AND q.is_active)::int AS total,
            count(*) FILTER (WHERE q.verification_status = 'verified' AND q.is_active AND EXISTS (
              SELECT 1 FROM game_answers a JOIN game_sessions s ON s.id = a.session_id
               WHERE a.question_id = q.id AND s.user_id = $1 AND a.is_correct)
            )::int AS mastered
       FROM question_bank q GROUP BY q.level_id`,
    [userId],
  );
  const masteryBy = new Map(mastery.rows.map((m) => [m.level_id, m]));
  const byNumber = new Map();
  for (const l of levels) {
    const p = rows.find((r) => r.level_id === l.id) || { plays: 0, best: null, qualifying: 0, correct: 0, rounds: 0 };
    const required = l.completion_rule?.minCompletedSessions ?? 1;
    const m = masteryBy.get(l.id);
    byNumber.set(l.number, {
      plays: p.plays,
      best: p.best,
      lastPlayedAt: p.last_played_at ?? null,
      completedSessions: p.qualifying,
      requiredSessions: required,
      completed: p.qualifying >= required,
      accuracy: p.rounds ? Math.round((p.correct / p.rounds) * 1000) / 10 : null,
      mastery: m && m.total ? { mastered: m.mastered, total: m.total } : null,
    });
  }
  return byNumber;
}

// Records rule-based unlocks that are not stored yet (sticky) and emits a
// level.unlocked outbox event for each. Returns the newly unlocked levels.
async function persistRuleUnlocks(db, userId, levels, progress, totals, stored) {
  const fresh = [];
  for (const l of levels) {
    if (stored.has(l.id) || !evaluateUnlockRule(l.unlock_rule, progress, totals)) continue;
    const { rowCount } = await db.query(
      `INSERT INTO user_level_unlocks (user_id, level_id, source) VALUES ($1, $2, 'rule')
       ON CONFLICT (user_id, level_id) DO NOTHING`,
      [userId, l.id],
    );
    stored.set(l.id, { source: 'rule', unlocked_at: new Date() });
    if (!rowCount) continue;
    // Level 1 is always open; only real unlocks are worth an event.
    if (l.unlock_rule?.type !== 'always') {
      fresh.push({ code: l.code, number: l.number, name: l.name });
      await db.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('user', $1, 'level.unlocked', $2)`,
        [userId, { userId, level: l.code, levelNumber: l.number, source: 'rule' }],
      );
    }
  }
  return fresh;
}

// The player's view of every level. Also persists new rule-based unlocks
// and raises user_profiles.level. Call it inside a transaction.
export async function getLevelsOverview(db, userId) {
  const profileLevel = await lockProfileLevel(db, userId);
  const levels = await loadLevels(db);
  const progress = await levelProgress(db, userId, levels);
  const totals = await scoreTotals(db, userId);
  const { rows: unlockRows } = await db.query(
    `SELECT level_id, source, unlocked_at FROM user_level_unlocks WHERE user_id = $1`,
    [userId],
  );
  const stored = new Map(unlockRows.map((u) => [u.level_id, u]));
  const newlyUnlocked = await persistRuleUnlocks(db, userId, levels, progress, totals, stored);

  const { rows: modes } = await db.query(
    `SELECT gm.level_id, g.code AS game, gm.code, gm.name, gm.difficulty, gm.rounds_per_session, gm.config,
            max(${progressScoreSql('r')}) FILTER (WHERE r.user_id = $1) AS best,
            count(r.id) FILTER (WHERE r.user_id = $1)::int AS plays
       FROM game_modes gm
       JOIN games g ON g.id = gm.game_id
       LEFT JOIN game_results r ON r.game_mode_id = gm.id AND r.user_id = $1
      WHERE gm.level_id IS NOT NULL AND gm.is_active AND g.is_active
      GROUP BY gm.id, g.code
      ORDER BY gm.sort_order`,
    [userId],
  );
  const { rows: catCounts } = await db.query(
    `SELECT level_id, c AS category, count(*)::int AS n
       FROM question_bank, LATERAL (VALUES (category), (subcategory)) AS v(c)
      WHERE verification_status = 'verified' AND is_active AND c IS NOT NULL
      GROUP BY level_id, c`,
  );

  const list = levels.map((l) => {
    const p = progress.get(l.number);
    const unlock = stored.get(l.id);
    const unlocked = !!unlock || l.number <= profileLevel || evaluateUnlockRule(l.unlock_rule, progress, totals);
    const levelModes = modes.filter((m) => m.level_id === l.id);
    const engine = levelModes.some((m) => m.config?.engine === 'question_engine');
    return {
      number: l.number,
      code: l.code,
      name: l.name,
      shortDescription: l.short_description,
      description: l.description,
      icon: l.icon,
      multiplier: l.score_multiplier,
      categories: l.categories.map((c) => ({
        ...c,
        questions: engine ? (catCounts.find((x) => x.level_id === l.id && x.category === c.code)?.n ?? 0) : null,
      })),
      rounds: l.session_config?.defaultRounds ?? 10,
      engine: engine ? 'question_engine' : 'client',
      modes: levelModes.map((m) => ({
        game: m.game, code: m.code, name: m.name, difficulty: m.difficulty, rounds: m.rounds_per_session, best: m.best, plays: m.plays,
        points: pointsSummary(m.config),
      })),
      unlocked,
      unlockSource: unlock?.source ?? (unlocked ? 'rule' : null),
      unlockHint: describeUnlockRule(l.unlock_rule, levels),
      // Progress towards a score threshold, for the locked card.
      unlockProgress: l.unlock_rule?.type === 'total_score'
        ? { score: totals.totalScore, required: l.unlock_rule.min }
        : null,
      completed: p.completed,
      progress: p,
      best: p.best,
    };
  });
  const level = Math.max(profileLevel, contiguousLevel(list));
  if (level > profileLevel) await raiseProfileLevel(db, userId, level);
  return { levels: list, newlyUnlocked, player: { ...totals, level } };
}

// Throws 403 unless the player may play the level.
export async function assertLevelUnlocked(db, userId, level) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM user_level_unlocks WHERE user_id = $1 AND level_id = $2) AS granted,
            (SELECT level FROM user_profiles WHERE user_id = $1) AS profile_level`,
    [userId, level.id],
  );
  if (rows[0].granted || level.number <= (rows[0].profile_level ?? 1)) return;
  const levels = await loadLevels(db);
  const progress = await levelProgress(db, userId, levels);
  if (evaluateUnlockRule(level.unlock_rule, progress, await scoreTotals(db, userId))) return;
  throw new HttpError(403, 'level_locked', describeUnlockRule(level.unlock_rule, levels));
}

// After a result is recorded: completion state of its level and any levels
// that became unlocked.
export async function progressAfterResult(db, userId, levelId) {
  const { levels, newlyUnlocked, player } = await getLevelsOverview(db, userId);
  const { rows } = await db.query(`SELECT number FROM game_levels WHERE id = $1`, [levelId]);
  const current = levels.find((l) => l.number === rows[0]?.number);
  return {
    level: current ? { code: current.code, number: current.number, completed: current.completed, best: current.best, progress: current.progress } : null,
    newlyUnlocked,
    player,
  };
}
