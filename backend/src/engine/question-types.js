// Question types and answer modes of the question engine.
// Documentation: docs/QUESTION_ENGINE.md
//
// A question TYPE says what the question is about; its ANSWER MODE says how
// the player answers. Each type has a default mode and a set of allowed
// modes; a question may override the default (e.g. a RESOURCE_IDENTIFICATION
// question answered with options instead of a tap on the map).
//
// Answer modes and the answer body the API expects:
//   options     {"optionIds": ["o1"]}                 pick option(s) by id
//   map_single  {"countries": ["Chile"]}              tap exactly one country
//   map_multi   {"countries": ["Peru", "Colombia"]}   tap several countries
//   pairs       {"pairs": [{"left":"l1","right":"r2"}]} match left to right

export const ANSWER_MODES = ['options', 'map_single', 'map_multi', 'pairs'];

export const QUESTION_TYPES = {
  // One correct option out of several.
  SINGLE_CHOICE: { defaultMode: 'options', modes: ['options'], multi: false },
  // Several correct options; partial scoring.
  MULTIPLE_CHOICE: { defaultMode: 'options', modes: ['options'], multi: true },
  // "Find it": tap the country where something is.
  MAP_IDENTIFICATION: { defaultMode: 'map_single', modes: ['map_single'], multi: false },
  // "Name it": a country is highlighted on the map, pick its name.
  COUNTRY_IDENTIFICATION: { defaultMode: 'options', modes: ['options', 'map_single'], multi: false },
  // A geographic object (river, lake, strait, peak...) is shown; name it.
  OBJECT_IDENTIFICATION: { defaultMode: 'options', modes: ['options'], multi: false },
  // Match items from two lists; partial scoring.
  MATCHING: { defaultMode: 'pairs', modes: ['pairs'], multi: true },
  // A statement; options are always True / False.
  TRUE_FALSE: { defaultMode: 'options', modes: ['options'], multi: false },
  // Select every country related to an object; partial scoring.
  GEO_RELATIONSHIP: { defaultMode: 'map_multi', modes: ['map_multi', 'options'], multi: true },
  // Resource → country (tap it) or deposit → resource (options).
  RESOURCE_IDENTIFICATION: { defaultMode: 'map_single', modes: ['map_single', 'options'], multi: false },
};

export const TRUE_FALSE_OPTIONS = ['True', 'False'];

export function isQuestionType(type) {
  return Object.hasOwn(QUESTION_TYPES, type);
}

export function defaultAnswerMode(type) {
  return QUESTION_TYPES[type]?.defaultMode;
}

export function isAllowedMode(type, mode) {
  return !!QUESTION_TYPES[type]?.modes.includes(mode);
}
