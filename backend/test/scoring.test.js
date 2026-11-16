// Unit tests: scoring, multipliers, partial scoring, answer validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMultiplier, streakBonus, scoreAnswer, sessionTotals, scoringSnapshot, toMultiplier, DEFAULT_SCORING,
} from '../src/engine/scoring.js';
import { evaluateAnswer, multiSelectFraction } from '../src/engine/evaluate.js';
import { evaluateUnlockRule, describeUnlockRule } from '../src/services/levels.js';
import { validateResult } from '../src/services/sessions.js';
import { project, areaToBox } from '../src/engine/geo.js';

test('the five level multipliers turn a 100-point answer into 100..500', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((m) => applyMultiplier(100, m)), [100, 200, 300, 400, 500]);
  // NUMERIC columns arrive from PostgreSQL as strings.
  assert.equal(applyMultiplier(150, '3.00'), 450);
  assert.equal(applyMultiplier(0, 5), 0);
  assert.throws(() => toMultiplier(0));
  assert.throws(() => toMultiplier('abc'));
});

test('streak bonus keeps the Atlas Quest rule: min(50, (streak - 1) × 10)', () => {
  assert.deepEqual([0, 1, 2, 3, 6, 7, 20].map((s) => streakBonus(s)), [0, 0, 10, 20, 50, 50, 50]);
});

test('the multiplier is applied after base points and streak bonus', () => {
  const r = scoreAnswer({ fraction: 1, basePoints: 100, streakBefore: 2, multiplier: 3 });
  assert.deepEqual(r, { basePoints: 100, streakBonus: 20, points: 360, streak: 3 });
});

test('partial answers score proportionally, get no streak bonus and reset the streak', () => {
  const r = scoreAnswer({ fraction: 0.75, basePoints: 100, streakBefore: 4, multiplier: 2 });
  assert.deepEqual(r, { basePoints: 75, streakBonus: 0, points: 150, streak: 0 });
  const wrong = scoreAnswer({ fraction: 0, basePoints: 100, streakBefore: 4, multiplier: 5 });
  assert.deepEqual(wrong, { basePoints: 0, streakBonus: 0, points: 0, streak: 0 });
  assert.throws(() => scoreAnswer({ fraction: 1.2, basePoints: 100, streakBefore: 0, multiplier: 1 }));
});

test('a perfect 10-round level-1-rules game is 1350 base, ×multiplier', () => {
  let streak = 0;
  const rounds = [];
  for (let i = 0; i < 10; i++) {
    const r = scoreAnswer({ fraction: 1, basePoints: 100, streakBefore: streak, multiplier: 4 });
    streak = r.streak;
    rounds.push({ ...r, isCorrect: true });
  }
  const t = sessionTotals(rounds);
  assert.equal(t.baseScore, 1350);
  assert.equal(t.score, 1350 * 4);
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

test('Level 1 results are validated on the base score, unchanged from v1', () => {
  const mode = { rounds_per_session: 10, config: { scoring: { correctBase: 100, streakBonusPerStep: 10, streakBonusCap: 50, maxScore: 1350 } } };
  assert.equal(validateResult(mode, { score: 310, correctCount: 3, bestStreak: 2 }).score, 310);
  assert.throws(() => validateResult(mode, { score: 9999, correctCount: 3 }), /between/);
  assert.throws(() => validateResult(mode, { score: 1400, correctCount: 10, bestStreak: 10 }));
});

test('scoring snapshot records the multiplier and the rules used', () => {
  const engine = scoringSnapshot({ level: { code: 'hydro', number: 2, score_multiplier: '2.00' }, mode: { config: { engine: 'question_engine' } } });
  assert.equal(engine.multiplier, 2);
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

test('map projection matches the embedded country map', () => {
  assert.deepEqual(project(90, -180), [0, 0]);
  assert.deepEqual(project(0, 0), [500, 250]);
  assert.deepEqual(areaToBox([-10, -20, 10, 20]), [444.4, 222.2, 555.6, 277.8]);
});
