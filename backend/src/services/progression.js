// Cumulative score and the player's level (user_profiles.level).
// Documentation: docs/SCORING_AND_PROGRESSION.md ("Level progression").
//
// game_results is the only source of scores. Results recorded on the
// original scale (scoring_version NULL or 1) count as round(score / 10), so
// old and new results add up on one scale without rewriting history.
import { SCORING_VERSION, LEGACY_SCORE_DIVISOR } from '../engine/scoring.js';

// SQL for one result's score on the current scale. `r` is the alias of
// game_results in the query. Mirrors progressScore() in engine/scoring.js.
export const progressScoreSql = (r = 'r') =>
  `(CASE WHEN ${r}.scoring_version >= ${SCORING_VERSION} THEN ${r}.score
         ELSE round(${r}.score / ${LEGACY_SCORE_DIVISOR}.0)::int END)`;

// Lifetime totals of one player, always filtered by the authenticated
// user's id (never a client-provided one).
export async function scoreTotals(db, userId) {
  const { rows: [t] } = await db.query(
    `SELECT coalesce(sum(${progressScoreSql('r')}), 0)::bigint AS total_score,
            count(*)::int AS games_played
       FROM game_results r WHERE r.user_id = $1`,
    [userId],
  );
  return { totalScore: Number(t.total_score), gamesPlayed: t.games_played };
}

// Locks the player's profile row for the rest of the transaction. Taken
// before totals are read, so two games finishing at the same time are
// evaluated one after the other and the second sees the first's result.
export async function lockProfileLevel(db, userId) {
  const { rows } = await db.query(
    `SELECT level FROM user_profiles WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  return rows[0]?.level ?? 1;
}

// Raises user_profiles.level to `level` if it is higher; never lowers it
// (also enforced by the user_profiles_level_never_decreases trigger).
export async function raiseProfileLevel(db, userId, level) {
  await db.query(
    `UPDATE user_profiles SET level = $2, updated_at = now() WHERE user_id = $1 AND level < $2`,
    [userId, level],
  );
}

// Highest N such that levels 1..N are all unlocked. A single level granted
// out of order (admin) doesn't raise it, so it never opens the levels below.
// Capped at the highest existing level: thresholds for levels that don't
// exist yet (Level 6) raise nothing until that level is added.
export function contiguousLevel(levels) {
  const open = new Set(levels.filter((l) => l.unlocked).map((l) => l.number));
  let n = 1;
  while (open.has(n + 1)) n++;
  return n;
}

// Score and level shown next to the player's name.
export async function playerSummary(db, userId) {
  const [totals, { rows }] = await Promise.all([
    scoreTotals(db, userId),
    db.query(`SELECT level FROM user_profiles WHERE user_id = $1`, [userId]),
  ]);
  return { ...totals, level: rows[0]?.level ?? 1 };
}
