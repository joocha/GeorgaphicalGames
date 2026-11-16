# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org/). Releases up to v1.4.8 were tagged by commit message only; their entries below are reconstructed from git history.

## [2.0.0] – 2026-11-17 (prepared; not yet deployed)

The five-level GeoAIGames platform. Atlas Quest becomes Level 1. All v1 API shapes still work; the major version marks the new product structure and the required manual migration.

### New features
- **Level Selection** home screen with five level cards (number, icon, name, description, multiplier, best, progress, lock state and hint, Play), plus intro screens (categories, rules, rounds, best).
- **Levels 2–5** (Hydro, Earth, Resource, Master Explorer) served by a new backend **question engine**: 9 question types, 4 answer modes (options, map tap, map multi-select, matching), partial scoring, explanations with sources, avoidance of recently seen questions, configurable session length (backend).
- **Server-side multipliers** ×1–×5, applied after the base score; multiplier and rules snapshotted per session.
- **Progression**: configurable unlock and completion rules in `game_levels`, sticky unlocks, administrator unlock (`npm run admin:unlock`), `403 level_locked`.
- **Interactive map**: pan and pinch-zoom, lazily loaded Natural Earth river and lake layers with toggles, markers, highlighted features, multi-select, reveal with labels.
- **Geographic knowledge base** with provenance and verification status; **content pipeline** (`content:check`, `content:import`); verified sample content: 91 objects, 129 relations, 42 links, 35 USGS statistics, 80 questions (22/20/20/18).
- **Statistics** endpoint (`GET /api/me/stats`): totals, accuracy, average response time, per level, per category.
- **n8n / AI**: internal API for verified facts and AI question drafts (`in_review` only), plus a review CLI (`npm run questions`).
- **Documentation system**: `docs/` (11 documents) and `CLAUDE.md`.
- Build tooling: `tools/build-app.js` (reproducible `index.html`), `tools/fetch-layers.js`, `tools/build-layers.js`.

### Modified functionality
- Atlas Quest gameplay is unchanged. Its start screen is now the Level 1 intro; "Menu" and the Telegram back button lead to Level Selection; the result screen announces newly unlocked levels.
- `POST /api/sessions/:id/complete` for Level 1 treats `score` as the base score and stores `score = base × 1`.
- Outbox payload `game_result.recorded` gains `level`, `baseScore`, `scoreMultiplier`; new event `level.unlocked`.
- Page title: "GeoAIGames · Atlas Quest".

### Database changes
- Migration `20261117000000_v2_levels_question_engine` (additive): tables `game_levels`, `user_level_unlocks`, `game_answers`, `question_bank`, `data_sources`, `countries`, `geo_objects`, `geo_object_countries`, `geo_object_links`, `country_resource_stats`; nullable columns `game_modes.level_id`, `game_sessions.{level_id, score_multiplier, scoring_rules, rounds_planned}`, `game_results.{base_score, score_multiplier}`; CHECKs; triggers `game_answers_answer_once`, `game_sessions_scoring_is_final`.
- Migration `20261117000100_seed_levels`: five levels; Telegram easy/hard → Level 1; game `explorer_levels` with four modes.
- No existing row is modified except `game_modes.level_id` of the two Telegram catalog rows. Historical results are untouched (tested).

### API changes
New: `GET /levels`, `GET /me/stats`, `POST /sessions/:id/answers`, `GET /internal/geo-objects/:code`, `POST /internal/question-drafts`. Extended (additive): `POST /sessions` (accepts `{level, mode?, rounds?}`; returns `level`, `scoring`, and `questions` for engine levels), `POST /sessions/:id/complete` (returns `baseScore`, `scoreMultiplier`, `level`, `unlocked`). New env var `INTERNAL_API_TOKEN` (optional).

### Bug fixes
None (no v1 defects found during the audit).

### Tests
`npm test`: **63 tests passing** (13 v1 API, 15 scoring/validation unit, 12 content, 23 end-to-end levels; one v1 assertion was narrowed to `game_result.recorded` because finishing Level 1 now also emits `level.unlocked`). Browser check: full Level 1 and Level 2 games played through the UI in headless Chromium with a stubbed Telegram SDK; no page errors; scores 1350 (×1) and 2700 (×2) recorded.

### Deployment
Manual migration and content import **before** merging to `main`: see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#v200-deployment-manual-steps-in-this-order).

### Known issues
- Seed questions were written with AI assistance from verified facts; a human spot-check is recommended.
- No statistics screen in the UI yet; no session-length choice in the UI.
- Natural gas and coal statistics, mountain roads and megacities have no content yet ("soon" on the intro screen).
- Level 1 score is validated, not computed, by the server.

## [1.4.8] – 2026-11-16
- Express 5 `listen` callback: don't log "listening" when binding fails; the `error` handler reports it (`backend/src/server.js`).

## [1.4.7] – 2026-11-16
- Deploy workflow: fail (instead of succeeding silently) when the systemd service isn't installed, and refuse to start when another process already answers on the health URL.

## [1.4.6] – 2026-11-15
- Telegram sign-in hardening: `init_data_expired` vs `invalid_init_data`, `TELEGRAM_AUTH_MAX_AGE`, sign-in gate states in the Mini App, more API tests.

## [1.4.5] – 2026-11-14
- Deploy workflow rewritten: stop → update → clean install → load check → start → health check; README updates.

## [1.4.4] – 2026-11-14
- Telegram login, player profiles, game sessions and results in the API; the Mini App records games on the server; end-to-end API test on PGlite.

## [1.4.1 – 1.4.3] – 2026-11-12/13
- `.gitignore` and deploy workflow fixes (Nginx control commands).

## [1.4] – 2026-11-12
- PostgreSQL schema with Prisma migrations (`init`, `seed_game_catalog`), database documentation, GitHub Actions deploy workflow registered.

## [1.3] – 2026-11-10
- Backend API skeleton (Express on 127.0.0.1:3020, health check, config), systemd example, deploy workflow over SSH.

## [1.1] – 2026-11-03
- `.gitignore`.

## [1.0] – 2026-11-03
- First tagged release: Atlas Quest Telegram Mini App and Web Game on GitHub Pages, deploy workflow.
