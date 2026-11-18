# Development guide

## Repository layout

```
index.html                   Telegram Mini App (GENERATED, don't edit)
layers/                      lazy-loaded map layers (GENERATED)
web/index.html               older Web Game (unchanged)
tools/                       build scripts: build-app, build-map, fetch-layers, build-layers
  telegram-template.html     SOURCE of index.html
backend/                     Node.js API
  src/                       app, services, engine, content pipeline
  content/                   reviewed facts and questions (JSON)
  prisma/                    schema, migrations, constraint checks
  scripts/                   content, questions, admin-unlock CLIs
  test/                      node:test suites (PGlite)
docs/                        this documentation
CLAUDE.md                    rules for AI coding sessions
```

## Setup

Requirements: Node.js `^20.19 || ^22.12 || >=24` (Prisma 7 CLI), PostgreSQL 13+ for a real database (tests don't need one).

```bash
cd backend
cp .env.example .env          # DATABASE_URL, TELEGRAM_BOT_TOKEN, SESSION_SECRET, INTERNAL_API_TOKEN (optional)
npm install
npm test                      # no database needed (PGlite)
npm run dev                   # API on 127.0.0.1:3020, restarts on change
```

Local database:
```bash
createdb atlas_quest
npm run db:migrate:deploy     # applies all migrations
npm run content:import        # facts + questions
```

Tools:
```bash
cd tools && npm install       # only needed for build-map (world-atlas)
npm run build-app             # template → ../index.html (+ backend/content/map-countries.json)
npm run fetch-layers          # Natural Earth GeoJSON → tools/.cache/
npm run build-layers          # → ../layers/*.json + backend/content/layers-index.json
npm run build-map             # world-atlas → tools/map.json (then build-app embeds it)
```
`build-app` keeps the bot username from the current `index.html` (`geoaigames_bot`) unless `BOT_USERNAME` is set.

## Commands (backend)

| Command | What it does |
|---|---|
| `npm test` | all test suites |
| `npm run dev` / `npm start` | run the API |
| `npm run db:validate` / `db:status` / `db:migrate:deploy` | Prisma schema and migrations |
| `npm run content:check` | validate `content/` (no DB) |
| `npm run content:import` | validate and import into `DATABASE_URL` |
| `npm run questions -- list [--status in_review] [--level hydro]` | review queue |
| `npm run questions -- approve <code> --by <name> [--note ".."]` | publish a draft |
| `npm run questions -- reject <code> --by <name> --note ".."` | reject a draft |
| `npm run admin:unlock -- --telegram-id <id> --level <code> --by <admin>` | grant a level |

## Database migrations

1. Edit `prisma/schema.prisma`.
2. Generate the DDL against the previous schema: `npx prisma migrate diff --from-schema <old.prisma> --to-schema prisma/schema.prisma --script`.
3. Create `prisma/migrations/<timestamp>_<name>/migration.sql`: Part 1 the generated DDL, Part 2 hand-written CHECKs and triggers.
4. Additive only. Check with `grep -iE "drop|alter column|delete|truncate"`.
5. `npm test` applies all migrations to PGlite; add tests for new constraints. Optionally run `prisma/checks/schema_checks.sql` on a local Postgres.
6. Document it in `docs/DATABASE_SCHEMA.md` (including rollback) and `docs/CHANGELOG.md`.

## Testing

`npm test` (63 tests in v2.0.0):
- `api.test.js`: Telegram auth, v1 sessions (compatibility).
- `scoring.test.js`: scoring, multipliers, partial scoring, answer validation, unlock rules, projection.
- `content.test.js`: content validity, fact derivation, rejection of contradictions.
- `levels.test.js`: levels, progression, engine sessions, duplicates, stats, internal API, v1 → v2 upgrade.

### Browser check
After a UI change, rebuild `index.html` and drive it in Chromium against a local API. The v2.0.0 release was checked this way: a small Node server served `index.html`, `layers/` and `createApp()` on PGlite with the seed content; Playwright replaced `telegram-web-app.js` with a stub carrying signed test `initData`; a full Level 1 and Level 2 game were played through the UI with screenshots. Keep such scripts outside the repo, or add them under `backend/test/` if they become part of CI.

## Deploying a release

Pushing to `main` deploys code automatically (`.github/workflows/deploy.yml`: stop service → `git reset` → `npm ci --omit=dev` → load check → start → health check). It does **not** migrate or import content.

### v2.0.0 deployment (manual steps, in this order)
The v2 API needs the v2 tables, so the database must be migrated **before** the code is deployed. The v1 API keeps working on the migrated schema (new columns are nullable and unused by v1), so migrating first is safe. Do it from a **separate temporary clone**, never from the live checkout:
```bash
# On the server, as the deploy user, BEFORE v2.0.0 reaches main:
set -a; . /home/projects/geographical-games/backend/.env; set +a        # DATABASE_URL
pg_dump "$DATABASE_URL" -Fc -f ~/backup-before-v2.0.0-$(date +%F).dump   # 1. backup
git clone --depth 1 --branch <v2.0.0 branch or tag> <repo URL> /tmp/geo-v2  # 2. separate checkout
cd /tmp/geo-v2/backend && npm ci                                          #    includes the Prisma CLI
npm run db:status                                                         # 3. expect 2 pending: 20261117000000_*, 20261117000100_*
npm run db:migrate:deploy                                                 # 4. additive migrations
npm run content:import                                                    # 5. facts + 80 questions
cd ~ && rm -rf /tmp/geo-v2
```
Then merge v2.0.0 into `main`; the workflow deploys the code and restarts the service.

Optional: set `INTERNAL_API_TOKEN` in `backend/.env` (`openssl rand -hex 32`) and restart the service to enable the n8n endpoints.

Verify after deploy:
```bash
curl -s http://127.0.0.1:3020/api/health
psql "$DATABASE_URL" -c "SELECT code, score_multiplier FROM game_levels ORDER BY number"
psql "$DATABASE_URL" -c "SELECT l.code, count(*) FROM question_bank q JOIN game_levels l ON l.id=q.level_id WHERE q.verification_status='verified' GROUP BY 1"
```
Open the Mini App: five cards; existing players see Level 2 unlocked if they have played Atlas Quest before.

Rollback: deploy the v1.4.8 commit. Leave the schema in place (v1 ignores it); full schema rollback SQL is in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#rollback-of-20261117000000--20261117000100).

### v2.1.0 deployment (manual steps, in this order)
Migration `20261118000000_v2_1_score_progression` adds `user_profiles.level` and `game_results.scoring_version` and switches the catalog to the new scoring scale and score-threshold unlocks. Unlike v2.0.0, **the old API must not run on the migrated database**: v2.0.0 code would read the new rules without knowing the new scale. It would reject Level 1 games and record engine games with odd scores, permanently. So the API stays **stopped** from the migration until the new code is deployed (a few minutes of downtime). No content import is needed.
```bash
# On the server, as the deploy user, BEFORE v2.1.0 reaches main:
set -a; . /home/projects/geographical-games/backend/.env; set +a        # DATABASE_URL
pg_dump "$DATABASE_URL" -Fc -f ~/backup-before-v2.1.0-$(date +%F).dump   # 1. backup
git clone --depth 1 --branch <v2.1.0 branch or tag> <repo URL> /tmp/geo-v21  # 2. separate checkout
cd /tmp/geo-v21/backend && npm ci
npm run db:status                                                         # 3. expect 1 pending: 20261118000000_*
sudo systemctl stop geography-game-api                                    # 4. stop the v2.0.0 API
npm run db:migrate:deploy                                                 # 5. migrate
cd ~ && rm -rf /tmp/geo-v21
```
Then **immediately** merge v2.1.0 into `main`. The workflow deploys the code and starts the service. If the deploy can't happen right away, start the old API only after rolling the catalog back ([DATABASE_SCHEMA.md](DATABASE_SCHEMA.md#rollback-of-20261118000000)).

Verify after deploy:
```bash
curl -s http://127.0.0.1:3020/api/health
psql "$DATABASE_URL" -c "SELECT number, unlock_rule FROM game_levels ORDER BY number"          # total_score 1000/3000/6000/10000
psql "$DATABASE_URL" -c "SELECT code, config->'scoring' FROM game_modes WHERE level_id IS NOT NULL ORDER BY sort_order"
psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE scoring_version IS NULL) AS legacy, count(*) AS total FROM game_results"
```
Open the Mini App: the home screen shows `Name (Score: … | Level: …)`. Existing players keep every level they had unlocked; their old scores appear ÷10. Players who still have the old page open get "Couldn't save this game" once (old-scale score rejected); reopening the Mini App fixes it.

## Health check and repair

**Check (read-only, safe any time):**
```bash
cd /home/projects/geographical-games
bash backend/scripts/repair.sh --check
# or directly:  psql "$DATABASE_URL" -f backend/prisma/checks/health_check.sql
```
This prints one row per check (`OK` / `FAIL` / `INFO`) and a `SUMMARY`: migrations applied, the columns and triggers the code needs, the five levels with their multipliers and unlock rules, the scoring rules, verified questions per level (a game needs 10), knowledge objects, and some player information. Every `FAIL` names its fix. It also works on a half-migrated or empty database. It runs in a `READ ONLY` transaction and writes nothing.

**Repair (database + reload):**
```bash
bash backend/scripts/repair.sh          # asks before changing anything; --yes to skip the prompt
```
1. `pg_dump` backup to `~/backups/geo-<date>.dump` (always, before any change).
2. A temporary clone of the **deployed** commit, taken from the live checkout, so the database is never migrated ahead of the running code. The live checkout has no Prisma CLI (`npm ci --omit=dev`), which is why the clone is needed.
3. Pending migrations: stop the API, then `prisma migrate deploy`. A failed migration, or a status it can't read, stops the script and leaves the database unchanged.
4. `npm run content:import` (idempotent).
5. Restart the service, wait for `/api/health`, run the health check again; exit 1 if anything still fails. If a step fails after the API was stopped, the API is started again.

**Migrations applied by hand (baseline):** if the health check says *"schema exists but Prisma's history (_prisma_migrations) is missing"*, the migrations were run with `psql` instead of `prisma migrate deploy`. The game works, but `migrate deploy` refuses such a database (P3005), so the next migration could never be deployed. Fix it once with:
```bash
bash backend/scripts/repair.sh --baseline
```
This records each migration as applied (`prisma migrate resolve --applied`) **only if** Prisma's drift check (`migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`) shows the database matches the schema exactly **and** every other health check passes. It changes no table and no data. Production needed this on 2026-11-18. From then on, apply migrations only with `npm run db:migrate:deploy` or `repair.sh`, never with `psql -f migration.sql`.

Why not a single SQL file: migrations must go through `prisma migrate deploy` so `_prisma_migrations` stays correct, and content import derives and validates answers in Node. So SQL is used only for checking.

`prisma/checks/schema_checks.sql` is different: it tests constraints by inserting rows (then rolls back) and is meant for local or staging databases, never production.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Levels 2–5 show "Open in Telegram to unlock" | not signed in (normal browser), or `/api/levels` failed: check `journalctl -u geography-game-api` |
| `409 no_questions` | content not imported: `npm run content:import` |
| Rivers/lakes don't appear | `layers/*.json` not served at the Mini App's origin: check Nginx static root |
| `content:check` "is not in layers-index.json" | run `npm run build-layers` in `tools/` |
| Tests hang | a `before` hook failed and left PGlite open; run one file with `node --test --test-reporter=spec test/<file>` to see the error |
| `node` fails with `Library not loaded: libsimdjson…` (macOS Homebrew) | Homebrew upgraded simdjson without rebuilding node: `brew reinstall node` |
| `/api/internal/*` → 503 | `INTERNAL_API_TOKEN` unset or shorter than 32 characters |
| Level 2–5 "Couldn't start the game" | no questions in the database (`409 no_questions`): `bash backend/scripts/repair.sh` (runs the content import) |
| Anything unclear after a deploy | `bash backend/scripts/repair.sh --check` |

## Coding conventions
See `CLAUDE.md`. In short: plain SQL with parameters; pure logic in `src/engine/`; additive migrations; codes not enums; backend decides scores and unlocks; every behaviour change comes with tests and docs.
