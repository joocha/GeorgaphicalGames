// Deterministic answer validation. No AI, no network: the stored correct
// answers are compared with the submitted answer.
// Documentation: docs/QUESTION_ENGINE.md ("Answer validation").
import { HttpError } from '../http-error.js';

const MAX_PICKS = 60;
const MAX_LABEL = 120;

function bad(message) {
  return new HttpError(422, 'invalid_answer', message);
}

function stringList(value, field, { min = 1, max = MAX_PICKS } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw bad(`${field} must be an array of ${min}..${max} strings`);
  }
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_LABEL) throw bad(`${field} must contain non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw bad(`${field} must not repeat an entry`);
  return value;
}

// Share of a multi-select answer that is right:
//   max(0, (correct picks − wrong picks) / number of correct answers)
// Picking everything therefore never scores; missing one of four scores 0.75.
export function multiSelectFraction(picked, correct) {
  const want = new Set(correct);
  let hits = 0;
  let misses = 0;
  for (const p of picked) (want.has(p) ? hits++ : misses++);
  return Math.max(0, (hits - misses) / want.size);
}

// Validates the shape of `answer` for the question's answer mode and scores it.
// `question` needs: answer_mode, correct_answers, options, multi (bool).
// Returns {fraction (0..1), isCorrect (fully correct), answer (normalised)}.
export function evaluateAnswer(question, answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    throw bad('answer must be an object');
  }
  const correct = question.correct_answers;

  switch (question.answer_mode) {
    case 'options': {
      const valid = new Set((question.options || []).map((o) => o.id));
      const ids = stringList(answer.optionIds, 'optionIds', { max: valid.size || 1 });
      for (const id of ids) if (!valid.has(id)) throw bad(`unknown option "${id}"`);
      if (!question.multi && ids.length !== 1) throw bad('pick exactly one option');
      const fraction = question.multi ? multiSelectFraction(ids, correct) : (correct.includes(ids[0]) ? 1 : 0);
      return { fraction, isCorrect: fraction === 1, answer: { optionIds: ids } };
    }
    case 'map_single': {
      const countries = stringList(answer.countries, 'countries', { max: 1 });
      const fraction = correct.includes(countries[0]) ? 1 : 0;
      return { fraction, isCorrect: fraction === 1, answer: { countries } };
    }
    case 'map_multi': {
      const countries = stringList(answer.countries, 'countries');
      const fraction = multiSelectFraction(countries, correct);
      return { fraction, isCorrect: fraction === 1, answer: { countries } };
    }
    case 'pairs': {
      const left = new Set((question.options?.left || []).map((o) => o.id));
      const right = new Set((question.options?.right || []).map((o) => o.id));
      if (!Array.isArray(answer.pairs) || answer.pairs.length === 0 || answer.pairs.length > left.size) {
        throw bad(`pairs must be an array of 1..${left.size} {left, right} objects`);
      }
      const seen = new Set();
      for (const p of answer.pairs) {
        if (!p || typeof p !== 'object' || !left.has(p.left) || !right.has(p.right)) {
          throw bad('each pair must name a valid left and right id');
        }
        if (seen.has(p.left)) throw bad(`left item "${p.left}" is matched twice`);
        seen.add(p.left);
      }
      const want = new Map(correct.map((c) => [c.left, c.right]));
      const hits = answer.pairs.filter((p) => want.get(p.left) === p.right).length;
      const fraction = hits / want.size;
      return {
        fraction,
        isCorrect: fraction === 1,
        answer: { pairs: answer.pairs.map((p) => ({ left: p.left, right: p.right })) },
      };
    }
    default:
      throw new Error(`unknown answer mode ${question.answer_mode}`);
  }
}
