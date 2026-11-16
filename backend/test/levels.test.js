// End-to-end tests of the five-level platform against the real migrations
// and the seed content: level selection, unlocking, multipliers, the
// question engine, duplicate protection, statistics, the internal (n8n) API
// and compatibility with pre-v2 history.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness, applyMigrations, correctAnswerFor, initDataFor, INTERNAL_TOKEN,
} from './helpers.js';
import { buildContent, loadContentFiles } from '../src/content/build.js';
import { importContent } from '../src/content/import.js';

const PLAYER = { id: 700000001, first_name: 'Ana' };
const OTHER = { id: 700000002, first_name: 'Levan' };

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });

// Plays a whole question-engine session; `answerFor(round, question)` returns
// the answer body or null for "the correct answer".
async function playEngineSession(token, level, answerFor = () => null) {
  const start = await h.call('POST', '/sessions', { token, body: { level, clientPlatform: 'telegram' } });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const sid = start.body.session.id;
  const answers = [];
  for (const q of start.body.questions) {
    const answer = answerFor(q.round, q) ?? await correctAnswerFor(h.db, sid, q.round);
    const res = await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: q.round, answer } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    answers.push(res.body);
  }
  const done = await h.call('POST', `/sessions/${sid}/complete`, { token, body: {} });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  return { start: start.body, answers, done: done.body, sid };
}

describe('levels', () => {
  let token;
  before(async () => { ({ token } = await h.login(PLAYER)); });

  test('content import seeds levels 2-5 with questions', () => {
    assert.ok(h.importSummary.questions.inserted >= 70);
    assert.equal(h.importSummary.questions.updated, 0);
  });

  test('all five levels are listed; only level 1 is unlocked at first', async () => {
    const res = await h.call('GET', '/levels', { token });
    assert.equal(res.status, 200);
    const levels = res.body.levels;
    assert.deepEqual(levels.map((l) => [l.number, l.code, l.multiplier]),
      [[1, 'atlas', 1], [2, 'hydro', 2], [3, 'earth', 3], [4, 'resources', 4], [5, 'master', 5]]);
    assert.deepEqual(levels.map((l) => l.unlocked), [true, false, false, false, false]);
    assert.equal(levels[1].unlockHint, 'Complete Level 1 · Atlas Explorer to unlock');
    assert.deepEqual(levels[0].modes.map((m) => m.code), ['easy', 'hard']);
    assert.equal(levels[0].engine, 'client');
    assert.equal(levels[1].engine, 'question_engine');
    assert.ok(levels[1].categories.find((c) => c.code === 'rivers').questions > 0);
    for (const l of levels) {
      assert.ok(l.name && l.description && l.icon && l.rounds === 10);
      assert.equal(l.best, null);
      assert.equal(l.completed, false);
    }
  });

  test('levels need a valid token', async () => {
    assert.equal((await h.call('GET', '/levels')).status, 401);
  });

  test('a locked level cannot be started', async () => {
    const res = await h.call('POST', '/sessions', { token, body: { level: 'hydro' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'level_locked');
  });

  test('level 1 keeps the Atlas Quest flow, scores 1x and unlocks level 2', async () => {
    const start = await h.call('POST', '/sessions', { token, body: { game: 'telegram_country_quiz', mode: 'hard', clientPlatform: 'telegram' } });
    assert.equal(start.status, 201);
    assert.deepEqual(start.body.session.level, { code: 'atlas', number: 1, name: 'Atlas Explorer' });
    assert.deepEqual(start.body.session.scoring, { multiplier: 1, engine: 'client_validated' });
    assert.equal(start.body.questions, undefined);

    // A multiplier sent by the client is ignored.
    const done = await h.call('POST', `/sessions/${start.body.session.id}/complete`, {
      token, body: { score: 760, correctCount: 7, bestStreak: 4, multiplier: 5, scoreMultiplier: 5 },
    });
    assert.equal(done.status, 201);
    assert.equal(done.body.result.score, 760);
    assert.equal(done.body.result.baseScore, 760);
    assert.equal(done.body.result.scoreMultiplier, 1);
    assert.equal(done.body.level.completed, true);
    assert.deepEqual(done.body.unlocked.map((u) => u.code), ['hydro']);

    const levels = (await h.call('GET', '/levels', { token })).body.levels;
    assert.equal(levels[0].best, 760);
    assert.equal(levels[0].modes.find((m) => m.code === 'hard').best, 760);
    assert.deepEqual(levels.map((l) => l.unlocked), [true, true, false, false, false]);
  });

  test('question-engine sessions serve questions without their answers', async () => {
    const start = await h.call('POST', '/sessions', { token, body: { level: 'hydro' } });
    assert.equal(start.status, 201);
    assert.equal(start.body.questions.length, 10);
    assert.equal(start.body.session.roundsPerSession, 10);
    assert.deepEqual(start.body.session.scoring, { multiplier: 2, engine: 'question_engine' });
    const text = JSON.stringify(start.body.questions);
    for (const forbidden of ['correct', 'explanation', 'correct_answers', 'fact']) assert.ok(!text.includes(`"${forbidden}`), forbidden);
    const codes = new Set();
    for (const q of start.body.questions) {
      assert.ok(q.text && q.type && q.answerMode);
      codes.add(q.text + JSON.stringify(q.options));
      if (q.answerMode === 'options') assert.ok(q.options.every((o) => o.id && o.label));
    }
    assert.equal(codes.size, 10, 'no question is served twice in a session');
    await h.call('POST', `/sessions/${start.body.session.id}/abandon`, { token });
  });

  test('rounds can only be answered once and in order', async () => {
    const start = await h.call('POST', '/sessions', { token, body: { level: 'hydro' } });
    const sid = start.body.session.id;
    const outOfOrder = await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: 1, answer: await correctAnswerFor(h.db, sid, 1) } });
    assert.equal(outOfOrder.status, 409);
    assert.equal(outOfOrder.body.code, 'round_out_of_order');

    const answer = await correctAnswerFor(h.db, sid, 0);
    const first = await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: 0, answer } });
    assert.equal(first.status, 201);
    assert.equal(first.body.isCorrect, true);
    assert.equal(first.body.points, 200);
    assert.ok(first.body.explanation);
    assert.ok(first.body.correct);

    const duplicate = await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: 0, answer } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'round_already_answered');
    const { rows } = await h.db.query(`SELECT count(*)::int AS n FROM game_answers WHERE session_id = $1 AND answered_at IS NOT NULL`, [sid]);
    assert.equal(rows[0].n, 1, 'a duplicate submission is never scored');

    assert.equal((await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: 99, answer } })).status, 404);
    assert.equal((await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: 1, answer: 'x' } })).status, 422);

    const early = await h.call('POST', `/sessions/${sid}/complete`, { token, body: { score: 99999, correctCount: 10 } });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'rounds_unanswered');
    await h.call('POST', `/sessions/${sid}/abandon`, { token });

    const closed = await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: 1, answer } });
    assert.equal(closed.status, 409);
    assert.equal(closed.body.code, 'session_closed');
  });

  test('another player cannot answer my session', async () => {
    const other = await h.login(OTHER);
    const start = await h.call('POST', '/sessions', { token, body: { level: 'hydro' } });
    const sid = start.body.session.id;
    const res = await h.call('POST', `/sessions/${sid}/answers`, { token: other.token, body: { round: 0, answer: await correctAnswerFor(h.db, sid, 0) } });
    assert.equal(res.status, 404);
    await h.call('POST', `/sessions/${sid}/abandon`, { token });
  });

  test('a perfect level-2 game scores 2 × 1350, ignores client scores and unlocks level 3', async () => {
    const { answers, done } = await playEngineSession(token, 'hydro');
    assert.deepEqual(answers.map((a) => a.points), [200, 220, 240, 260, 280, 300, 300, 300, 300, 300]);
    assert.equal(done.result.score, 2700);
    assert.equal(done.result.baseScore, 1350);
    assert.equal(done.result.scoreMultiplier, 2);
    assert.equal(done.result.correctCount, 10);
    assert.equal(done.result.bestStreak, 10);
    assert.deepEqual(done.unlocked.map((u) => u.code), ['earth']);
    const levels = (await h.call('GET', '/levels', { token })).body.levels;
    assert.equal(levels[1].best, 2700);
    assert.equal(levels[1].completed, true);
    assert.ok(levels[1].progress.mastery.mastered >= 10);
  });

  test('partial answers are scored proportionally on the server', async () => {
    const start = await h.call('POST', '/sessions', { token, body: { level: 'earth' } });
    assert.equal(start.status, 201);
    const sid = start.body.session.id;
    let partialSeen = false;
    for (const q of start.body.questions) {
      let answer = await correctAnswerFor(h.db, sid, q.round);
      if (!partialSeen && q.answerMode === 'map_multi' && answer.countries.length >= 2) {
        answer = { countries: answer.countries.slice(1) }; // miss one country
        const n = answer.countries.length + 1;
        const res = await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: q.round, answer } });
        assert.equal(res.body.isCorrect, false);
        assert.equal(res.body.fraction, (n - 1) / n);
        assert.equal(res.body.points, Math.round(100 * ((n - 1) / n)) * 3);
        assert.equal(res.body.streak, 0);
        partialSeen = true;
        continue;
      }
      await h.call('POST', `/sessions/${sid}/answers`, { token, body: { round: q.round, answer } });
    }
    const done = await h.call('POST', `/sessions/${sid}/complete`, { token });
    assert.equal(done.status, 201);
    if (partialSeen) assert.equal(done.body.result.correctCount, 9);
    assert.equal(done.body.result.scoreMultiplier, 3);
    assert.equal(done.body.result.score % 3, 0);
  });

  test('wrong answers score 0 and reveal the correct answer', async () => {
    await playEngineSession(token, 'resources', (round, q) => {
      if (round !== 0) return null;
      if (q.answerMode === 'options') return { optionIds: [q.options[0].id] };
      if (q.answerMode === 'pairs') return { pairs: [{ left: q.options.left[0].id, right: q.options.right[0].id }] };
      return { countries: ['Iceland'] };
    }).then(({ answers }) => {
      assert.ok(answers[0].correct);
      assert.ok(answers[0].explanation);
      if (answers[0].fraction === 0) assert.equal(answers[0].points, 0);
    });
  });

  test('statistics: totals, per level and per category', async () => {
    const res = await h.call('GET', '/me/stats', { token });
    assert.equal(res.status, 200);
    const s = res.body;
    assert.ok(s.totals.gamesPlayed >= 4);
    const { rows: [db] } = await h.db.query(
      `SELECT sum(r.correct_count)::int AS c, sum(r.total_rounds)::int AS t FROM game_results r
         JOIN auth_identities i ON i.user_id = r.user_id WHERE i.provider_user_id = $1`, [String(PLAYER.id)]);
    assert.equal(s.totals.correctAnswers, db.c);
    assert.equal(s.totals.correctAnswers + s.totals.incorrectAnswers, db.t);
    assert.ok(s.totals.accuracy > 0 && s.totals.accuracy <= 100);
    assert.ok(Number.isInteger(s.totals.averageResponseMs));
    assert.deepEqual(s.totals.unlockedLevels.slice(0, 3), [1, 2, 3]);
    assert.ok(s.totals.completedLevels.includes(2));
    assert.ok(s.categories.some((c) => c.level === 'hydro' && c.answered > 0));
    assert.equal(s.levels.find((l) => l.code === 'hydro').best, 2700);
  });

  test('unlocks are permanent even if a rule becomes stricter', async () => {
    await h.db.query(`UPDATE game_levels SET unlock_rule = '{"type":"level_best_score","level":1,"min":1350}' WHERE code = 'hydro'`);
    try {
      const levels = (await h.call('GET', '/levels', { token })).body.levels;
      assert.equal(levels[1].unlocked, true);
      // A new player is held to the new rule.
      const fresh = await h.login({ id: 700000003, first_name: 'Nika' });
      const theirs = (await h.call('GET', '/levels', { token: fresh.token })).body.levels;
      assert.equal(theirs[1].unlocked, false);
      assert.equal(theirs[1].unlockHint, 'Score 1350+ in Level 1 · Atlas Explorer to unlock');
    } finally {
      await h.db.query(`UPDATE game_levels SET unlock_rule = '{"type":"level_completed","level":1}' WHERE code = 'hydro'`);
    }
  });

  test('an administrator can unlock a level for one player', async () => {
    const p = await h.login({ id: 700000004, first_name: 'Mariam' });
    await h.db.query(
      `INSERT INTO user_level_unlocks (user_id, level_id, source, granted_by) SELECT $1, id, 'admin', 'test' FROM game_levels WHERE code = 'master'`,
      [p.userId],
    );
    const levels = (await h.call('GET', '/levels', { token: p.token })).body.levels;
    assert.deepEqual(levels.map((l) => l.unlocked), [true, false, false, false, true]);
    assert.equal(levels[4].unlockSource, 'admin');
    assert.equal((await h.call('POST', '/sessions', { token: p.token, body: { level: 'master' } })).status, 201);
  });

  test('session length is configurable per level, validated by the server', async () => {
    const bad = await h.call('POST', '/sessions', { token, body: { level: 'hydro', rounds: 50 } });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.code, 'invalid_rounds');
    await h.db.query(`UPDATE game_levels SET session_config = '{"defaultRounds":10,"allowedRounds":[10,20]}' WHERE code = 'hydro'`);
    try {
      const ok = await h.call('POST', '/sessions', { token, body: { level: 'hydro', rounds: 20 } });
      assert.equal(ok.status, 201);
      // Only 22 hydro questions exist; 20 are served, none twice.
      assert.equal(ok.body.questions.length, 20);
      await h.call('POST', `/sessions/${ok.body.session.id}/abandon`, { token });
    } finally {
      await h.db.query(`UPDATE game_levels SET session_config = '{"defaultRounds":10,"allowedRounds":[10]}' WHERE code = 'hydro'`);
    }
  });

  test('recently seen questions are avoided when possible', async () => {
    const a = await h.call('POST', '/sessions', { token, body: { level: 'master' } });
    const firstSet = new Set(a.body.questions.map((q) => q.text));
    await h.call('POST', `/sessions/${a.body.session.id}/abandon`, { token });
    const b = await h.call('POST', '/sessions', { token, body: { level: 'master' } });
    // 18 master questions: the second session repeats at most 2 of the first.
    const repeats = b.body.questions.filter((q) => firstSet.has(q.text)).length;
    assert.ok(repeats <= 2, `${repeats} repeats`);
    await h.call('POST', `/sessions/${b.body.session.id}/abandon`, { token });
  });
});

describe('database guarantees', () => {
  test('a scored round cannot be changed, and history is immutable', async () => {
    const { token } = await h.login({ id: 700000010, first_name: 'Test' });
    await h.db.query(`INSERT INTO user_level_unlocks (user_id, level_id, source) SELECT u.user_id, l.id, 'admin'
      FROM auth_identities u, game_levels l WHERE u.provider_user_id = '700000010' AND l.code = 'hydro'`);
    const { sid } = await playEngineSession(token, 'hydro');
    await assert.rejects(h.db.query(`UPDATE game_answers SET points = 9999 WHERE session_id = $1 AND round_index = 0`, [sid]), /already answered/);
    await assert.rejects(h.db.query(`UPDATE game_sessions SET score_multiplier = 5 WHERE id = $1`, [sid]), /cannot change/);
    await assert.rejects(h.db.query(`UPDATE game_results SET score = 1 WHERE session_id = $1`, [sid]), /immutable/);
  });

  test('re-importing unchanged content changes nothing; edits bump the version', async () => {
    const { content } = buildContent(loadContentFiles());
    const again = await importContent(h.pool, content);
    assert.equal(again.questions.updated, 0);
    assert.equal(again.questions.inserted, 0);
    const edited = structuredClone(content);
    const q = edited.questions.find((x) => x.code === 'hydro.caspian.largest');
    q.explanation += ' Edited.';
    q.contentHash = 'changed';
    const third = await importContent(h.pool, edited);
    assert.equal(third.questions.updated, 1);
    const { rows } = await h.db.query(`SELECT version FROM question_bank WHERE code = 'hydro.caspian.largest'`);
    assert.equal(rows[0].version, 2);
  });
});

describe('internal API (n8n)', () => {
  const auth = { token: INTERNAL_TOKEN };

  test('needs the internal token; a player token is not enough', async () => {
    const { token } = await h.login(PLAYER);
    assert.equal((await h.call('GET', '/internal/geo-objects/danube')).status, 401);
    assert.equal((await h.call('GET', '/internal/geo-objects/danube', { token })).status, 401);
  });

  test('returns verified facts only', async () => {
    const res = await h.call('GET', '/internal/geo-objects/danube', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.object.name, 'Danube');
    assert.equal(res.body.countries.filter((c) => c.relation === 'flows_through').length, 10);
    assert.deepEqual(res.body.links.map((l) => l.code), ['black_sea']);
    const lithium = await h.call('GET', '/internal/geo-objects/lithium', auth);
    assert.ok(lithium.body.stats.some((s) => s.metric === 'reserves' && s.country === 'Chile' && s.year === 2025));
    assert.equal((await h.call('GET', '/internal/geo-objects/atlantis', auth)).status, 404);
  });

  test('AI drafts are stored for review and never served', async () => {
    const draft = {
      code: 'ai.hydro.rhine.countries', category: 'rivers', type: 'GEO_RELATIONSHIP', difficulty: 2, source: 'wikidata',
      text: 'Select every country the Rhine flows through.',
      explanation: 'Switzerland, Liechtenstein, Austria, Germany, France and the Netherlands.',
      object: 'rhine', fact: { object: 'rhine', countries: 'flows_through' },
    };
    const res = await h.call('POST', '/internal/question-drafts', { ...auth, body: { level: 'hydro', question: draft, generator: { workflow: 'test' } } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.draft.verification_status, 'in_review');
    assert.equal(res.body.draft.factChecked, true);
    assert.equal((await h.call('POST', '/internal/question-drafts', { ...auth, body: { level: 'hydro', question: draft } })).status, 409);

    // Answers that contradict the knowledge base are refused.
    const wrong = await h.call('POST', '/internal/question-drafts', {
      ...auth, body: { level: 'hydro', question: { ...draft, code: 'ai.hydro.rhine.wrong', correct: ['Germany', 'Poland'] } },
    });
    assert.equal(wrong.status, 422);
    assert.match(wrong.body.error, /contradicts verified knowledge/);

    // Drafts are never selected for play.
    const { rows } = await h.db.query(`SELECT count(*)::int AS n FROM game_answers a JOIN question_bank q ON q.id = a.question_id WHERE q.origin = 'ai_generated'`);
    assert.equal(rows[0].n, 0);
    const { rows: [q] } = await h.db.query(`SELECT verification_status, origin FROM question_bank WHERE code = 'ai.hydro.rhine.countries'`);
    assert.deepEqual(q, { verification_status: 'in_review', origin: 'ai_generated' });
  });
});

// A database migrated with v1 only, holding a real v1 result, then upgraded.
describe('upgrade from v1 keeps history exactly', () => {
  let legacy;
  const TG = { id: 700000099, first_name: 'Veteran' };

  before(async () => {
    legacy = await startHarness({
      prepare: async (db) => {
        await applyMigrations(db, (n) => n < '20261117');
        await db.exec(`
          WITH u AS (INSERT INTO users DEFAULT VALUES RETURNING id),
               i AS (INSERT INTO auth_identities (user_id, provider, provider_user_id) SELECT id, 'telegram', '${TG.id}' FROM u RETURNING user_id),
               s AS (INSERT INTO game_sessions (user_id, game_mode_id, client_platform, status, started_at, ended_at)
                     SELECT i.user_id, gm.id, 'telegram', 'completed', now() - interval '2 days', now() - interval '2 days'
                       FROM i, game_modes gm JOIN games g ON g.id = gm.game_id
                      WHERE g.code = 'telegram_country_quiz' AND gm.code = 'easy' RETURNING id, user_id, game_mode_id)
          INSERT INTO game_results (session_id, user_id, game_mode_id, score, correct_count, total_rounds, best_streak)
          SELECT id, user_id, game_mode_id, 1110, 9, 10, 6 FROM s;`);
        await db.exec(`CREATE TABLE v1_snapshot AS SELECT * FROM game_results`);
        await applyMigrations(db, (n) => n >= '20261117');
      },
    });
  });
  after(async () => { await legacy.stop(); });

  test('v1 results are untouched by the migration', async () => {
    const { rows } = await legacy.db.query(`
      SELECT r.score, r.correct_count, r.base_score, r.score_multiplier, s.level_id, s.score_multiplier AS session_multiplier
        FROM game_results r JOIN game_sessions s ON s.id = r.session_id`);
    assert.deepEqual(rows, [{ score: 1110, correct_count: 9, base_score: null, score_multiplier: null, level_id: null, session_multiplier: null }]);
    const diff = await legacy.db.query(`SELECT * FROM v1_snapshot EXCEPT SELECT id, session_id, user_id, game_mode_id, score, correct_count, total_rounds, stars, best_streak, xp_earned, duration_ms, details, completed_at, created_at FROM game_results`);
    assert.equal(diff.rows.length, 0);
  });

  test('a v1 player keeps their best and has level 1 completed, so level 2 is open', async () => {
    const res = await legacy.call('POST', '/auth/telegram', { body: { initData: initDataFor(TG) } });
    assert.equal(res.status, 200);
    assert.equal(res.body.bests.telegram_country_quiz.easy.best, 1110);
    const levels = (await legacy.call('GET', '/levels', { token: res.body.token })).body.levels;
    assert.equal(levels[0].best, 1110);
    assert.equal(levels[0].completed, true);
    assert.equal(levels[1].unlocked, true);
    assert.equal(levels[2].unlocked, false);
  });
});
