# Scoring and progression

All scoring and unlocking happens on the backend. The client never sends a multiplier, and any score it sends for Level 1 is only a *base* score that the server validates.

## Base scoring algorithm (unchanged from Atlas Quest)

Per correct answer: `100 + min(50, (streak − 1) × 10)`. A wrong answer scores 0 and resets the streak. A perfect 10-round game is **1350** base points.

Levels 2–5 use the same rule with a question's `base_points` (default 100):
```
base answer score  = round(base_points × fraction) + (fraction = 1 ? streakBonus(streak) : 0)
streakBonus(s)     = min(cap 50, (s − 1) × step 10)
final answer score = round(base answer score × level multiplier)
```
`fraction` is 1 or 0, or partial for multi-answer questions ([QUESTION_ENGINE.md](QUESTION_ENGINE.md#partial-scoring)). A partial answer earns proportional points, no streak bonus, and resets the streak (`streakNeedsFullyCorrect: true`).

**Time bonuses:** the existing game has none, so none are applied (`timeBonus: null` in the rules snapshot). Response times are recorded server-side (`game_answers.response_ms`, measured from the previous answer or the session start) for statistics and a possible future bonus.

## Level multipliers

| Level | Multiplier | 100-point answer | Perfect 10-round game |
|---|---|---|---|
| 1 Atlas Explorer | ×1 | 100 | 1,350 |
| 2 Hydro Explorer | ×2 | 200 | 2,700 |
| 3 Earth Explorer | ×3 | 300 | 4,050 |
| 4 Resource Explorer | ×4 | 400 | 5,400 |
| 5 Master Explorer | ×5 | 500 | 6,750 |

Source of truth: `game_levels.score_multiplier`. When a session starts, the backend copies the multiplier and rules into `game_sessions.score_multiplier` / `scoring_rules` (immutable by trigger). Changing a level's multiplier only affects sessions started afterwards.

### Level 1 (client-run)
1. `POST /sessions {game:"telegram_country_quiz", mode}` → snapshot ×1.
2. `POST /sessions/:id/complete {score, correctCount, bestStreak}`. The server checks that the score is possible for the correct count (`validateResult`, rules in `game_modes.config.scoring`). The checked value is the **base score**; the server stores `base_score`, `score_multiplier` and `score = round(base × multiplier)`. Extra fields such as `multiplier` are ignored.

### Levels 2–5 (question engine)
Every answer is scored when it arrives. `complete` ignores the body and sums `game_answers`: `score = Σ points`, `base_score = Σ (base + bonus)`, `correct_count` = fully correct rounds, `best_streak`. All rounds must be answered (`409 rounds_unanswered`).

## Best scores
- Per **mode**: the existing `best` (`game_modes.best_metric`; for all Telegram and level modes it is `score`). Returned by `/auth/telegram`, `/me` and `complete`.
- Per **level**: `max(score)` over the level's modes (Level 1 = best of Easy and Hard). Returned by `/levels` and `/me/stats`.
- On the device, Level 1 also keeps `best_easy`/`best_hard` in Telegram CloudStorage or localStorage, as before; the home card shows the higher of device and server.

## Historical score compatibility
- Results recorded before v2.0.0 keep their exact `score`, with `base_score` and `score_multiplier` NULL, meaning 1×. They are **never** updated or backfilled (`game_results_immutable` trigger).
- They count fully towards Level 1 best and completion. A player who played Atlas Quest before v2 finds Level 1 completed and Level 2 unlocked.
- Sessions still open during the deploy (`score_multiplier` NULL) complete with v1 behaviour.

## Level progression

### Completion (`game_levels.completion_rule`)
```json
{"minCompletedSessions": 1, "minScore": 0, "minAccuracy": 0}
```
A level is completed when the player has at least `minCompletedSessions` results in its modes with `score ≥ minScore` and `correct_count / total_rounds ≥ minAccuracy`. Derived from immutable results, so it can't be lost.

### Unlocking (`game_levels.unlock_rule`)
Current rules: Level 1 `{"type":"always"}`, Level N `{"type":"level_completed","level":N-1}`.

| Rule | Unlocks when |
|---|---|
| `{"type":"always"}` | always |
| `{"type":"level_completed","level":N}` | level N is completed |
| `{"type":"level_best_score","level":N,"min":S}` | best score in level N ≥ S |
| `{"type":"level_sessions","level":N,"min":K}` | K finished sessions in level N |
| `{"type":"all","rules":[...]}` / `{"type":"any","rules":[...]}` | combinations |
| `{"type":"admin_only"}` | only by an explicit grant |

- **Sticky:** the first time a rule is met, a `user_level_unlocks` row (`source 'rule'`) is written and a `level.unlocked` outbox event is emitted. Later, stricter rules never re-lock a level. New players are held to the new rule.
- **Administrator:** `npm run admin:unlock -- --telegram-id <id> --level <code> --by <admin>` (source `admin`).
- **Achievements:** `source 'achievement'` is reserved; achievements are ⏳.
- **Enforced** on `POST /sessions` (`403 level_locked` with the human-readable hint). Shown on the cards via `unlockHint`.

Change a rule with SQL on `game_levels` (and record it in the changelog), e.g.:
```sql
UPDATE game_levels SET unlock_rule = '{"type":"all","rules":[{"type":"level_completed","level":2},{"type":"level_best_score","level":2,"min":1600}]}'
 WHERE code = 'earth';
```

## Progress shown to players
- **Level card:** best, and a progress bar showing mastery (`distinct questions answered fully correctly / verified questions`) for levels 2–5, or completion for Level 1.
- **Statistics** (`GET /me/stats`): games, points, correct/incorrect, accuracy, average response time, unlocked and completed levels, per level, and per category (accuracy, mastered/available, completed).

## Tests
`test/scoring.test.js` (multipliers 1–5, streaks, partial, totals, validation, unlock rules) and `test/levels.test.js` (×1 and ×2 end to end, client multiplier ignored, partial ×3, duplicates, sticky and admin unlocks, v1 history).
