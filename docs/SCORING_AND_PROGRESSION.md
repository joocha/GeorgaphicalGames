# Scoring and progression

All scoring and unlocking happens on the backend. The client never sends a multiplier, and any score it sends for Level 1 is only a *base* score that the server validates against the session's rules.

## Base scoring (v2.1.0 scale)

v2.1.0 divided every point value by 10 and made Level 1 Hard pay double. Every rule lives in the database (`game_modes.config.scoring`), and each session takes a snapshot of it when it starts.

| Mode | Per correct answer | Perfect 10-round game (base) | Before v2.1.0 |
|---|---|---|---|
| Level 1 Easy (normal) | `10 + min(5, streak − 1)` | **135** | `100 + min(50, (streak − 1) × 10)`, 1,350 |
| Level 1 Hard | `20 + min(10, 2 × (streak − 1))` | **270** | same as Easy, 1,350 |
| Levels 2–5 | `round(base_points × 0.1 × fraction) + min(5, streak − 1)` | **135** | `base_points × fraction + min(50, …)`, 1,350 |

A wrong answer scores 0 and resets the streak. Hard is exactly 2× Easy for every correct answer (10/11/12/13/14/15… → 20/22/24/26/28/30…).

Levels 2–5 in detail:
```
base answer score  = round(base_points × pointScale × fraction) + (fraction = 1 ? streakBonus(streak) : 0)
streakBonus(s)     = min(streakBonusCap 5, (s − 1) × streakBonusPerStep 1)
final answer score = round(base answer score × level multiplier)
```
Question `base_points` stay authored on the original scale (100 = a normal question) and are scaled by `pointScale: 0.1`. Content therefore didn't need editing or re-importing. `fraction` is 1, 0, or partial for multi-answer questions ([QUESTION_ENGINE.md](QUESTION_ENGINE.md#partial-scoring)). A partial answer earns proportional points, gets no streak bonus, and resets the streak (`streakNeedsFullyCorrect: true`). With 10 points per question, partial points round to whole points (half of 10 = 5).

**Time bonuses:** none (`timeBonus: null`). Response times are recorded server-side (`game_answers.response_ms`) for statistics and a possible future bonus.

## Level multipliers

`final score = base score × level multiplier`, applied once, after the base score, in every mode of the level. Level N = ×N.

| Level | Multiplier | 10-point answer | Perfect game: Easy / engine | Perfect game: Hard |
|---|---|---|---|---|
| 1 Atlas Explorer | ×1 | 10 | 135 | 270 |
| 2 Hydro Explorer | ×2 | 20 | 270 | – |
| 3 Earth Explorer | ×3 | 30 | 405 | – |
| 4 Resource Explorer | ×4 | 40 | 540 | – |
| 5 Master Explorer | ×5 | 50 | 675 | – |

Source of truth: `game_levels.score_multiplier`. When a session starts, the backend copies the multiplier and rules into `game_sessions.score_multiplier` / `scoring_rules` (immutable by trigger). The multiplier is that of the level the game is **played** in, not the level the game unlocks. Changing a level's multiplier or a mode's rules only affects sessions started afterwards.

### Level 1 (client-run)
1. `POST /sessions {game:"telegram_country_quiz", mode}` → snapshot ×1 and the mode's rules (`scoring_rules.version = 2`).
2. `POST /sessions/:id/complete {score, correctCount, bestStreak}`. The server checks that the score is possible for the correct count under the **snapshotted** rules (`validateResult`). For example, 3 correct answers on Easy must score 30–33. The checked value is the **base score**. The server stores `base_score`, `score_multiplier`, `scoring_version` and `score = round(base × multiplier)`. Extra fields such as `multiplier` or `userId` are ignored.

The Mini App reads the per-mode points from `GET /levels` (`modes[].points`) and keeps identical fallback values for offline play.

### Levels 2–5 (question engine)
Every answer is scored when it arrives. `complete` ignores the body and sums `game_answers`: `score = Σ points`, `base_score = Σ (base + bonus)`, `correct_count` = fully correct rounds, `best_streak`. All rounds must be answered (`409 rounds_unanswered`).

## Scale versions and historical results

| `scoring_version` | Meaning | Counted in totals and bests as |
|---|---|---|
| NULL | Recorded before v2.1.0 (v1 and v2.0.0), original scale | `round(score / 10)` |
| 1 | Session started on v2.0.0 rules, finished after the upgrade | `round(score / 10)` |
| 2 | v2.1.0 scale | `score` |

- Stored scores are **never** updated or backfilled (`game_results_immutable` trigger). Normalization happens only on read: `progressScoreSql()` in `backend/src/services/progression.js` and `progressScore()` in `backend/src/engine/scoring.js`.
- Example: a v1 perfect Easy game stored as 1,350 counts as 135, and a v2.0.0 Level 2 game stored as 2,700 counts as 270.
- Results of pre-v2 sessions mean exactly what they meant before (1×). `base_score`/`score_multiplier` stay NULL.
- A session started before the upgrade completes with the rules it started with (snapshot), and its result gets `scoring_version` 1.
- Device bests (Telegram CloudStorage / localStorage) moved from `best_easy`/`best_hard` to `best2_easy`/`best2_hard`. Old values are read once and divided by 10.

## Best scores
- Per **mode**: `game_modes.best_metric`; for all Telegram and level modes it is `score`, compared on the current scale. Returned by `/auth/telegram`, `/me` and `complete`.
- Per **level**: the max (current scale) over the level's modes (Level 1 = best of Easy and Hard). Returned by `/levels` and `/me/stats`.

## Level progression

### Lifetime score
```sql
SELECT sum(CASE WHEN r.scoring_version >= 2 THEN r.score ELSE round(r.score / 10.0)::int END)
  FROM game_results r WHERE r.user_id = $1          -- the authenticated player only
```
Every completed game of the player counts, in any level or game. It is computed from `game_results` every time and never stored, so it can't drift. There is no separate scoring table.

### Unlocking (`game_levels.unlock_rule`)
Current rules (cumulative lifetime score, not the score of one game):

| Current level | Required lifetime score | Unlocks |
|---|---:|---|
| 1 | 1,000 | Level 2 · `{"type":"total_score","min":1000}` |
| 2 | 3,000 | Level 3 · `{"type":"total_score","min":3000}` |
| 3 | 6,000 | Level 4 · `{"type":"total_score","min":6000}` |
| 4 | 10,000 | Level 5 · `{"type":"total_score","min":10000}` |
| 5 | 15,000 | Level 6 (planned): add the level with `{"type":"total_score","min":15000}` |

Available rule types:

| Rule | Unlocks when |
|---|---|
| `{"type":"always"}` | always (Level 1) |
| `{"type":"total_score","min":S}` | lifetime score ≥ S |
| `{"type":"level_completed","level":N}` | level N is completed |
| `{"type":"level_best_score","level":N,"min":S}` | best score in level N ≥ S |
| `{"type":"level_sessions","level":N,"min":K}` | K finished sessions in level N |
| `{"type":"all","rules":[...]}` / `{"type":"any","rules":[...]}` | combinations |
| `{"type":"admin_only"}` | only by an explicit grant |

- **Checked after every completed game,** in the same transaction that records the result (`progressAfterResult`), and also on `GET /levels` and at login.
- **Sticky:** the first time a rule is met, a `user_level_unlocks` row (`source 'rule'`) is written and a `level.unlocked` outbox event is emitted. Later, stricter rules or lower totals (e.g. a removed result) never re-lock a level. New players are held to the new rule.
- **Enforced** on `POST /sessions` (`403 level_locked` with the human-readable hint, e.g. "Reach 1,000 total points to unlock").
- **Administrator:** `npm run admin:unlock -- --telegram-id <id> --level <code> --by <admin>` (source `admin`).
- **Achievements:** `source 'achievement'` is reserved; achievements are ⏳.

### Player level (`user_profiles.level`)
- The highest N such that levels 1..N are all unlocked. Every player starts at 1.
- Raised (never lowered) whenever unlocks are evaluated. The `user_profiles_level_never_decreases` trigger blocks any decrease in the database too.
- Counts as an unlock: every level ≤ `level` is playable even if its row in `user_level_unlocks` were missing.
- An out-of-order administrator grant (e.g. only Level 5) does not raise it, so it never opens the levels in between.
- Capped at the highest existing level: a threshold for Level 6 raises nothing until Level 6 exists.
- Concurrency: the profile row is locked (`FOR UPDATE`) before totals are read, so two games finishing at the same moment are evaluated one after the other.
- Existing players start at 1 after the migration, and their level catches up from their existing unlocks at the next login or `/levels` call.

### Completion (`game_levels.completion_rule`)
```json
{"minCompletedSessions": 1, "minScore": 0, "minAccuracy": 0}
```
Completion is still computed and shown on cards ("Completed") and in statistics, but no current unlock rule depends on it. `minScore` is compared on the current scale.

Change a rule with SQL on `game_levels` (and record it in the changelog), e.g.:
```sql
UPDATE game_levels SET unlock_rule = '{"type":"all","rules":[{"type":"total_score","min":3000},{"type":"level_completed","level":2}]}'
 WHERE code = 'earth';
```

### Security
- Scores, multipliers, unlocks and the level are computed by the backend only. The client and AI agents (n8n) have no endpoint that writes them.
- The user is always the one in the bearer token. A `userId` in a request body is ignored.
- Duplicate submissions: a session completes once (`FOR UPDATE` + `409 session_closed`), `game_results.session_id` is UNIQUE, and engine rounds are answered once (`409 round_already_answered`, trigger).

## Shown to players
- **Name line** (home screen): `Ana (Score: 5,250 | Level: 3)`, from `player.progress` (login, `/me`), `player` (`/levels`, `complete`). Refreshed after every game.
- **Level card:** best, a progress bar (mastery for levels 2–5, completion for Level 1). When locked by a score threshold: `🔒 1,095 / 3,000 points` with a bar (`unlockProgress`).
- **Statistics** (`GET /me/stats`): `totalScore` (current scale), `level`, games, correct/incorrect, accuracy, average response time, unlocked and completed levels, per level, per category.

## Extending
- New level: insert a `game_levels` row with its multiplier and a `total_score` rule; the player level follows automatically.
- New difficulty mode: a `game_modes` row with its own `config.scoring`.
- Rescaling again: bump `SCORING_VERSION` and extend `progressScore()` / `progressScoreSql()` with the new divisor. Never rewrite results.
- Bonuses (time bonus, achievements): add to the rules snapshot (`timeBonus` is reserved) so they are versioned with the session.
- Leaderboards: rank by the same `progressScoreSql()` expression so that old and new results compare fairly.

## Decisions

### 2026-11-18: points ÷10, Hard ×2, unlocking by lifetime score (v2.1.0)
- **Previous approach:** 100 points per correct answer (+ streak bonus up to 50) in every mode, so Easy and Hard were identical (max 1,350). Level N unlocked when Level N−1 was completed (one finished game). There was no stored player level.
- **New approach:** 10 per answer (+ up to 5), Hard 20 (+ up to 10). Levels 2–5 unlock at 1,000 / 3,000 / 6,000 / 10,000 lifetime points (Level 6 at 15,000 once it exists). `user_profiles.level` stores the highest contiguous unlocked level.
- **Reason:** owner request (2026-11-18). Hard should reward its difficulty, and progress should reflect accumulated play, not one game. The request's Hard target ("920 → 460") referred to a maximum that never existed (Hard's maximum was 1,350, the same as Easy). The owner chose "Hard = 2× Normal" instead of the literal 460 or "1,350 ÷ 2".
- **Migration implications:** migration `20261118000000_v2_1_score_progression`. Old results are not rewritten; they count ÷10 on read (owner's choice over "count as stored", which would have unlocked Level 2 for anyone with one old perfect game). Unlocks already granted under the completion rule stay. Existing `game_modes.config.scoring` and `game_levels.unlock_rule` rows are replaced only where they still hold the seeded v2.0.0 values. The API must be stopped while migrating (see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#v210-deployment-manual-steps-in-this-order)).

## Tests
`test/scoring.test.js`: Easy = original ÷10, Hard = 2× Easy, multipliers, legacy snapshots, normalization, thresholds at exactly 1,000/3,000, contiguous level. `test/levels.test.js`: migration rules, new player at Level 1, crossing 1,000, 3,000, 6,000 and 10,000 with real games, repeated submissions, per-user aggregation, never-lowered level (trigger and deleted results), sticky unlocks, admin grants, and upgrades from v1 and from v2.0.0 (unlocks kept, running game finished on old rules). `test/api.test.js`: v1 flow on the new scale.
