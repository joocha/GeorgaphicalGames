// Scoring: pure functions, no I/O. Documentation: docs/SCORING_AND_PROGRESSION.md
//
//   base answer score  = round(question base points × pointScale × fraction)
//                        + streak bonus (fully correct answers only)
//   streak bonus       = min(cap, (streak − 1) × perStep)       (Atlas Quest rule)
//   final answer score = round(base answer score × level multiplier)
//
// The multiplier is applied once, after the base score. It always comes from
// the session's scoring snapshot (game_sessions.score_multiplier), never from
// the client.
//
// Scale versions (game_sessions.scoring_rules.version → game_results.scoring_version):
//   1 (or NULL): the original scale, 100 points per correct answer.
//   2:           v2.1.0 recalibration, 10 per answer (Level 1 Hard: 20).
// Results are never rewritten; totals and bests read old ones through
// progressScore(), which divides them by LEGACY_SCORE_DIVISOR.

export const SCORING_VERSION = 2;
export const LEGACY_SCORE_DIVISOR = 10;

export const DEFAULT_SCORING = Object.freeze({
  basePointsDefault: 100,
  // Question base points are authored on the original scale (100); the
  // scale turns them into 10 without editing or re-importing content.
  pointScale: 0.1,
  streakBonusPerStep: 1,
  streakBonusCap: 5,
  partial: 'hits_minus_false_picks',
  streakNeedsFullyCorrect: true,
  timeBonus: null,
});

export function toMultiplier(value) {
  const m = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(m) || m <= 0) throw new Error(`invalid score multiplier ${value}`);
  return m;
}

// Applies the level multiplier to a base score. Integer result.
export function applyMultiplier(baseScore, multiplier) {
  return Math.round(baseScore * toMultiplier(multiplier));
}

// Bonus for the `streak`-th consecutive correct answer (streak >= 1).
export function streakBonus(streak, rules = DEFAULT_SCORING) {
  if (streak < 1) return 0;
  return Math.min(rules.streakBonusCap ?? 0, (streak - 1) * (rules.streakBonusPerStep ?? 0));
}

// Scores one answer.
//   fraction:     0..1 share of the answer that was right
//   streakBefore: consecutive fully correct answers before this one
// Returns {basePoints, streakBonus, points, streak} where `streak` is the
// streak after this answer and `points` the final, multiplied score.
export function scoreAnswer({ fraction, basePoints, streakBefore, multiplier, rules = DEFAULT_SCORING }) {
  if (!(fraction >= 0 && fraction <= 1)) throw new Error(`fraction out of range: ${fraction}`);
  const full = fraction === 1;
  const streak = full ? streakBefore + 1 : (rules.streakNeedsFullyCorrect === false && fraction > 0 ? streakBefore + 1 : 0);
  // Snapshots written before v2.1.0 have no pointScale and keep scale 1.
  const base = Math.round(basePoints * (rules.pointScale ?? 1) * fraction);
  const bonus = full ? streakBonus(streak, rules) : 0;
  return {
    basePoints: base,
    streakBonus: bonus,
    points: applyMultiplier(base + bonus, multiplier),
    streak,
  };
}

// Totals for a finished question-engine session from its answered rounds,
// in round order. Unanswered rounds count as wrong (0 points).
export function sessionTotals(rounds) {
  let score = 0;
  let baseScore = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  for (const r of rounds) {
    if (r.points == null) { streak = 0; continue; }
    score += r.points;
    baseScore += r.basePoints + r.streakBonus;
    if (r.isCorrect) {
      correct += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
  }
  return { score, baseScore, correctCount: correct, bestStreak, totalRounds: rounds.length };
}

// A result's score on the current scale, for totals, bests and thresholds.
// Mirrors progressScoreSql() in services/progression.js.
export function progressScore(score, scoringVersion) {
  return scoringVersion >= SCORING_VERSION ? score : Math.round(score / LEGACY_SCORE_DIVISOR);
}

// Points shown to players before they play (intro screens, Level 1 client):
// per correct answer, streak step and cap, maximum per game if fixed.
export function pointsSummary(config) {
  const s = config?.scoring || {};
  if (config?.engine === 'question_engine') {
    const rules = { ...DEFAULT_SCORING, ...s };
    return {
      correct: Math.round(rules.basePointsDefault * (rules.pointScale ?? 1)),
      streakBonusPerStep: rules.streakBonusPerStep,
      streakBonusCap: rules.streakBonusCap,
      maxScore: null,
    };
  }
  if (!Number.isInteger(s.correctBase)) return null;
  return {
    correct: s.correctBase,
    streakBonusPerStep: s.streakBonusPerStep ?? 0,
    streakBonusCap: s.streakBonusCap ?? 0,
    maxScore: s.maxScore ?? null,
  };
}

// Snapshot stored in game_sessions.scoring_rules when a session starts.
export function scoringSnapshot({ level, mode }) {
  const engine = mode.config?.engine === 'question_engine';
  return {
    version: SCORING_VERSION,
    level: level ? { code: level.code, number: level.number } : null,
    multiplier: Number(level ? level.score_multiplier : 1),
    engine: engine ? 'question_engine' : 'client_validated',
    // Client-run games (Level 1) keep the rules of game_modes.config.scoring;
    // the backend validates the base score against them, then multiplies.
    scoring: engine ? { ...DEFAULT_SCORING, ...(mode.config?.scoring || {}) } : (mode.config?.scoring || {}),
  };
}
