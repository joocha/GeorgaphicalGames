# CLAUDE.md: permanent instructions for Claude Code

## What GeoAIGames is

GeoAIGames is a geography learning platform played mainly as a **Telegram Mini App** (`t.me/geoaigames_bot/play`). It began as *Atlas Quest*, a 10-round country-shape quiz, which is now **Level 1 · Atlas Explorer** of a five-level structure:

| # | Level | Multiplier | How it is played |
|---|---|---|---|
| 1 | Atlas Explorer | ×1 | Client-run Atlas Quest (Easy/Hard); the server validates the result |
| 2 | Hydro Explorer | ×2 | Server-run question engine |
| 3 | Earth Explorer | ×3 | Server-run question engine |
| 4 | Resource Explorer | ×4 | Server-run question engine |
| 5 | Master Explorer | ×5 | Server-run question engine |

It is a **production application with real players**. Treat every change as a change to a live system.

## Architecture in one paragraph

`index.html` (repo root) is the whole Mini App: a single static HTML file **generated** from `tools/telegram-template.html` by `tools/build-app.js`, with the world map embedded. Map layers (rivers, lakes) are static JSON files in `layers/`, loaded lazily. Nginx serves the static files and proxies `/api/` to the Node.js/Express backend in `backend/` (127.0.0.1:3020, systemd). The backend uses PostgreSQL through plain SQL (`pg`). Prisma owns only the schema and migrations. Geographic knowledge and questions live as reviewed JSON in `backend/content/` and are imported into the database by `npm run content:import`. A transactional outbox (`outbox_events`) is the hand-off point to n8n. `web/index.html` is a separate, older browser game that stays as it is.

## Read before you change anything

1. This file.
2. `docs/SYSTEM_ARCHITECTURE.md`: components and data flows.
3. The document for the area you touch:
   - Gameplay and levels: `docs/GAME_DESIGN.md`
   - Points and unlocking: `docs/SCORING_AND_PROGRESSION.md`
   - Questions: `docs/QUESTION_ENGINE.md`
   - Tables and migrations: `docs/DATABASE_SCHEMA.md` (and `backend/docs/database.md` for v1 constraints in detail)
   - Facts, sources and licences: `docs/GEOGRAPHIC_DATA_SOURCES.md`
   - Endpoints: `docs/API_REFERENCE.md`
   - Setup, testing and deployment: `docs/DEVELOPMENT_GUIDE.md`
   - Public documentation, versions and releases: `docs/README.md`, `docs/RELEASE_PROCESS.md`
4. `docs/ROADMAP.md` (what exists, what doesn't) and the top of `docs/CHANGELOG.md`.
5. The actual code. If the code and the docs disagree, the code is the truth. Fix the docs in the same change.

Before coding, check whether the request conflicts with a documented decision (the "Decisions" sections). If it does, say so and record the change of decision (see below).

## Non-negotiable rules

### Database safety
- **Never** delete or rewrite production data. Never reset user profiles, never update historical scores. `game_results` is append-only and protected by a trigger.
- Migrations must be **additive** (new tables, new NULLABLE columns, new indexes). Generate DDL with `prisma migrate diff`, add CHECKs and triggers by hand (Part 2 of a migration), and never edit an applied migration.
- Never run `prisma migrate dev`, `migrate reset` or `db push` against a shared database. Production migrations are applied **manually** by an administrator after `pg_dump` (`npm run db:migrate:deploy`). `deploy.yml` never migrates.
- Test every migration on PGlite (`npm test` applies them all) and against a v1-shaped database (see `test/levels.test.js`, "upgrade from v1").

### Scoring
- Scores are computed **on the backend**. Never trust a score, multiplier or correctness flag from the client.
- `final = round((base points × fraction + streak bonus) × level multiplier)`. The multiplier is applied once, after the base score.
- The multiplier and rules are **snapshotted** into `game_sessions` when a session starts. Configuration changes never alter running or finished sessions.
- Pre-v2 results have `base_score`/`score_multiplier` = NULL and mean exactly what they meant before (1×). Never backfill or reinterpret them.

### Facts and AI
- The verified knowledge base (`backend/content/*.json` → `geo_objects`, `geo_object_countries`, `geo_object_links`, `country_resource_stats`) is the source of truth.
- Never publish an unverified fact. Every fact and question names a source; every statistic names its year and is labelled `mine_production`, `reserves` or `identified_resources`. Never mix them.
- Do not invent geographic facts in code, content or docs. If you can't verify a fact against a primary or encyclopedic source, don't add it.
- AI (via n8n) may only write **drafts** (`in_review`). A person approves them with `npm run questions -- approve`. Answer validation never calls AI.

### Deployment
- Pushing to `main` **deploys to production** (`.github/workflows/deploy.yml`). Don't push or merge without the owner's explicit request.
- The deploy restarts the API but does **not** migrate or import content. A release that needs a migration must document the manual steps in `docs/CHANGELOG.md` and `docs/DEVELOPMENT_GUIDE.md`.
- Never edit `index.html` by hand. Edit `tools/telegram-template.html` and run `cd tools && npm run build-app`.

## Coding conventions

- Backend: Node.js ESM, Express 5, plain parameterized SQL through `pg`, no ORM client. Business rules live in `src/services/` and pure logic in `src/engine/` (unit-testable, no I/O). Errors are `HttpError(status, code, message)`.
- Database: snake_case, `uuid` keys, `timestamptz`, string codes checked with `^[a-z][a-z0-9_]*$` instead of enums, CHECK constraints for invariants.
- Frontend: one dependency-free HTML file, Telegram theme variables, mobile first, rounded cards. Reuse the existing CSS tokens (`--bg`, `--bg2`, `--accent`, `--good`, `--bad`, `--hl`). Keep Level 1's game code untouched unless the change is about Level 1.
- Comments say *why*. Keep functions small. Don't add dependencies or infrastructure without a documented reason.

## Testing requirements

`cd backend && npm test` must pass before any change is considered done. It runs:
- `test/api.test.js`: Telegram auth and the v1 game flow (backward compatibility).
- `test/scoring.test.js`: scoring, multipliers, partial scoring and answer validation (unit).
- `test/content.test.js`: content validation and fact derivation.
- `test/levels.test.js`: levels, unlocking, question engine, duplicates, statistics, the internal API and the v1 → v2 upgrade (end to end on PGlite).

Add tests with every behavioural change. Also run `npm run content:check` after editing content. For UI changes, rebuild `index.html` and check it in a browser (see `docs/DEVELOPMENT_GUIDE.md`, "Browser check").

## Public documentation and releases

**DOCUMENTATION IS A MANDATORY PART OF EVERY RELEASE.**

Every developer or AI coding agent modifying Geo AI Games must:
1. Analyze the impact of the changes on existing documentation.
2. Update affected documentation sections.
3. Add the changes to the corresponding release notes.
4. Preserve historical documentation.
5. Follow the project's semantic versioning rules.
6. Ensure the documentation website and AI Knowledge Base remain synchronized.

A game release must not be considered fully documented until its documentation has been generated, validated and published.

How, in this repository:
- The public documentation (`docs-site/`, published at `https://docs.geoaigames.joocha.com/`) is the players' and the AI Assistant's source of truth. Read `docs/README.md` first, then `docs/DOCUMENTATION_GUIDELINES.md`, `docs/VERSIONING.md` and `docs/RELEASE_PROCESS.md`.
- While working: add player-facing notes to `docs-site/release-notes/NEXT.md`.
- For a release: bump `backend/package.json`, run `node docs-site/tools/docs.js generate`, verify every page the evidence report (`docs-site/reviews/vX.Y.Z.md`) names against the code, remove the REVIEW markers, `validate --strict`, then `freeze X.Y.Z`. Commit `docs-site/` with the release.
- Never edit a final version in `docs-site/versions/` (checksums make them immutable; corrections go into the next version). Never publish secrets, infrastructure details or personal data. Never document a feature that doesn't exist.
- `deploy.yml` publishes the documentation of the deployed app version after the API is healthy; a docs failure keeps the previous docs online and fails the job.
- `cd docs-site && npm test` must pass whenever `docs-site/` changes.

## Documentation workflow (part of every task)

**Before:** read the docs listed above and inspect the affected code.
**During:** update the docs when you change architecture, tables, endpoints, question types, scoring or progression.
**After:**
1. Add an entry to `docs/CHANGELOG.md` (version, date, features, changes, DB, API, fixes, known issues, test results).
2. Update `docs/ROADMAP.md` to the real status.
3. For a player-visible change: release notes in `docs-site/release-notes/NEXT.md` and, for the release, the public documentation (see "Public documentation and releases").
4. Check the docs against the code. Never document something as done unless it exists and is tested.
5. Report what was completed and what was not.

**When a design decision changes,** don't silently overwrite it. Add a dated entry under "Decisions" in the relevant document with: previous approach, new approach, reason, migration implications.

Versioning is SemVer. History: v1.0 … v1.4.8 (Atlas Quest), **v2.0.0** (five-level platform). Bump `backend/package.json` with each release.
