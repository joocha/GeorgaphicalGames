# Roadmap

Last updated: 2026-11-18 (v2.1.0 prepared, not yet deployed; v2.3.0 Level 1 pinch-to-zoom prepared).

## Completed

| Feature | Release |
|---|---|
| Atlas Quest Telegram Mini App (Find it / Name it, Easy/Hard, 10 rounds) | v1.0–v1.4 |
| Web Game with five expeditions (local only) | v1.0 |
| Express API, systemd, Nginx, GitHub Actions SSH deploy | v1.3–v1.4.8 |
| PostgreSQL schema: users, identities, catalog, sessions, append-only results, outbox | v1.4 |
| Telegram login, sessions, results, server-side result validation | v1.4.4–v1.4.6 |
| **Five-level structure, Level Selection, intro screens** | v2.0.0 |
| **Backend-controlled, configurable, sticky progression; admin unlock** | v2.0.0 |
| **Server-side multipliers ×1–×5 with per-session scoring snapshot** | v2.0.0 |
| **Question engine: 9 types, 4 answer modes, partial scoring, explanations, duplicate prevention, recent-question avoidance** | v2.0.0 |
| **Geographic knowledge base with provenance; content pipeline (check/import)** | v2.0.0 |
| **Verified sample content: 22 / 20 / 20 / 18 questions for levels 2–5** | v2.0.0 |
| **Hydro content batch 2: +88 questions (currents, depths, oceans, connections); Hydro now 110** | v2.2.0 |
| **Interactive map: pan/zoom, lazy river/lake layers, markers, multi-select, reveal** | v2.0.0 |
| **Per-level bests and progress, statistics endpoint** | v2.0.0 |
| **Level 1 pinch-to-zoom on touch screens; map view clamped to the map in all levels** | v2.3.0 |
| **n8n internal API (verified facts, AI drafts) and review CLI** | v2.0.0 |
| **Documentation system (`docs/`, `CLAUDE.md`)** | v2.0.0 |
| **Scoring ÷10, Level 1 Hard = 2× Easy, versioned score scale (history normalized on read)** | v2.1.0 |
| **Unlocking by lifetime score (1,000 / 3,000 / 6,000 / 10,000), `user_profiles.level`, name line with score and level** | v2.1.0 |

## Current stage

Phase A (platform foundation) and Phase B (question engine) are complete. Phases C–F have the reusable architecture and a small verified sample each. v2.1.0 adds score-threshold progression on top. Next: deploy v2.0.0 (if not live yet) and v2.1.0 (manual migrations), then a human review of the seed questions.

## Next priorities

1. **Deploy v2.1.0** (migration with the API stopped) following [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#v210-deployment-manual-steps-in-this-order); if v2.0.0 isn't live yet, do its steps first. Spot-check the 80 seed questions.
2. **Statistics UI**: a profile screen using `GET /me/stats` (backend exists, no screen yet).
3. **Outbox dispatcher** to n8n (design in `backend/docs/database.md` §7); then the draft-generation workflow using `/internal/geo-objects` and `/internal/question-drafts`.
4. **More content per level** (target ≥ 60 verified questions each) so repeats become rare. Hydro: done (110). Earth, Resources, Master: still 20 / 20 / 18.
5. **Level 1 neighbour and border questions** through the engine (country-neighbour data already exists in `map-countries.json`).

## Planned features

- Phase C+ (Hydro): more rivers, basins and seas; a sea/ocean polygon layer (Natural Earth `marine_polys`).
- Phase D+ (Earth): a mountain-range polygon layer (Natural Earth `geography_regions_polys`), mountain roads.
- Phase E+ (Resources): oil, natural gas and coal statistics (choose EIA or the Energy Institute), diamonds production (Kimberley Process), a deposit layer.
- Phase F+ (Master): megacities (choose one definition and source), trade-route lines, climate-zone polygons.
- Achievements (tables sketched in `backend/docs/database.md` §9; `user_level_unlocks.source = 'achievement'` reserved).
- Leaderboards per level (queries exist in `backend/docs/database.md` §8; rank by `progressScoreSql()` so old and new results compare fairly).
- Level 6 (unlock at 15,000 lifetime points; rule type `total_score` ready).
- Session length choice in the UI (backend supports `allowedRounds`).
- Time limits and time bonus (`time_limit_sec`, `timeBonus` reserved).
- AI hints, adaptive difficulty, category recommendations (n8n).
- Multilingual questions (Georgian first; `language` column exists).
- Move Level 1 into the question engine so its score is computed, not just bounds-checked, by the server.

## Known technical limitations

- Level 1 scores are validated (bounds), not computed, on the server.
- Micro-states are not tappable on the 1:110m map.
- No CI test run before deploy: `deploy.yml` deploys on push without running `npm test`. Add a test job.
- Migrations and content import are manual steps.
- Response time is measured between answers on the server (includes reading the previous explanation).
- The seed questions were written with AI assistance from verified facts; human review recommended.
- `GET /levels` writes (sticky unlocks) inside a GET request; it is idempotent but not a pure read.

## Future improvements

MapLibre GL / vector tiles if layers grow beyond what SVG handles comfortably; PostGIS if spatial queries become necessary; a staging environment; Prisma drift check in CI.
