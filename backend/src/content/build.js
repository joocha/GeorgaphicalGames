// Loads and validates the content in backend/content/ WITHOUT a database:
// sources, countries, geographic objects and relations, resource statistics
// and questions. Correct answers that reference verified knowledge (`fact`)
// are derived here, so a question can never contradict the knowledge base.
//
//   const { content, errors, warnings } = buildContent(loadContentFiles(dir));
//
// Documentation: docs/QUESTION_ENGINE.md and docs/GEOGRAPHIC_DATA_SOURCES.md.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  QUESTION_TYPES, isQuestionType, defaultAnswerMode, isAllowedMode, TRUE_FALSE_OPTIONS,
} from '../engine/question-types.js';
import { isArea } from '../engine/geo.js';

export const CONTENT_DIR = new URL('../../content/', import.meta.url).pathname;

const CODE_RE = /^[a-z][a-z0-9_]*$/;
const QCODE_RE = /^[a-z0-9][a-z0-9_.-]*$/;
const STATUSES = ['draft', 'in_review', 'verified', 'rejected'];
const ORIGINS = ['curated', 'ai_generated', 'imported'];
const METRICS = ['mine_production', 'reserves', 'identified_resources'];
const LAYERS = ['rivers', 'lakes'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function loadContentFiles(dir = CONTENT_DIR) {
  const qdir = join(dir, 'questions');
  return {
    sources: readJson(join(dir, 'sources.json')),
    objects: readJson(join(dir, 'geo-objects.json')),
    stats: readJson(join(dir, 'resource-stats.json')),
    mapCountries: readJson(join(dir, 'map-countries.json')),
    layersIndex: readJson(join(dir, 'layers-index.json')),
    questionFiles: existsSync(qdir)
      ? readdirSync(qdir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, data: readJson(join(qdir, f)) }))
      : [],
  };
}

export const slug = (name) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1');

// Deterministic JSON (sorted keys) for content hashes.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const contentHash = (v) => createHash('sha256').update(stable(v)).digest('hex');

const sameSet = (a, b) => a.length === b.length && new Set([...a, ...b]).size === a.length;

export function buildContent(raw) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  // --- sources -------------------------------------------------------------
  const sources = [];
  const sourceCodes = new Set();
  for (const s of raw.sources.sources || []) {
    if (!CODE_RE.test(s.code || '')) err(`source ${s.code}`, 'code must be a lower-case code');
    if (!s.name || !s.license) err(`source ${s.code}`, 'name and license are required');
    if (sourceCodes.has(s.code)) err(`source ${s.code}`, 'duplicate code');
    sourceCodes.add(s.code);
    sources.push({
      code: s.code, name: s.name, url: s.url || null, license: s.license,
      attribution: s.attribution || null, notes: s.notes || null, retrievedAt: s.retrievedAt || null,
    });
  }
  const checkSource = (where, code) => {
    if (code && !sourceCodes.has(code)) err(where, `unknown source "${code}"`);
  };

  // --- countries -----------------------------------------------------------
  const countries = new Map();
  for (const c of raw.mapCountries.countries || []) {
    countries.set(c.name, { code: slug(c.name), name: c.name, isOnMap: true, wikidataId: null });
  }
  for (const c of raw.sources.extraCountries || []) {
    if (countries.has(c.name)) { err(`extra country ${c.name}`, 'is already on the map'); continue; }
    countries.set(c.name, { code: slug(c.name), name: c.name, isOnMap: false, wikidataId: c.wikidata || null });
  }
  const codes = new Set();
  for (const c of countries.values()) {
    if (codes.has(c.code)) err(`country ${c.name}`, `slug ${c.code} collides`);
    codes.add(c.code);
  }

  // --- geographic objects --------------------------------------------------
  const objects = new Map();
  const relations = [];
  const links = [];
  for (const o of raw.objects.objects || []) {
    const where = `object ${o.code}`;
    if (!CODE_RE.test(o.code || '')) { err(where, 'code must be a lower-case code'); continue; }
    if (objects.has(o.code)) { err(where, 'duplicate code'); continue; }
    if (!CODE_RE.test(o.type || '')) err(where, 'type must be a lower-case code');
    if (!o.name) err(where, 'name is required');
    if (!STATUSES.includes(o.status)) err(where, `status must be one of ${STATUSES.join(', ')}`);
    checkSource(where, o.source);
    if ((o.lat == null) !== (o.lon == null)) err(where, 'lat and lon go together');
    if (o.lat != null && !(o.lat >= -90 && o.lat <= 90 && o.lon >= -180 && o.lon <= 180)) err(where, 'lat/lon out of range');
    if (o.wikidata && !/^Q\d+$/.test(o.wikidata)) err(where, 'wikidata must look like Q123');

    let geometry = null;
    if (o.geometry) {
      const [layer, key] = String(o.geometry).split(':');
      const entry = raw.layersIndex[layer]?.[key];
      if (!LAYERS.includes(layer) || !entry) err(where, `geometry "${o.geometry}" is not in layers-index.json (run tools: npm run build-layers)`);
      else geometry = { layer, key, featureId: entry.id, bbox: entry.bbox };
    }

    objects.set(o.code, {
      code: o.code, objectType: o.type, name: o.name,
      lat: o.lat ?? null, lon: o.lon ?? null, geometry,
      wikidataId: o.wikidata || null, properties: o.properties || {},
      source: o.source || null, dataYear: o.dataYear ?? null,
      verificationStatus: o.status, notes: o.notes || null,
    });

    for (const [relation, spec] of Object.entries(o.countries || {})) {
      const list = Array.isArray(spec) ? spec : spec.list;
      const src = (!Array.isArray(spec) && spec.source) || o.source;
      checkSource(`${where}.countries.${relation}`, src);
      if (!CODE_RE.test(relation)) err(where, `relation "${relation}" must be a lower-case code`);
      for (const name of list || []) {
        if (!countries.has(name)) err(`${where}.countries.${relation}`, `unknown country "${name}"`);
        relations.push({ object: o.code, country: name, relation, source: src, note: (!Array.isArray(spec) && spec.note) || null, verificationStatus: o.status });
      }
    }
    for (const [relation, spec] of Object.entries(o.links || {})) {
      const list = Array.isArray(spec) ? spec : spec.list;
      const src = (!Array.isArray(spec) && spec.source) || o.source;
      checkSource(`${where}.links.${relation}`, src);
      for (const code of list || []) {
        links.push({ object: o.code, related: code, relation, source: src, note: (!Array.isArray(spec) && spec.note) || null, verificationStatus: o.status });
      }
    }
  }
  for (const l of links) {
    if (!objects.has(l.related)) err(`object ${l.object}.links.${l.relation}`, `unknown object "${l.related}"`);
    if (l.related === l.object) err(`object ${l.object}.links.${l.relation}`, 'an object cannot link to itself');
  }

  // --- resource statistics -------------------------------------------------
  const stats = [];
  const statKeys = new Set();
  for (const [i, s] of (raw.stats.stats || []).entries()) {
    const where = `stat #${i + 1} (${s.resource}/${s.country}/${s.metric}/${s.year})`;
    const res = objects.get(s.resource);
    if (!res || res.objectType !== 'mineral_resource') err(where, `resource "${s.resource}" must be a mineral_resource object`);
    if (!countries.has(s.country)) err(where, `unknown country "${s.country}"`);
    if (!METRICS.includes(s.metric)) err(where, `metric must be one of ${METRICS.join(', ')}`);
    if (!(typeof s.value === 'number' && s.value >= 0)) err(where, 'value must be a non-negative number');
    if (!s.unit) err(where, 'unit is required');
    if (!Number.isInteger(s.year)) err(where, 'year is required');
    if (s.rank != null && !(Number.isInteger(s.rank) && s.rank >= 1)) err(where, 'rank must be a positive integer');
    if (!s.source) err(where, 'source is required for statistics');
    checkSource(where, s.source);
    const key = [s.resource, s.country, s.metric, s.year, s.source].join('|');
    if (statKeys.has(key)) err(where, 'duplicate statistic');
    statKeys.add(key);
    stats.push({ resource: s.resource, country: s.country, metric: s.metric, value: s.value, unit: s.unit,
      dataYear: s.year, isEstimate: !!s.estimate, rank: s.rank ?? null, source: s.source, note: s.note || null,
      verificationStatus: 'verified' });
  }
  // Two countries can't hold the same rank for one metric and year.
  const rankKeys = new Map();
  for (const s of stats) {
    if (s.rank == null) continue;
    const k = `${s.resource}|${s.metric}|${s.dataYear}|${s.rank}`;
    if (rankKeys.has(k)) err(`stat ${s.resource}/${s.metric}/${s.dataYear}`, `rank ${s.rank} given to ${rankKeys.get(k)} and ${s.country}`);
    rankKeys.set(k, s.country);
  }

  // --- fact resolution (verified knowledge only) ---------------------------
  const verifiedObject = (code, where) => {
    const o = objects.get(code);
    if (!o) throw new Error(`${where}: unknown object "${code}"`);
    if (o.verificationStatus !== 'verified') throw new Error(`${where}: object "${code}" is not verified`);
    return o;
  };
  const countriesOf = (code, relation, where) => {
    verifiedObject(code, where);
    const list = relations.filter((r) => r.object === code && r.relation === relation && r.verificationStatus === 'verified').map((r) => r.country);
    if (!list.length) throw new Error(`${where}: object "${code}" has no verified "${relation}" countries`);
    return list;
  };
  const linksOf = (code, relation, where) => {
    verifiedObject(code, where);
    const list = links.filter((l) => l.object === code && l.relation === relation && l.verificationStatus === 'verified')
      .map((l) => verifiedObject(l.related, where).name);
    if (!list.length) throw new Error(`${where}: object "${code}" has no verified "${relation}" links`);
    return list;
  };
  const statCountries = (q, where) => {
    const ranks = q.ranks || [q.rank];
    return ranks.map((rank) => {
      const s = stats.find((x) => x.resource === q.resource && x.metric === q.metric && x.dataYear === q.year && x.rank === rank);
      if (!s) throw new Error(`${where}: no ${q.resource} ${q.metric} statistic for ${q.year} with rank ${rank}`);
      return s.country;
    });
  };
  // Returns {kind: 'set', values} or {kind: 'pairs', pairs, any}.
  function resolveFact(fact, where) {
    if (fact.intersect) {
      const sets = fact.intersect.map((f) => resolveFact(f, where));
      if (sets.some((s) => s.kind !== 'set')) throw new Error(`${where}: intersect needs sets`);
      return { kind: 'set', values: sets.map((s) => s.values).reduce((acc, vals) => acc.filter((v) => vals.includes(v))) };
    }
    if (fact.object && fact.countries) return { kind: 'set', values: countriesOf(fact.object, fact.countries, where) };
    if (fact.object && fact.links) return { kind: 'set', values: linksOf(fact.object, fact.links, where) };
    if (fact.stat) return { kind: 'set', values: statCountries(fact.stat, where) };
    if (fact.pairs?.stats) {
      return { kind: 'pairs', pairs: fact.pairs.stats.map((s) => [s.label, statCountries(s, where)[0]]) };
    }
    if (fact.pairs?.objects) {
      const any = fact.pairs.match === 'any';
      const pairs = fact.pairs.objects.map((code) => {
        const name = verifiedObject(code, where).name;
        const rights = fact.pairs.links ? linksOf(code, fact.pairs.links, where) : countriesOf(code, fact.pairs.countries, where);
        if (!any && rights.length !== 1) throw new Error(`${where}: "${code}" has ${rights.length} "${fact.pairs.links || fact.pairs.countries}" values; use "match": "any"`);
        return [name, any ? rights : rights[0]];
      });
      return { kind: 'pairs', pairs, any };
    }
    throw new Error(`${where}: unsupported fact reference ${JSON.stringify(fact)}`);
  }

  // --- questions -----------------------------------------------------------
  const questions = [];
  const qcodes = new Set();
  for (const { file, data } of raw.questionFiles) {
    if (!CODE_RE.test(data.level || '')) { err(file, 'level must be a level code'); continue; }
    for (const q of data.questions || []) {
      const where = `${file} ${q.code}`;
      try {
        if (!QCODE_RE.test(q.code || '')) throw new Error(`${where}: code must match ${QCODE_RE}`);
        if (qcodes.has(q.code)) throw new Error(`${where}: duplicate question code`);
        qcodes.add(q.code);
        questions.push(buildQuestion(q, data, where));
      } catch (e) {
        errors.push(e.message);
      }
    }
  }

  function buildQuestion(q, file, where) {
    if (!isQuestionType(q.type)) throw new Error(`${where}: unknown type "${q.type}"`);
    const answerMode = q.answerMode || defaultAnswerMode(q.type);
    if (!isAllowedMode(q.type, answerMode)) throw new Error(`${where}: answer mode "${answerMode}" is not allowed for ${q.type}`);
    if (!CODE_RE.test(q.category || '')) throw new Error(`${where}: category must be a lower-case code`);
    if (q.subcategory && !CODE_RE.test(q.subcategory)) throw new Error(`${where}: subcategory must be a lower-case code`);
    if (![1, 2, 3].includes(q.difficulty)) throw new Error(`${where}: difficulty must be 1, 2 or 3`);
    if (!q.text) throw new Error(`${where}: text is required`);
    if (!q.explanation) throw new Error(`${where}: explanation is required`);
    if (!q.source) throw new Error(`${where}: source is required`);
    checkSource(where, q.source);
    const status = q.status || file.status || 'draft';
    if (!STATUSES.includes(status)) throw new Error(`${where}: status must be one of ${STATUSES.join(', ')}`);
    const origin = q.origin || 'curated';
    if (!ORIGINS.includes(origin)) throw new Error(`${where}: origin must be one of ${ORIGINS.join(', ')}`);
    if (status === 'verified' && !file.reviewedBy) throw new Error(`${where}: verified questions need a reviewedBy in the file`);
    const object = q.object ? objects.get(q.object) : null;
    if (q.object && !object) throw new Error(`${where}: unknown object "${q.object}"`);
    if (object && object.verificationStatus !== 'verified') throw new Error(`${where}: object "${q.object}" is not verified`);

    // Map presentation.
    const map = q.map ? { ...q.map } : null;
    if (map) {
      const f = map.focus;
      if (f && !(f.object === true || isArea(f.area) || Array.isArray(f.countries))) throw new Error(`${where}: map.focus must be {area}, {countries} or {object: true}`);
      if (f?.object && !object) throw new Error(`${where}: map.focus.object needs an object`);
      for (const c of f?.countries || []) if (!countries.get(c)?.isOnMap) throw new Error(`${where}: map.focus country "${c}" is not on the map`);
      for (const c of map.highlightCountries || []) if (!countries.get(c)?.isOnMap) throw new Error(`${where}: highlighted country "${c}" is not on the map`);
      for (const l of map.layers || []) if (!LAYERS.includes(l)) throw new Error(`${where}: unknown layer "${l}"`);
      if (map.showObject && !(object && (object.lat != null || object.geometry))) throw new Error(`${where}: showObject needs an object with coordinates or geometry`);
    }

    // Correct answers: derived from verified knowledge when `fact` is given.
    let derived = null;
    if (q.fact) derived = resolveFact(q.fact, where);
    if (!q.fact && !q.correct) throw new Error(`${where}: either correct or fact is required`);

    const multi = answerMode === 'pairs' || (QUESTION_TYPES[q.type].multi && answerMode !== 'map_single');
    let options = [];
    let correctAnswers;
    let offMap = [];

    if (answerMode === 'options') {
      const labels = q.type === 'TRUE_FALSE' ? (q.options || TRUE_FALSE_OPTIONS) : q.options;
      if (!Array.isArray(labels) || labels.length < 2) throw new Error(`${where}: at least 2 options are required`);
      if (new Set(labels).size !== labels.length) throw new Error(`${where}: options repeat`);
      options = labels.map((label, i) => ({ id: `o${i + 1}`, label }));
      let correctLabels = q.correct;
      if (derived) {
        if (derived.kind !== 'set') throw new Error(`${where}: fact must resolve to a set for options`);
        if (correctLabels && !sameSet(correctLabels, derived.values)) {
          throw new Error(`${where}: correct ${JSON.stringify(correctLabels)} contradicts verified knowledge ${JSON.stringify(derived.values)}`);
        }
        correctLabels = derived.values;
      }
      for (const l of correctLabels) if (!labels.includes(l)) throw new Error(`${where}: correct answer "${l}" is not an option`);
      if (!multi && correctLabels.length !== 1) throw new Error(`${where}: ${q.type} needs exactly one correct option`);
      if (multi && correctLabels.length === labels.length) throw new Error(`${where}: every option is correct`);
      correctAnswers = options.filter((o) => correctLabels.includes(o.label)).map((o) => o.id);
    } else if (answerMode === 'map_single' || answerMode === 'map_multi') {
      let names = q.correct;
      if (derived) {
        if (derived.kind !== 'set') throw new Error(`${where}: fact must resolve to a set of countries`);
        if (names && !sameSet(names, derived.values)) {
          throw new Error(`${where}: correct ${JSON.stringify(names)} contradicts verified knowledge ${JSON.stringify(derived.values)}`);
        }
        names = derived.values;
      }
      for (const n of names) if (!countries.has(n)) throw new Error(`${where}: "${n}" is not a known country`);
      offMap = names.filter((n) => !countries.get(n).isOnMap);
      for (const n of offMap) {
        if (!q.explanation.includes(n)) throw new Error(`${where}: "${n}" is not on the map; the explanation must mention it`);
      }
      correctAnswers = names.filter((n) => countries.get(n).isOnMap);
      if (!correctAnswers.length) throw new Error(`${where}: no correct answer is on the map`);
      if (answerMode === 'map_single' && correctAnswers.length > 1) {
        warnings.push(`${where}: map_single with ${correctAnswers.length} accepted countries`);
      }
    } else if (answerMode === 'pairs') {
      const left = q.options?.left;
      const right = q.options?.right;
      if (!Array.isArray(left) || left.length < 2 || !Array.isArray(right) || right.length < left.length) {
        throw new Error(`${where}: pairs need options.left (>= 2) and options.right (>= left)`);
      }
      if (new Set(left).size !== left.length || new Set(right).size !== right.length) throw new Error(`${where}: pair options repeat`);
      options = { left: left.map((label, i) => ({ id: `l${i + 1}`, label })), right: right.map((label, i) => ({ id: `r${i + 1}`, label })) };
      let pairs = q.correct;
      if (derived) {
        if (derived.kind !== 'pairs') throw new Error(`${where}: fact must resolve to pairs`);
        if (derived.any) {
          if (!pairs) throw new Error(`${where}: "match": "any" facts need explicit correct pairs`);
          for (const [l, r] of pairs) {
            const allowed = derived.pairs.find(([dl]) => dl === l)?.[1];
            if (!allowed || !allowed.includes(r)) throw new Error(`${where}: pair ${l} → ${r} is not in verified knowledge`);
          }
        } else {
          const want = JSON.stringify([...derived.pairs].sort());
          if (pairs && JSON.stringify([...pairs].sort()) !== want) throw new Error(`${where}: correct pairs contradict verified knowledge ${want}`);
          pairs = derived.pairs;
        }
      }
      if (!Array.isArray(pairs) || pairs.length !== left.length) throw new Error(`${where}: every left item needs exactly one pair`);
      const id = (list, label) => list.find((o) => o.label === label)?.id;
      correctAnswers = pairs.map(([l, r]) => {
        const li = id(options.left, l);
        const ri = id(options.right, r);
        if (!li || !ri) throw new Error(`${where}: pair ${l} → ${r} uses a label that is not an option`);
        return { left: li, right: ri };
      });
      if (new Set(correctAnswers.map((p) => p.left)).size !== left.length) throw new Error(`${where}: a left item is paired twice`);
    }

    const row = {
      code: q.code,
      levelCode: file.level,
      category: q.category,
      subcategory: q.subcategory || null,
      questionType: q.type,
      answerMode,
      difficulty: q.difficulty,
      questionText: q.text,
      questionDescription: q.description || null,
      mapObjectCode: q.object || null,
      mapObjectType: object?.objectType || null,
      map: map ? { ...map, ...(offMap.length && { offMapAnswers: offMap }) } : (offMap.length ? { offMapAnswers: offMap } : null),
      options,
      correctAnswers,
      factRef: q.fact || null,
      explanation: q.explanation,
      basePoints: q.basePoints ?? 100,
      timeLimitSec: q.timeLimitSec ?? null,
      sourceCode: q.source,
      dataYear: q.year ?? null,
      language: q.language || 'en',
      isActive: q.active !== false,
      verificationStatus: status,
      origin,
      reviewedBy: status === 'verified' ? file.reviewedBy : null,
      reviewNote: file.reviewNote || null,
    };
    row.contentHash = contentHash({ ...row, reviewNote: undefined });
    return row;
  }

  return {
    content: {
      sources,
      countries: [...countries.values()],
      objects: [...objects.values()],
      relations,
      links,
      stats,
      questions,
    },
    errors,
    warnings,
  };
}
