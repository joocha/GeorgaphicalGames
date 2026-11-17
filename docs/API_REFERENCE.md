# API reference

Base path `/api` (Nginx proxies it to `127.0.0.1:3020`). JSON in and out. Examples below are real responses captured from the test harness, trimmed.

## Authentication

| Kind | How | Used by |
|---|---|---|
| Player | `Authorization: Bearer <token>` from `POST /auth/telegram`. HMAC-signed, stateless, lifetime `SESSION_TTL_SECONDS` | all player endpoints |
| Internal | `Authorization: Bearer <INTERNAL_API_TOKEN>` (≥ 32 chars; endpoints answer 503 when unset) | n8n, `/internal/*` |

Player identity comes **only** from the verified Telegram `initData`, never from request fields.

## Errors

`{"error": "<message>", "code": "<code>"}`

| Status | Codes |
|---|---|
| 400 | `invalid_request` (malformed codes), `not_question_engine`, Express JSON errors |
| 401 | `invalid_init_data`, `init_data_expired`, `unauthorized` |
| 403 | `level_locked` (message = how to unlock) |
| 404 | `session_not_found`, `mode_not_found`, `round_not_found`, `object_not_found`, `level_not_found`, `Not found` |
| 409 | `session_closed`, `round_already_answered`, `round_out_of_order`, `rounds_unanswered`, `no_questions`, `draft_exists` |
| 422 | `invalid_result`, `invalid_answer`, `invalid_rounds`, `invalid_draft` |
| 503 | `database_not_configured`, `auth_not_configured`, `internal_api_not_configured` |
| 500 | `internal_error` |

## Endpoints

| Method and path | Auth | Since |
|---|---|---|
| `GET /health` | none | v1.3 |
| `POST /auth/telegram` | none | v1.4.4 |
| `GET /me?game=<code>` | player | v1.4.4, extended in v2.1.0 |
| `GET /me/stats` | player | **v2.0.0**, extended in v2.1.0 |
| `GET /levels` | player | **v2.0.0**, extended in v2.1.0 |
| `POST /sessions` | player | v1.4.4, extended in v2.0.0 |
| `POST /sessions/:id/answers` | player | **v2.0.0** |
| `POST /sessions/:id/complete` | player | v1.4.4, extended in v2.0.0 |
| `POST /sessions/:id/abandon` | player | v1.4.4 |
| `GET /internal/geo-objects/:code` | internal | **v2.0.0** |
| `POST /internal/question-drafts` | internal | **v2.0.0** |

All v1 request and response shapes still work; v2 only **adds** fields. v2.1.0 changed point **values** (÷10; see [SCORING_AND_PROGRESSION.md](SCORING_AND_PROGRESSION.md)): a Level 1 client must submit scores on the session's scale, and older results are reported ÷10 in bests and totals.

**Player progress** (v2.1.0), included as `player.progress` (login, `/me`) or `player` (`/levels`, `complete`):
```json
{ "totalScore": 1095, "gamesPlayed": 2, "level": 2 }
```
`totalScore` is the lifetime score on the current scale. `level` is `user_profiles.level`. The Mini App shows them as `Ana (Score: 1,095 | Level: 2)`.

### `GET /health`
`200 {"status":"ok","uptime":123}`

### `POST /auth/telegram`
Body `{initData, platform?, version?}` → `201` (new) / `200`: `{token, expiresAt, player:{id, isNew, profile:{displayName, avatarUrl, locale}, telegram:{id, username}, progress}, bests:{telegram_country_quiz:{easy:{metric,best,plays,lastPlayedAt}, hard:{...}}}}`. v2.1.0 adds `player.progress` and brings `user_profiles.level` up to date at login. See `backend/README.md`.

### `GET /me?game=<code>`
`{player:{id, profile, progress}, bests:{<game>:{<mode>:{metric, best, plays, lastPlayedAt}}}}`. Read-only (it doesn't raise the level). `best` of `score` modes is on the current scale.

### `GET /levels`
All levels with the player's state. Also records newly met unlock rules (sticky) and raises `user_profiles.level`.
```json
{ "levels": [ {
  "number": 2, "code": "hydro", "name": "Hydro Explorer", "icon": "💧", "multiplier": 2,
  "shortDescription": "Rivers, lakes, waterfalls, seas, straits and canals.", "description": "Follow the water. ...",
  "categories": [ {"code":"rivers","name":"Rivers","questions":10}, {"code":"river_basins","name":"River basins","questions":1} ],
  "rounds": 10, "engine": "question_engine",
  "modes": [ {"game":"explorer_levels","code":"hydro","name":"Hydro Explorer","difficulty":null,"rounds":10,"best":null,"plays":0,
              "points": {"correct":10,"streakBonusPerStep":1,"streakBonusCap":5,"maxScore":null}} ],
  "unlocked": true, "unlockSource": "rule", "unlockHint": "Reach 1,000 total points to unlock",
  "unlockProgress": {"score": 1095, "required": 1000},
  "completed": false, "best": null,
  "progress": { "plays": 0, "best": null, "lastPlayedAt": null, "completedSessions": 0, "requiredSessions": 1,
                "completed": false, "accuracy": null, "mastery": { "mastered": 0, "total": 22 } }
} ], "newlyUnlocked": [], "player": {"totalScore": 1095, "gamesPlayed": 2, "level": 2} }
```
Level 1 has `engine: "client"`, `modes` easy/hard (`points.correct` 10 / 20, `maxScore` 135 / 270), `categories[].questions = null`, `mastery = null`. `unlockProgress` is set for levels whose rule is `total_score` (otherwise `null`). `modes[].points` (v2.1.0) is what the Mini App displays and uses to count Level 1 points; the server still validates.

### `POST /sessions`
Body, either form:
- `{game, mode, clientPlatform?}`: v1 form (Level 1: `{"game":"telegram_country_quiz","mode":"easy"}`).
- `{level, mode?, rounds?, clientPlatform?}`: v2 form (`{"level":"hydro"}`). `rounds` must be in the level's `session_config.allowedRounds`.

Closes the player's other unfinished sessions of the same game as `abandoned`. `403 level_locked` if the level isn't unlocked; `409 no_questions` if an engine level has no published questions.
```json
{ "session": { "id": "5bf4c657-…", "status": "in_progress", "clientPlatform": "telegram", "startedAt": "…",
               "game": "explorer_levels", "mode": "hydro", "roundsPerSession": 10, "bestMetric": "score",
               "level": {"code":"hydro","number":2,"name":"Hydro Explorer"},
               "scoring": {"multiplier":2,"engine":"question_engine","points":{"correct":10,"streakBonusPerStep":1,"streakBonusCap":5,"maxScore":null}} },
  "questions": [ { "round": 0, "type": "MULTIPLE_CHOICE", "answerMode": "options", "multi": true, "category": "straits",
                   "difficulty": 2, "text": "Which two seas does the Bosporus in Istanbul connect?", "description": null,
                   "basePoints": 10, "timeLimitSec": null,
                   "options": [{"id":"o1","label":"Black Sea"},{"id":"o2","label":"Sea of Marmara"},{"id":"o4","label":"Caspian Sea"},{"id":"o3","label":"Aegean Sea"}],
                   "map": {"focus":null,"layers":[],"highlightCountries":[],"object":null}, "dataYear": null } ],
  "abandonedSessions": 0 }
```
`questions` is present only for question-engine levels. `basePoints` is on the session's scale (v2.1.0: authored 100 × 0.1). For Level 1 Easy, `scoring` is `{"multiplier":1,"engine":"client_validated","points":{"correct":10,"streakBonusPerStep":1,"streakBonusCap":5,"maxScore":135}}` (Hard: 20/2/10/270). For modes outside the level structure (the Web Game), `level` and `scoring` are `null` (v1 behaviour).

Map fields: `focus` = `{bbox:[minX,minY,maxX,maxY]}` in map coordinates, `{countries:[...]}` or `null` (world); `layers` = layer files to load; `object` = `{kind:"point",x,y}` or `{kind:"feature",layer,featureId,bbox}`, only when the question shows it.

### `POST /sessions/:id/answers` (question engine)
Body `{round, answer}`, with `answer` per mode: `{optionIds:[...]}`, `{countries:[...]}` or `{pairs:[{left,right}]}`. Rounds in order, each once.
```json
{ "round": 0, "isCorrect": true, "fraction": 1, "basePoints": 10, "streakBonus": 0, "multiplier": 2, "points": 20,
  "streak": 1, "score": 20, "answeredRounds": 1, "totalRounds": 10, "responseMs": 5400,
  "correct": {"optionIds":["o1","o2"],"labels":["Black Sea","Sea of Marmara"]},
  "offMapAnswers": [],
  "explanation": "The Bosporus connects the Black Sea to the Sea of Marmara and forms part of the boundary between Europe and Asia.",
  "object": {"name":"Bosporus","type":"strait","shape":{"kind":"point","x":580.8,"y":135.8}},
  "source": {"name":"Wikipedia (English)","url":"https://en.wikipedia.org/","year":null} }
```
`correct` is `{countries:[...]}` for map modes and `{pairs, labels}` for matching. Errors: `409 round_out_of_order | round_already_answered | session_closed`, `404 round_not_found`, `422 invalid_answer`, `400 not_question_engine`.

### `POST /sessions/:id/complete`
- Level 1 / client-run: body `{score, correctCount, bestStreak?, stars?, details?}`. `score` is the **base** score; it is checked against the rules the session started with (e.g. Easy, 3 correct: 30–33), then multiplied.
- Question engine: no body needed (anything sent is ignored); `409 rounds_unanswered` if a round is open.
```json
{ "result": { "id": "458fce5d-…", "sessionId": "5bf4c657-…", "score": 270, "baseScore": 135, "scoreMultiplier": 2, "scoringVersion": 2,
              "correctCount": 10, "totalRounds": 10, "stars": null, "bestStreak": 10, "xpEarned": null, "durationMs": 44, "completedAt": "…" },
  "player": {"totalScore": 3000, "gamesPlayed": 9, "level": 3},
  "best": {"metric":"score","value":270,"previous":null,"isNew":true},
  "level": {"code":"hydro","number":2,"completed":true,"best":270,"progress":{"…":"as in /levels"}},
  "unlocked": [{"code":"earth","number":3,"name":"Earth Explorer"}] }
```
`level` and `unlocked` appear for sessions that belong to a level. `player` (v2.1.0) is always present and includes this game. Unlock thresholds are checked and `user_profiles.level` is raised in the same transaction as the result. Writes `game_result.recorded` (payload adds `level`, `baseScore`, `scoreMultiplier`, and since v2.1.0 `scoringVersion`) and, per new unlock, `level.unlocked` to the outbox. Second call → `409 session_closed`, and no points are added.

### `POST /sessions/:id/abandon`
`204`; `409` if already finished; `404` unknown.

### `GET /me/stats`
```json
{ "totals": { "gamesPlayed": 1, "totalScore": 270, "level": 1, "totalPoints": 270, "correctAnswers": 10, "incorrectAnswers": 0, "accuracy": 100,
              "averageResponseMs": 4100, "lastPlayedAt": "…", "unlockedLevels": [1], "completedLevels": [2] },
  "levels": [ {"number":2,"code":"hydro","gamesPlayed":1,"best":270,"accuracy":100,"completed":true,"unlocked":true,"mastery":{"mastered":10,"total":22}} ],
  "categories": [ {"level":"hydro","category":"lakes","answered":1,"correct":1,"accuracy":100,"mastered":1,"available":4,"completed":false} ] }
```
`averageResponseMs` and `categories` cover question-engine rounds only. `totalScore` (v2.1.0) is the lifetime score on the current scale, the value used for unlocking. `totalPoints` is the raw `SUM(score)` as stored (it mixes scales for players with pre-v2.1 results) and is kept for compatibility.

### `GET /internal/geo-objects/:code`
Verified facts only.
```json
{ "object": {"code":"bosporus","object_type":"strait","name":"Bosporus","lat":41.12,"lon":29.08,"wikidata_id":"Q35958","properties":{},"data_year":null,"source":"wikidata","source_name":"Wikidata"},
  "countries": [{"relation":"located_in","country":"Turkey","is_on_map":true,"source":"wikidata","note":null}],
  "links": [{"relation":"connects","code":"black_sea","name":"Black Sea","source":"wikipedia"},{"relation":"connects","code":"sea_of_marmara","name":"Sea of Marmara","source":"wikipedia"}],
  "stats": [] }
```

### `POST /internal/question-drafts`
Body `{level, question, generator?}`, where `question` uses the content-file format ([QUESTION_ENGINE.md](QUESTION_ENGINE.md)) and `code` starts with `ai.`.
```json
{ "level": "hydro",
  "question": { "code": "ai.hydro.rhine.countries", "category": "rivers", "type": "GEO_RELATIONSHIP", "difficulty": 2, "source": "wikidata",
                "text": "Select every country the Rhine flows through.", "explanation": "…",
                "object": "rhine", "fact": {"object":"rhine","countries":"flows_through"} },
  "generator": {"workflow":"draft-questions","model":"…","runId":"…"} }
```
→ `201 {"draft":{"id":"…","code":"ai.hydro.rhine.countries","verification_status":"in_review","factChecked":true}}`. `422 invalid_draft` (including "contradicts verified knowledge"), `409 draft_exists`. Drafts are never served until approved.

## Validation summary
Codes match `^[a-z][a-z0-9_]*$`; session ids are UUIDs (anything else → 404); request bodies are limited to 100 KB; `details` to 16 KB; answers are shape-checked per mode; results are checked against mode rules. Players can only see and modify their own sessions.
