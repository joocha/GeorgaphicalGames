// Player statistics, all derived from immutable history (game_results,
// game_answers); nothing here is stored separately, so it can't drift.
// Documentation: docs/API_REFERENCE.md (GET /api/me/stats).
import { getLevelsOverview } from './levels.js';

export async function getPlayerStats(db, userId) {
  const { rows: [totals] } = await db.query(
    `SELECT count(*)::int AS games_played,
            coalesce(sum(score), 0)::bigint AS total_points,
            coalesce(sum(correct_count), 0)::int AS correct_answers,
            coalesce(sum(total_rounds - correct_count), 0)::int AS incorrect_answers,
            max(completed_at) AS last_played_at
       FROM game_results WHERE user_id = $1`,
    [userId],
  );
  const { rows: [timing] } = await db.query(
    `SELECT round(avg(a.response_ms))::int AS avg_response_ms, count(*)::int AS answered
       FROM game_answers a JOIN game_sessions s ON s.id = a.session_id
      WHERE s.user_id = $1 AND a.answered_at IS NOT NULL`,
    [userId],
  );
  const { rows: categories } = await db.query(
    `SELECT l.code AS level, q.category,
            count(*)::int AS answered,
            count(*) FILTER (WHERE a.is_correct)::int AS correct,
            count(DISTINCT q.id) FILTER (WHERE a.is_correct)::int AS mastered,
            (SELECT count(*)::int FROM question_bank q2
              WHERE q2.level_id = q.level_id AND q2.category = q.category
                AND q2.verification_status = 'verified' AND q2.is_active) AS available
       FROM game_answers a
       JOIN game_sessions s ON s.id = a.session_id
       JOIN question_bank q ON q.id = a.question_id
       JOIN game_levels l ON l.id = q.level_id
      WHERE s.user_id = $1 AND a.answered_at IS NOT NULL
      GROUP BY l.code, l.number, q.level_id, q.category
      ORDER BY l.number, q.category`,
    [userId],
  );
  const { levels, player } = await getLevelsOverview(db, userId);

  const answered = totals.correct_answers + totals.incorrect_answers;
  return {
    totals: {
      gamesPlayed: totals.games_played,
      // Lifetime score on the current scale (older results ÷10): the value
      // shown next to the player's name and used for unlock thresholds.
      totalScore: player.totalScore,
      level: player.level,
      // Raw sum of game_results.score as stored (mixes old and new scale);
      // kept for compatibility.
      totalPoints: Number(totals.total_points),
      correctAnswers: totals.correct_answers,
      incorrectAnswers: totals.incorrect_answers,
      accuracy: answered ? Math.round((totals.correct_answers / answered) * 1000) / 10 : null,
      averageResponseMs: timing.avg_response_ms,
      lastPlayedAt: totals.last_played_at,
      unlockedLevels: levels.filter((l) => l.unlocked).map((l) => l.number),
      completedLevels: levels.filter((l) => l.completed).map((l) => l.number),
    },
    levels: levels.map((l) => ({
      number: l.number, code: l.code, gamesPlayed: l.progress.plays, best: l.best, accuracy: l.progress.accuracy,
      completed: l.completed, unlocked: l.unlocked, mastery: l.progress.mastery,
    })),
    categories: categories.map((c) => ({
      level: c.level, category: c.category, answered: c.answered, correct: c.correct,
      accuracy: Math.round((c.correct / c.answered) * 1000) / 10,
      mastered: c.mastered, available: c.available,
      // A category is complete when every published question in it has been answered correctly once.
      completed: c.available > 0 && c.mastered >= c.available,
    })),
  };
}
