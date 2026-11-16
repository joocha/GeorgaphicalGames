// Content validation: the seed content is valid, every level is playable,
// and the validator refuses content that contradicts verified knowledge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContent, loadContentFiles } from '../src/content/build.js';

const fresh = () => structuredClone(loadContentFiles());

function withQuestion(question, { level = 'hydro', status = 'verified' } = {}) {
  const raw = fresh();
  raw.questionFiles = [{ file: 'test.json', data: { level, status, reviewedBy: 'test', questions: [question] } }];
  return buildContent(raw);
}

test('the seed content has no errors', () => {
  const { errors, content } = buildContent(fresh());
  assert.deepEqual(errors, []);
  assert.ok(content.questions.length >= 70);
});

test('every new level has at least one full session of verified questions', () => {
  const { content } = buildContent(fresh());
  for (const level of ['hydro', 'earth', 'resources', 'master']) {
    const n = content.questions.filter((q) => q.levelCode === level && q.verificationStatus === 'verified' && q.isActive).length;
    assert.ok(n >= 10, `${level} has only ${n} verified questions`);
  }
});

test('every question names a source; statistics name their year', () => {
  const { content } = buildContent(fresh());
  for (const q of content.questions) {
    assert.ok(q.sourceCode, q.code);
    if (q.sourceCode === 'usgs_mcs_2026' || q.sourceCode === 'world_bank_wdi') assert.ok(q.dataYear, `${q.code} needs a data year`);
  }
  for (const s of content.stats) assert.ok(s.dataYear && s.source && s.unit, `${s.resource}/${s.country}`);
});

test('map answers are always countries a player can tap', () => {
  const raw = fresh();
  const onMap = new Set(raw.mapCountries.countries.map((c) => c.name));
  const { content } = buildContent(raw);
  for (const q of content.questions.filter((x) => x.answerMode.startsWith('map_'))) {
    for (const c of q.correctAnswers) assert.ok(onMap.has(c), `${q.code}: ${c}`);
  }
  const alps = content.questions.find((q) => q.code === 'earth.alps.countries');
  assert.deepEqual(alps.map.offMapAnswers.sort(), ['Liechtenstein', 'Monaco']);
  assert.ok(!alps.correctAnswers.includes('Monaco'));
});

test('geographic relationships are stored and verified', () => {
  const { content } = buildContent(fresh());
  const rel = (o, r) => content.relations.filter((x) => x.object === o && x.relation === r).map((x) => x.country).sort();
  assert.deepEqual(rel('danube', 'flows_through').length, 10);
  assert.deepEqual(rel('mekong', 'flows_through'), ['Cambodia', 'China', 'Laos', 'Myanmar', 'Thailand', 'Vietnam']);
  assert.deepEqual(rel('caspian_sea', 'shared_by'), ['Azerbaijan', 'Iran', 'Kazakhstan', 'Russia', 'Turkmenistan']);
  assert.equal(rel('nile', 'basin').length, 11);
  const links = (o, r) => content.links.filter((x) => x.object === o && x.relation === r).map((x) => x.related).sort();
  assert.deepEqual(links('bosporus', 'connects'), ['black_sea', 'sea_of_marmara']);
  assert.deepEqual(links('grasberg_mine', 'produces'), ['copper', 'gold']);
  // Rivers and lakes point at real features of the lazy-loaded layers.
  const danube = content.objects.find((o) => o.code === 'danube');
  assert.equal(danube.geometry.layer, 'rivers');
  assert.ok(Number.isInteger(danube.geometry.featureId));
});

test('derived answers: intersections and statistics', () => {
  const { content } = buildContent(fresh());
  const q = (code) => content.questions.find((x) => x.code === code);
  assert.deepEqual(q('master.andes_and_amazon').correctAnswers.sort(), ['Colombia', 'Peru']);
  assert.deepEqual(q('master.danube_and_alps').correctAnswers.sort(), ['Austria', 'Germany']);
  assert.deepEqual(q('res.copper.top_producer').correctAnswers, ['Chile']);
  const lithium = q('res.lithium.production_reserves_resources');
  const label = (side, id) => lithium.options[side].find((o) => o.id === id).label;
  assert.deepEqual(lithium.correctAnswers.map((p) => [label('left', p.left), label('right', p.right)]),
    [['Mine production (2024)', 'Australia'], ['Reserves', 'Chile'], ['Identified resources', 'Argentina']]);
});

test('production, reserves and resources are never mixed', () => {
  const { content } = buildContent(fresh());
  const chile = content.stats.filter((s) => s.resource === 'lithium' && s.country === 'Chile').map((s) => s.metric).sort();
  assert.deepEqual(chile, ['identified_resources', 'mine_production', 'reserves']);
  const raw = fresh();
  raw.stats.stats.push({ resource: 'gold', country: 'Peru', metric: 'output', value: 1, unit: 't', year: 2024, source: 'usgs_mcs_2026' });
  assert.match(buildContent(raw).errors.join('\n'), /metric must be one of/);
});

test('a question that contradicts verified knowledge is rejected', () => {
  const { errors } = withQuestion({
    code: 'test.mekong', category: 'rivers', type: 'GEO_RELATIONSHIP', difficulty: 1, source: 'wikidata',
    text: 'x', explanation: 'x', fact: { object: 'mekong', countries: 'flows_through' }, correct: ['China', 'India'],
  });
  assert.match(errors.join('\n'), /contradicts verified knowledge/);
});

test('an unknown object, a wrong option or a missing source is rejected', () => {
  const base = { code: 'test.q', category: 'rivers', type: 'SINGLE_CHOICE', difficulty: 1, text: 'x', explanation: 'x', source: 'wikipedia' };
  assert.match(withQuestion({ ...base, object: 'atlantis', options: ['A', 'B'], correct: ['A'] }).errors.join(), /unknown object/);
  assert.match(withQuestion({ ...base, options: ['A', 'B'], correct: ['C'] }).errors.join(), /not an option/);
  assert.match(withQuestion({ ...base, options: ['A', 'B'], correct: ['A'], source: 'blog' }).errors.join(), /unknown source/);
  assert.match(withQuestion({ ...base, options: ['A', 'B'], correct: ['A', 'B'] }).errors.join(), /exactly one/);
  assert.match(withQuestion({ ...base, type: 'NOT_A_TYPE' }).errors.join(), /unknown type/);
});

test('countries too small for the map must be explained', () => {
  const { errors } = withQuestion({
    code: 'test.alps', category: 'rivers', type: 'GEO_RELATIONSHIP', difficulty: 1, source: 'wikipedia',
    text: 'x', explanation: 'France, Italy and others.', fact: { object: 'alps', countries: 'crosses' },
  });
  assert.match(errors.join('\n'), /not on the map; the explanation must mention it/);
});

test('verified questions need a reviewer; drafts do not', () => {
  const q = { code: 'test.q', category: 'rivers', type: 'TRUE_FALSE', difficulty: 1, text: 'x', explanation: 'x', source: 'wikipedia', correct: ['True'] };
  const raw = fresh();
  raw.questionFiles = [{ file: 't.json', data: { level: 'hydro', status: 'verified', questions: [q] } }];
  assert.match(buildContent(raw).errors.join(), /reviewedBy/);
  raw.questionFiles[0].data.status = 'draft';
  assert.deepEqual(buildContent(raw).errors, []);
});

test('facts can only come from verified objects', () => {
  const raw = fresh();
  raw.objects.objects.find((o) => o.code === 'mekong').status = 'draft';
  assert.match(buildContent(raw).errors.join('\n'), /"mekong" is not verified/);
});
