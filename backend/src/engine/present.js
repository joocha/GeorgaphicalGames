// What the client sees. Two views of a question:
//
//   publicQuestion()  before answering: no correct answers, no explanation,
//                     the object's location only when the question shows it
//                     (map.showObject). Option order is shuffled per serve;
//                     ids stay stable, so validation is unaffected.
//   reveal()          after answering: correct answers, explanation, the
//                     object on the map, and the source with its year.
//
// Map geometry is in map coordinates (see geo.js). Line and area objects
// (rivers, lakes) are referenced by feature id of a lazy-loaded layer file
// (/layers/<layer>.json), which carries no names.
import { QUESTION_TYPES } from './question-types.js';
import { project, areaToBox, MAP_SCALE } from './geo.js';

function shuffled(list, rnd = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isMulti(q) {
  return q.answer_mode === 'pairs' || (QUESTION_TYPES[q.question_type]?.multi && q.answer_mode !== 'map_single');
}

// The object as a drawable map item, or null.
function objectShape(q) {
  if (!q.object_code) return null;
  if (q.object_layer && q.object_feature_id != null) {
    return { kind: 'feature', layer: q.object_layer, featureId: q.object_feature_id, bbox: q.object_bbox };
  }
  if (q.object_lat != null) {
    const [x, y] = project(q.object_lat, q.object_lon);
    return { kind: 'point', x, y };
  }
  return null;
}

function focusBox(q, shape) {
  const f = q.map?.focus;
  if (!f) return null;
  if (f.area) return { bbox: areaToBox(f.area) };
  if (f.countries) return { countries: f.countries };
  if (f.object && shape) {
    const pad = (f.padding ?? 15) * MAP_SCALE;
    const [x1, y1, x2, y2] = shape.kind === 'point' ? [shape.x, shape.y, shape.x, shape.y] : shape.bbox;
    return { bbox: [x1 - pad, y1 - pad, x2 + pad, y2 + pad].map((v) => Math.round(v * 10) / 10) };
  }
  return null;
}

// `q` is a question_bank row joined with its object (see QUESTION_COLUMNS).
export function publicQuestion(q, round, rnd = Math.random) {
  const shape = objectShape(q);
  const show = !!q.map?.showObject;
  const options = q.answer_mode === 'pairs'
    ? { left: q.options.left, right: shuffled(q.options.right, rnd) }
    : q.question_type === 'TRUE_FALSE' ? q.options : shuffled(q.options, rnd);

  return {
    round,
    type: q.question_type,
    answerMode: q.answer_mode,
    multi: isMulti(q),
    category: q.category,
    difficulty: q.difficulty,
    text: q.question_text,
    description: q.question_description,
    basePoints: q.base_points,
    timeLimitSec: q.time_limit_sec,
    options: q.answer_mode === 'options' || q.answer_mode === 'pairs' ? options : null,
    // Only countries of map answers are tappable; the client knows the map.
    map: {
      focus: focusBox(q, shape),
      layers: [...new Set([...(q.map?.layers || []), ...(show && shape?.kind === 'feature' ? [shape.layer] : [])])],
      highlightCountries: q.map?.highlightCountries || [],
      object: show ? shape : null,
    },
    dataYear: q.data_year,
  };
}

export function reveal(q) {
  const labels = (list, ids) => ids.map((id) => list.find((o) => o.id === id)).filter(Boolean);
  let correct;
  if (q.answer_mode === 'options') correct = { optionIds: q.correct_answers, labels: labels(q.options, q.correct_answers).map((o) => o.label) };
  else if (q.answer_mode === 'pairs') {
    correct = {
      pairs: q.correct_answers,
      labels: q.correct_answers.map((p) => [labels(q.options.left, [p.left])[0]?.label, labels(q.options.right, [p.right])[0]?.label]),
    };
  } else correct = { countries: q.correct_answers };

  const shape = objectShape(q);
  return {
    correct,
    offMapAnswers: q.map?.offMapAnswers || [],
    explanation: q.explanation,
    object: q.object_code ? { name: q.object_name, type: q.object_type, shape } : null,
    source: q.source_name ? { name: q.source_name, url: q.source_url, year: q.data_year } : null,
  };
}

// Columns selected wherever a question is presented or scored.
export const QUESTION_COLUMNS = `
  q.id, q.code, q.question_type, q.answer_mode, q.category, q.difficulty, q.question_text, q.question_description,
  q.map, q.options, q.correct_answers, q.explanation, q.base_points, q.time_limit_sec, q.data_year, q.version,
  o.code AS object_code, o.name AS object_name, o.object_type, o.lat::float8 AS object_lat, o.lon::float8 AS object_lon,
  o.geometry_layer AS object_layer, o.geometry_feature_id AS object_feature_id, o.bbox AS object_bbox,
  s.name AS source_name, s.url AS source_url`;

export const QUESTION_JOINS = `
  LEFT JOIN geo_objects o ON o.id = q.map_object_id
  LEFT JOIN data_sources s ON s.id = q.data_source_id`;
