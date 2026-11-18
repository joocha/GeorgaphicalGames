# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org/). Releases up to v1.4.8 were tagged by commit message only; their entries below are reconstructed from git history.

## [2.2.0] – 2026-11-18 (prepared; not yet imported)

Hydro Explorer content batch 2. Content only: no code, schema or API change.

### New features
- **88 new Hydro questions** (`backend/content/questions/level-2-hydro-2.json`). Hydro goes from 22 to **110** verified questions, so repeats become rare. Coverage: oceans (19, including currents and trench depths), lakes (19), rivers (19), straits (15), waterfalls (7), seas (6), canals (3). All 7 question types are used; difficulty 1/2/3 = 18/51/19.
- Currents and depths are filed under the existing `oceans` / `lakes` / `rivers` categories. A dedicated "Currents" chip on the intro screen would need a `game_levels.categories` change (SQL or migration).

### Knowledge base
- New verified objects: `congo_river`, `ganges`, `niger_river`, `lake_ladoga` (map geometry from the existing Natural Earth layers).
- New relations: `lake_chad.shared_by` (Nigeria, Niger, Chad, Cameroon), `lake_malawi.shared_by` (Malawi, Mozambique, Tanzania), `ganges.flows_through` (India, Bangladesh).
- Verification method and source disagreements: [GEOGRAPHIC_DATA_SOURCES.md](GEOGRAPHIC_DATA_SOURCES.md#verification).

### Tooling
- `backend/prisma/checks/health_check.sql`: read-only production health report (migrations, columns, triggers, level rules, scoring rules, questions per level, knowledge objects, player info), each failure naming its fix. Tested on PGlite in four states: healthy, no content, still on v2.0, and empty.
- `backend/scripts/repair.sh`: backup, then migrations from a clone of the deployed commit (API stopped only when migrations are pending), then content import, restart and a second health check. `--check` runs the health check only. Prisma status parsing was tested against real `prisma migrate status/deploy` output.
- Found during this release: production had never had `npm run content:import` run, so levels 2–5 couldn't start (`409 no_questions`). Fixed on the server on 2026-11-18 (168 questions imported).

### Database / API changes
None. The questions reach the database through `npm run content:import`.

### Tests
`npm test`: 78 passing. `npm run content:check`: OK (95 objects, 139 relations, 168 questions; hydro 110). All 24 new map-highlight questions resolve to a map feature or point.

### Deployment
After review: on the server, from a temporary clone of `main`, `npm run content:import` (idempotent; inserts 88 questions and 4 objects, changes nothing else). No restart, no migration.

### Known issues
- AI-assisted content: a human spot-check is recommended before importing to production.

## [2.1.0] – 2026-11-18 (prepared; not yet deployed)

Recalibrated scoring and score-threshold progression. Requires a manual migration with the API stopped.

### New features
- **Lifetime score unlocking:** Level 2 at 1,000, Level 3 at 3,000, Level 4 at 6,000, Level 5 at 10,000 points (Level 6 at 15,000, documented for when it exists). Checked after every completed game in the same transaction; new unlock rule type `total_score`.
- **Player level** stored in `user_profiles.level` (highest contiguous unlocked level). Persistent across devices, never lowered (trigger), raised at login, on `/levels` and after every game.
- **Name line** on the home screen: `Ana (Score: 1,095 | Level: 2)`, refreshed after every game.
- Locked cards show threshold progress (`🔒 1,095 / 3,000 points` and a bar). The rule text on intro screens comes from the server rules.

### Modified functionality
- **Points ÷10:** Level 1 Easy `10 + min(5, streak − 1)` (max 135, was 1,350). Levels 2–5: base points ×0.1 (`pointScale`), streak bonus up to 5.
- **Level 1 Hard = 2× Easy:** `20 + min(10, 2 × (streak − 1))`, max 270. The requested "920 → 460" referred to a maximum that never existed (Hard's maximum was 1,350, the same as Easy). The owner chose 2× Normal.
- Level multipliers unchanged (×1–×5, ×N), applied after the base score, for the level the game is played in.
- Results recorded before v2.1.0 are **counted ÷10** in totals and bests (never rewritten).
- Level 1 results are validated against the rules **snapshotted** at session start (before: the mode's current rules), so a rule change never rejects a running game.
- Unlocks granted earlier by the completion rule stay.
- Device bests moved to `best2_easy`/`best2_hard` (old values ÷10).

### Database changes
- Migration `20261118000000_v2_1_score_progression`: `user_profiles.level INTEGER NOT NULL DEFAULT 1` (CHECK ≥ 1, trigger `user_profiles_level_never_decreases`), `game_results.scoring_version SMALLINT NULL` (CHECK ≥ 1). Catalog updates: `game_modes.config.scoring` of Telegram easy/hard and the four engine modes; `game_levels.unlock_rule` of levels 2–5 (only rows still holding the seeded v2.0.0 values).
- No player row updated; historical results byte-identical (tested from v1 and from v2.0.0).

### API changes (additive)
- `player.progress {totalScore, gamesPlayed, level}` in `POST /auth/telegram` and `GET /me`; `player` in `GET /levels` and `POST /sessions/:id/complete`.
- `GET /levels`: `modes[].points`, `unlockProgress`. `POST /sessions`: `session.scoring.points`; question `basePoints` on the session scale (10).
- `complete`: `result.scoringVersion`; outbox `game_result.recorded` payload gains `scoringVersion`.
- `GET /me/stats`: `totals.totalScore` (current scale), `totals.level`. `totalPoints` stays as the raw sum.
- Point values in responses are 10× smaller; mode bests are reported on the current scale.

### Bug fixes
- None found (no defects in the audited v2.0.0 code).

### Tests
`npm test`: **78 passing** (13 API, 21 scoring/validation unit, 12 content, 32 levels end to end). New: Easy = original ÷10, Hard = 2× Easy, legacy snapshots, normalization, thresholds at exactly 1,000 / 3,000 (unit and end to end), 6,000 and 10,000 end to end, new player at Level 1, repeated submissions add nothing, per-user aggregation and isolation, level never lowered (trigger and deleted results), out-of-order admin grant, upgrade from v2.0 (unlocks kept, open session finished on old rules, counted ÷10). `npm run content:check` OK. Browser check: headless Chromium, stubbed Telegram SDK, local API on PGlite. Name line, threshold progress, a perfect Easy game (+10 … +15 = 135), Level 2 unlocking at 1,095, `user_profiles.level` = 2, device best 1,110 → 111, no page errors.

### Deployment
Manual migration **with the API stopped**, then merge immediately: see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#v210-deployment-manual-steps-in-this-order). No content import.

### Known issues
- Players who reach Level 2 only through history from before v2.1.0 need 10× more play than before (by design of the ÷10 normalization).
- A Mini App page loaded before the deploy submits old-scale scores and gets "Couldn't save this game" once.
- `totalPoints` in `/me/stats` mixes scales for players with older results; use `totalScore`.
- Level 1 score is still validated (bounds), not computed, by the server.

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
