---
title: Levels and Stages
description: The five levels, their categories and content, unlock thresholds, the player level, completion and difficulty.
version: 2.3.0
lastUpdated: 2026-11-19
---
# Levels and Stages

GeoAIGames has **five levels**. All five level cards are visible from the start; Level 1 is unlocked for everyone, and the other levels unlock with the player's lifetime score.

| Level | Name | Multiplier | Unlocks at (lifetime score) | Questions in this version |
|---|---|---|---|---|
| 1 | Atlas Explorer | ×1 | always unlocked | generated from the world map |
| 2 | Hydro Explorer | ×2 | 1,000 | 110 |
| 3 | Earth Explorer | ×3 | 3,000 | 20 |
| 4 | Resource Explorer | ×4 | 6,000 | 20 |
| 5 | Master Explorer | ×5 | 10,000 | 18 |

There is no Level 6 in version 2.3.0.

## Unlocking levels

- Levels unlock by **lifetime score**: the total of all saved games in all levels (see [Scoring System](scoring-system.md#score-aggregation)). It is not the score of a single game.
- Unlocks are checked **after every saved game**, at the same moment the result is saved. A newly unlocked level is announced on the result screen ("🔓 Level 2 · Hydro Explorer unlocked!").
- Unlocks are **permanent**. A level never locks again.
- Points earned in higher levels count more because of the multiplier, so progress speeds up.
- A locked card shows the progress towards its threshold, for example "🔒 1,095 / 3,000 points" with a progress bar.
- The server enforces unlocks. A locked level cannot be started from a modified app.
- In a regular web browser (outside Telegram) there is no sign-in, so Levels 2–5 stay locked and show "Open GeoAIGames in Telegram to unlock".
- The game team can unlock a level for a specific player manually.

## Player level

The **player level** is the highest level N such that every level from 1 to N is unlocked. It is shown next to the player's name, for example "Ana (Score: 1,095 | Level: 2)".

- Every new player starts at player level 1.
- The player level **never goes down**.
- The player level is stored in the player's profile, so it is the same on every device.

## Level completion

A level is completed after **at least one finished game** in that level. Completion is shown on the level card. It does not affect unlocking in this version.

## Difficulty progression

- **Across levels:** later levels cover more specialized topics and combine several facts. Their multipliers are higher (×1 to ×5).
- **Level 1:** the player chooses Easy or Hard (see below).
- **Levels 2–5:** each question has a difficulty from 1 to 3. Games mix all three difficulties. Players cannot choose a difficulty, and difficulty does not adapt to the player in this version.
- **Repeats:** Levels 2–5 avoid questions the player has seen recently. When a level has few questions, repeats can still happen.

## Level 1 · Atlas Explorer (×1)

The original Atlas Quest game.

- **Categories:** country identification, country shapes, geographic position, neighbours and borders. Neighbouring countries are used as the wrong options; there are no separate questions about borders.
- **Rounds:** 10, alternating "Find it" (tap the named country on a zoomed map) and "Name it" (choose the highlighted country from 4 options).

| Mode | Countries used | Wrong options in "Name it" | Points per correct answer |
|---|---|---|---|
| Easy · big countries | the 75 largest countries of the quiz | chosen from the 4 nearest countries | 10 + streak bonus up to 5 |
| Hard · all countries | all countries of the quiz (some territories and very small countries are not used) | chosen from the 6 nearest countries | 20 + streak bonus up to 10 |

- Hard also uses a tighter map zoom.
- Level 1 is the only level that can be played outside Telegram (without saving progress).
- **Special rule:** the Level 1 game runs inside the app. The server checks the final score for plausibility; it does not score each answer individually.

## Level 2 · Hydro Explorer (×2)

Water on the map: rivers, lakes, waterfalls, seas, oceans, straits and canals.

- **Categories with questions:** Rivers, Lakes, Waterfalls, Seas, Oceans, Straits, Canals.
- **Categories without questions yet:** River basins (shown as "soon" on the introduction screen).
- **Question examples:** identify a highlighted river or lake; select every country a river flows through; which seas a strait connects; warm and cold ocean currents; deepest trenches and lakes; match rivers with their mouths.
- **Map layers:** Rivers and Lakes buttons show background layers.

## Level 3 · Earth Explorer (×3)

Landforms.

- **Categories with questions:** Mountain ranges, Mountain peaks, Mountain passes, Valleys, Volcanoes, Canyons, Tunnels.
- **Categories without questions yet:** Mountain roads ("soon").
- **Question examples:** countries crossed by a mountain range; where a peak or volcano is; which range contains a peak; well-known passes and tunnels.

## Level 4 · Resource Explorer (×4)

Natural resources and where they are produced.

- **Categories with questions:** Gold, Copper, Iron ore, Oil, Lithium, Cobalt, Diamonds, Other minerals.
- **Categories without questions yet:** Natural gas, Coal ("soon").
- **Data source:** USGS Mineral Commodity Summaries 2026 (production year 2024; reserves and resources as published in 2026).
- **Special rule:** questions always state whether a figure is **mine production**, **reserves** or **identified resources**. These are different measures; for example, the country that mines the most of a mineral is not always the country with the largest reserves.

## Level 5 · Master Explorer (×5)

Mixed challenges that combine several facts.

- **Categories with questions:** Climate zones, Natural regions, Deserts & forests, Population density, Economic geography, Trade routes, Shipping routes, Strategic straits & canals, Complex relationships.
- **Categories without questions yet:** Megacities ("soon").
- **Question examples:** what strategic straits connect; a shipping route through several straits; countries that have both a given mountain range and a given river basin; population and export figures (World Bank, 2024 data).

## Question types (Levels 2–5)

| Type | Player action | Partial points |
|---|---|---|
| Single choice | pick one option | no |
| Multiple choice | pick all correct options, then Check | yes |
| True / False | True or False | no |
| Map identification | tap the country on the map | no |
| Country identification | name a highlighted country, or tap it | no |
| Object identification | a river, lake or marked place is shown; pick its name | no |
| Geographic relationship | select every related country on the map, then Check | yes |
| Resource identification | tap the producing country, or pick the mineral of a mine | no |
| Matching | match each item on the left to one on the right | yes |
