# Game design

Status legend: ✅ implemented and tested · 🟡 partly implemented · ⏳ planned.

## Player journey

1. **Sign-in** (Telegram only): the Mini App signs the player in with Telegram's signed `initData`. In a normal browser the app runs offline and only Level 1 is playable.
2. **Level Selection** (home): five cards, all visible from the start. ✅
3. **Introduction**: Level 1 shows the original Atlas Quest start screen (Easy/Hard, spotlight map, best score). Levels 2–5 show the description, categories (marked "soon" when they have no questions yet), rules, rounds and best score. ✅
4. **Game**: 10 rounds with a progress bar, points, a streak badge, the map and an answer panel. ✅
5. **Result**: correct/total, points (with the multiplier), best streak, best ever, newly unlocked level, Play again, Challenge a friend, Menu. ✅

### Level card ✅

Each card shows the level number, name, icon, short description (or the unlock hint when locked), multiplier badge, best score, a progress bar (mastery for levels 2–5, completion for Level 1), and a lock state or Play button. Tapping a locked card shows how to unlock it.

## Levels

### Level 1 · Atlas Explorer (×1) ✅

The original Atlas Quest, unchanged: 10 rounds alternating **Find it** (tap the named country on a zoomed map) and **Name it** (pick the highlighted country from 4 nearby look-alikes).
- **Easy:** the 75 largest countries, 4 nearest countries as distractors, wider zoom.
- **Hard:** all quiz countries, 6 nearest as distractors, tighter zoom.
- Categories: country identification, country shapes, geographic position, neighbours and borders (neighbours are used as distractors; dedicated neighbour and border questions are ⏳).
- The game runs in the client; the server validates the submitted result and applies the ×1 multiplier ([SCORING_AND_PROGRESSION.md](SCORING_AND_PROGRESSION.md)).

### Level 2 · Hydro Explorer (×2) ✅ (sample content)

Rivers, river basins, lakes, waterfalls, seas, oceans, straits, canals. 22 verified questions:
- identify a highlighted river or lake (Natural Earth geometry);
- select every country a river flows through (Danube, Mekong, Amazon) or a basin covers (Nile);
- match rivers with their mouths and with the country where they rise;
- name a marked strait or waterfall; which seas a strait or canal connects;
- tap the country of a waterfall; select the countries sharing a lake.

### Level 3 · Earth Explorer (×3) ✅ (sample content)

Mountain ranges, peaks, passes, valleys, volcanoes, canyons, tunnels. 20 verified questions: countries crossed by the Alps, Andes and Atlas; where Kilimanjaro, Aconcagua and Vesuvius are; which range contains Everest or Elbrus; matching peaks to ranges; the Khyber and Brenner passes; volcano identification; the Grand Canyon; the Gotthard Base Tunnel; the Kathmandu Valley. Mountain roads: ⏳ (no content yet, shown as "soon").

### Level 4 · Resource Explorer (×4) ✅ (sample content)

20 verified questions with USGS Mineral Commodity Summaries 2026 data (production year 2024; reserves and resources as published in 2026):
- Resource → Country (tap the top producer), Country → Resource, Deposit → Country (tap it), Deposit → Resource (marked mine, pick the mineral), matching mines to countries.
- **Production, reserves and resources are kept apart.** One question asks players to match each lithium metric with its leader (Australia, Chile, Argentina).
- Categories with content: gold, copper, iron ore, lithium, cobalt, diamonds (deposits), oil (deposit location), other minerals (nickel, rare earths). Natural gas and coal are ⏳ (need a verified energy source such as EIA or the Energy Institute).

### Level 5 · Master Explorer (×5) ✅ (sample content)

18 verified questions that combine facts: strategic straits and what they connect, a shipping route through Bab-el-Mandeb and Suez, countries with both the Andes and the Amazon (derived by intersecting two verified relations), climate (Köppen BWh, tropical rainforest), the Sahel, deserts and forests, population and density (World Bank 2024), merchandise exports (World Bank 2024). Megacities: ⏳ (sources disagree on agglomeration definitions; needs a chosen, documented source).

## Question types ✅

All nine types are supported by one engine ([QUESTION_ENGINE.md](QUESTION_ENGINE.md)):

| Type | Player action | Partial scoring |
|---|---|---|
| SINGLE_CHOICE | pick one option | no |
| MULTIPLE_CHOICE | pick all correct options, then Check | yes |
| TRUE_FALSE | True / False | no |
| MAP_IDENTIFICATION | tap the country on the map | no |
| COUNTRY_IDENTIFICATION | name a highlighted country (options) or tap it | no |
| OBJECT_IDENTIFICATION | a river, lake or marker is shown; pick its name | no |
| GEO_RELATIONSHIP | select every related country on the map, then Check | yes |
| RESOURCE_IDENTIFICATION | tap the producing country, or pick the mineral of a mine | no |
| MATCHING | match each item on the left to one on the right | yes |

## Map interactions ✅

- Tap countries (single answer, or toggle a multi-selection).
- Drag to pan, pinch or mouse-wheel to zoom, ⤢ to re-centre (levels 2–5). Level 1 keeps its original fixed zoom.
- **Rivers** / **Lakes** buttons turn background layers on and off. Layers load only when first needed.
- After answering: correct countries green, wrong picks red, missed ones light green, labels shown; the object (river, lake or marker) is highlighted and named; the explanation and source appear.

## Difficulty

- Level 1: Easy / Hard modes (as before).
- Levels 2–5: each question has a difficulty of 1–3. The mode's `config.difficulty` range selects which ones can be served (currently 1–3, mixed). Adaptive difficulty is ⏳.

## Progression ✅

Level N+1 unlocks when Level N is completed (one finished session by default). Rules are configurable in the database. Details: [SCORING_AND_PROGRESSION.md](SCORING_AND_PROGRESSION.md).

## Session length ✅ (backend) / ⏳ (UI)

10 rounds by default. Levels may allow other lengths (`game_levels.session_config.allowedRounds`, e.g. `[10, 20, 50]`); the API accepts `rounds` and validates it. The UI doesn't offer a choice yet.

## Future game modes ⏳

Daily challenge, timed rounds (`time_limit_sec` exists but isn't enforced), Border journey and Capitals from the Web Game moved into the engine, friend duels, and leaderboards (queries in `backend/docs/database.md` §8).
