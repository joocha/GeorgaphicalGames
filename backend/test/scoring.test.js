// Unit tests: scoring, multipliers, partial scoring, answer validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMultiplier, streakBonus, scoreAnswer, sessionTotals, scoringSnapshot, toMultiplier, DEFAULT_SCORING,
  progressScore, pointsSummary, SCORING_VERSION,
} from '../src/engine/scoring.js';
import { contiguousLevel } from '../src/services/progression.js';
import { evaluateAnswer, multiSelectFraction } from '../src/engine/evaluate.js';
import { evaluateUnlockRule, describeUnlockRule } from '../src/services/levels.js';
import { validateResult } from '../src/services/sessions.js';
import { project, areaToBox } from '../src/engine/geo.js';

test('the five level multipliers turn 10 base points into 10..50', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((m) => applyMultiplier(10, m)), [10, 20, 30, 40, 50]);
  assert.equal(applyMultiplier(10, 7), 70, 'level N multiplies by N');
  // NUMERIC columns arrive from PostgreSQL as strings.
  assert.equal(applyMultiplier(150, '3.00'), 450);
  assert.equal(applyMultiplier(0, 5), 0);
  assert.throws(() => toMultiplier(0));
  assert.throws(() => toMultiplier('abc'));
});

test('streak bonus is the Atlas Quest rule ÷10: min(5, streak - 1)', () => {
  assert.deepEqual([0, 1, 2, 3, 6, 7, 20].map((s) => streakBonus(s)), [0, 0, 1, 2, 5, 5, 5]);
});

test('the multiplier is applied after base points and streak bonus', () => {
  // Question base points stay authored as 100; pointScale 0.1 makes them 10.
  const r = scoreAnswer({ fraction: 1, basePoints: 100, streakBefore: 2, multiplier: 3 });
  assert.deepEqual(r, { basePoints: 10, streakBonus: 2, points: 36, streak: 3 });
});

test('partial answers score proportionally, get no streak bonus and reset the streak', () => {
  const r = scoreAnswer({ fraction: 0.5, basePoints: 100, streakBefore: 4, multiplier: 2 });
  assert.deepEqual(r, { basePoints: 5, streakBonus: 0, points: 10, streak: 0 });
  const wrong = scoreAnswer({ fraction: 0, basePoints: 100, streakBefore: 4, multiplier: 5 });
  assert.deepEqual(wrong, { basePoints: 0, streakBonus: 0, points: 0, streak: 0 });
  assert.throws(() => scoreAnswer({ fraction: 1.2, basePoints: 100, streakBefore: 0, multiplier: 1 }));
});

test('a perfect 10-round game is 135 base (was 1350), ×multiplier', () => {
  let streak = 0;
  const rounds = [];
  for (let i = 0; i < 10; i++) {
    const r = scoreAnswer({ fraction: 1, basePoints: 100, streakBefore: streak, multiplier: 4 });
    streak = r.streak;
    rounds.push({ ...r, isCorrect: true });
  }
  const t = sessionTotals(rounds);
  assert.equal(t.baseScore, 135);
  assert.equal(t.score, 135 * 4);
  assert.equal(t.correctCount, 10);
  assert.equal(t.bestStreak, 10);
});

test('session totals count unanswered rounds as wrong and track the best streak', () => {
  const t = sessionTotals([
    { points: 200, basePoints: 100, streakBonus: 0, isCorrect: true },
    { points: 220, basePoints: 100, streakBonus: 10, isCorrect: true },
    { points: 100, basePoints: 50, streakBonus: 0, isCorrect: false },
    { points: null },
    { points: 200, basePoints: 100, streakBonus: 0, isCorrect: true },
  ]);
  assert.deepEqual(t, { score: 720, baseScore: 360, correctCount: 3, bestStreak: 2, totalRounds: 5 });
});

test('multi-select partial scoring: (hits − false picks) / correct, never below 0', () => {
  const correct = ['A', 'B', 'C', 'D'];
  assert.equal(multiSelectFraction(['A', 'B', 'C', 'D'], correct), 1);
  assert.equal(multiSelectFraction(['A', 'B', 'C'], correct), 0.75);
  assert.equal(multiSelectFraction(['A', 'B', 'C', 'X'], correct), 0.5);
  assert.equal(multiSelectFraction(['X', 'Y'], correct), 0);
  // Selecting everything is not rewarded.
  assert.equal(multiSelectFraction(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], correct), 0);
});

const OPTIONS_Q = { answer_mode: 'options', multi: false, options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }], correct_answers: ['o2'] };
const MULTI_Q = { answer_mode: 'options', multi: true, options: ['o1', 'o2', 'o3', 'o4'].map((id) => ({ id, label: id })), correct_answers: ['o1', 'o2'] };
const MAP_Q = { answer_mode: 'map_multi', multi: true, correct_answers: ['Peru', 'Colombia', 'Brazil'] };
const PAIRS_Q = {
  answer_mode: 'pairs', multi: true,
  options: { left: [{ id: 'l1' }, { id: 'l2' }], right: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] },
  correct_answers: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r2' }],
};

test('answer validation: single choice', () => {
  assert.equal(evaluateAnswer(OPTIONS_Q, { optionIds: ['o2'] }).fraction, 1);
  assert.equal(evaluateAnswer(OPTIONS_Q, { optionIds: ['o1'] }).isCorrect, false);
  assert.throws(() => evaluateAnswer(OPTIONS_Q, { optionIds: ['o1', 'o2'] }), /exactly one/);
  assert.throws(() => evaluateAnswer(OPTIONS_Q, { optionIds: ['o9'] }), /unknown option/);
  assert.throws(() => evaluateAnswer(OPTIONS_Q, { optionIds: 'o1' }), /optionIds/);
  assert.throws(() => evaluateAnswer(OPTIONS_Q, null), /object/);
});

test('answer validation: multiple choice and map selections score partially', () => {
  assert.equal(evaluateAnswer(MULTI_Q, { optionIds: ['o1'] }).fraction, 0.5);
  assert.equal(evaluateAnswer(MULTI_Q, { optionIds: ['o1', 'o2'] }).isCorrect, true);
  assert.equal(evaluateAnswer(MAP_Q, { countries: ['Peru', 'Brazil'] }).fraction, 2 / 3);
  assert.equal(evaluateAnswer(MAP_Q, { countries: ['Peru', 'Brazil', 'Chile'] }).fraction, 1 / 3);
  assert.throws(() => evaluateAnswer(MAP_Q, { countries: ['Peru', 'Peru'] }), /repeat/);
  assert.throws(() => evaluateAnswer(MAP_Q, { countries: [] }), /countries/);
});

test('answer validation: map tap accepts exactly one country', () => {
  const q = { answer_mode: 'map_single', multi: false, correct_answers: ['Chile'] };
  assert.equal(evaluateAnswer(q, { countries: ['Chile'] }).isCorrect, true);
  assert.equal(evaluateAnswer(q, { countries: ['Peru'] }).fraction, 0);
  assert.throws(() => evaluateAnswer(q, { countries: ['Chile', 'Peru'] }), /countries/);
});

test('answer validation: matching scores correct pairs / total', () => {
  assert.equal(evaluateAnswer(PAIRS_Q, { pairs: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r3' }] }).fraction, 0.5);
  assert.equal(evaluateAnswer(PAIRS_Q, { pairs: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r2' }] }).isCorrect, true);
  assert.throws(() => evaluateAnswer(PAIRS_Q, { pairs: [{ left: 'l1', right: 'r1' }, { left: 'l1', right: 'r2' }] }), /twice/);
  assert.throws(() => evaluateAnswer(PAIRS_Q, { pairs: [{ left: 'l9', right: 'r1' }] }), /valid/);
});

test('sessions snapshotted before v2.1.0 keep the original scale', () => {
  const legacy = { basePointsDefault: 100, streakBonusPerStep: 10, streakBonusCap: 50, streakNeedsFullyCorrect: true };
  const r = scoreAnswer({ fraction: 1, basePoints: 100, streakBefore: 2, multiplier: 3, rules: legacy });
  assert.deepEqual(r, { basePoints: 100, streakBonus: 20, points: 360, streak: 3 });
});

// Level 1 rules as written by migration 20261118000000 (also checked against
// the database in levels.test.js).
const EASY = { rounds_per_session: 10, config: { scoring: { correctBase: 10, streakBonusPerStep: 1, streakBonusCap: 5, maxScore: 135 } } };
const HARD = { rounds_per_session: 10, config: { scoring: { correctBase: 20, streakBonusPerStep: 2, streakBonusCap: 10, maxScore: 270 } } };
const LEGACY_L1 = { rounds_per_session: 10, config: { scoring: { correctBase: 100, streakBonusPerStep: 10, streakBonusCap: 50, maxScore: 1350 } } };

// Per-answer points of a perfect game under a Level 1 rule set.
const perfectRun = ({ config: { scoring: s } }) =>
  Array.from({ length: 10 }, (_, i) => s.correctBase + Math.min(s.streakBonusCap, i * s.streakBonusPerStep));

test('normal (Easy) mode is the original scoring divided by 10', () => {
  const now = perfectRun(EASY);
  assert.deepEqual(now, perfectRun(LEGACY_L1).map((p) => p / 10));
  assert.deepEqual(now, [10, 11, 12, 13, 14, 15, 15, 15, 15, 15]);
  assert.equal(now.reduce((a, b) => a + b), 135);
  assert.equal(validateResult(EASY, { score: 135, correctCount: 10, bestStreak: 10 }).score, 135);
  assert.equal(validateResult(EASY, { score: 31, correctCount: 3, bestStreak: 2 }).score, 31);
  assert.throws(() => validateResult(EASY, { score: 34, correctCount: 3, bestStreak: 2 }), /between 30 and 33/);
  assert.throws(() => validateResult(EASY, { score: 310, correctCount: 3, bestStreak: 2 }), /between 0 and 135/);
  assert.throws(() => validateResult(EASY, { score: 136, correctCount: 10, bestStreak: 10 }));
});

test('hard mode pays twice the normal points for every correct answer (max 270)', () => {
  const hard = perfectRun(HARD);
  assert.deepEqual(hard, perfectRun(EASY).map((p) => p * 2));
  assert.equal(hard.reduce((a, b) => a + b), 270);
  assert.equal(validateResult(HARD, { score: 270, correctCount: 10, bestStreak: 10 }).score, 270);
  assert.equal(validateResult(HARD, { score: 62, correctCount: 3, bestStreak: 2 }).score, 62);
  assert.throws(() => validateResult(HARD, { score: 271, correctCount: 10, bestStreak: 10 }));
  // The multiplier applies to Hard as well: Level 1 is ×1, a ×N level ×N.
  assert.equal(applyMultiplier(270, 1), 270);
  assert.equal(applyMultiplier(20, 4), 80);
});

test('old results count ÷10 towards totals; new ones as stored', () => {
  assert.equal(progressScore(1350, null), 135);
  assert.equal(progressScore(2700, 1), 270);
  assert.equal(progressScore(1115, null), 112);
  assert.equal(progressScore(135, SCORING_VERSION), 135);
});

test('points shown before playing come from the rules', () => {
  assert.deepEqual(pointsSummary(HARD.config), { correct: 20, streakBonusPerStep: 2, streakBonusCap: 10, maxScore: 270 });
  assert.deepEqual(pointsSummary({ engine: 'question_engine', scoring: DEFAULT_SCORING }),
    { correct: 10, streakBonusPerStep: 1, streakBonusCap: 5, maxScore: null });
  assert.equal(pointsSummary({}), null);
});

test('scoring snapshot records the multiplier and the rules used', () => {
  const engine = scoringSnapshot({ level: { code: 'hydro', number: 2, score_multiplier: '2.00' }, mode: { config: { engine: 'question_engine' } } });
  assert.equal(engine.multiplier, 2);
  assert.equal(engine.version, 2);
  assert.equal(engine.engine, 'question_engine');
  assert.deepEqual(engine.scoring, { ...DEFAULT_SCORING });
  const client = scoringSnapshot({ level: { code: 'atlas', number: 1, score_multiplier: 1 }, mode: { config: { scoring: { correctBase: 100 } } } });
  assert.equal(client.engine, 'client_validated');
  assert.deepEqual(client.scoring, { correctBase: 100 });
});

test('unlock rules are evaluated from progress, not from the client', () => {
  const progress = new Map([[1, { completed: true, best: 900, plays: 3 }], [2, { completed: false, best: null, plays: 0 }]]);
  assert.equal(evaluateUnlockRule({ type: 'always' }, progress), true);
  assert.equal(evaluateUnlockRule({ type: 'level_completed', level: 1 }, progress), true);
  assert.equal(evaluateUnlockRule({ type: 'level_completed', level: 2 }, progress), false);
  assert.equal(evaluateUnlockRule({ type: 'level_best_score', level: 1, min: 800 }, progress), true);
  assert.equal(evaluateUnlockRule({ type: 'level_best_score', level: 1, min: 1000 }, progress), false);
  assert.equal(evaluateUnlockRule({ type: 'level_sessions', level: 1, min: 3 }, progress), true);
  assert.equal(evaluateUnlockRule({ type: 'all', rules: [{ type: 'always' }, { type: 'level_completed', level: 2 }] }, progress), false);
  assert.equal(evaluateUnlockRule({ type: 'any', rules: [{ type: 'admin_only' }, { type: 'level_completed', level: 1 }] }, progress), true);
  assert.equal(evaluateUnlockRule({ type: 'admin_only' }, progress), false);
  assert.equal(evaluateUnlockRule({ type: 'unknown' }, progress), false);
  assert.equal(describeUnlockRule({ type: 'level_completed', level: 1 }, [{ number: 1, name: 'Atlas Explorer' }]),
    'Complete Level 1 · Atlas Explorer to unlock');
});

test('score thresholds unlock at exactly the required lifetime total', () => {
  const progress = new Map();
  const rule = (min) => ({ type: 'total_score', min });
  assert.equal(evaluateUnlockRule(rule(1000), progress, { totalScore: 999 }), false);
  assert.equal(evaluateUnlockRule(rule(1000), progress, { totalScore: 1000 }), true);
  assert.equal(evaluateUnlockRule(rule(3000), progress, { totalScore: 2999 }), false);
  assert.equal(evaluateUnlockRule(rule(3000), progress, { totalScore: 3000 }), true);
  assert.equal(evaluateUnlockRule(rule(1000), progress), false, 'no totals means no score');
  assert.equal(evaluateUnlockRule({ type: 'all', rules: [rule(1000), { type: 'always' }] }, progress, { totalScore: 1000 }), true);
  assert.equal(describeUnlockRule(rule(10000), []), 'Reach 10,000 total points to unlock');
});

test('the profile level is the highest level with every level below it unlocked', () => {
  const lv = (...open) => [1, 2, 3, 4, 5].map((number) => ({ number, unlocked: open.includes(number) }));
  assert.equal(contiguousLevel(lv(1)), 1);
  assert.equal(contiguousLevel(lv(1, 2, 3)), 3);
  // An out-of-order admin grant (Level 5 only) doesn't raise the level.
  assert.equal(contiguousLevel(lv(1, 5)), 1);
  // Capped at the highest existing level (no Level 6 yet).
  assert.equal(contiguousLevel(lv(1, 2, 3, 4, 5)), 5);
});

test('map projection matches the embedded country map', () => {
  assert.deepEqual(project(90, -180), [0, 0]);
  assert.deepEqual(project(0, 0), [500, 250]);
  assert.deepEqual(areaToBox([-10, -20, 10, 20]), [444.4, 222.2, 555.6, 277.8]);
});
