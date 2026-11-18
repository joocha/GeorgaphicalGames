---
title: Scoring System
description: How points, streak bonuses, partial answers and level multipliers are calculated, with worked examples.
version: 2.3.0
lastUpdated: 2026-11-19
---
# Scoring System

All points are calculated **on the GeoAIGames server**. The app never decides the multiplier or whether an answer is correct.

## How scores are calculated

The general rule for every answer is:

```
final points = round((base points × answer fraction + streak bonus) × level multiplier)
```

- **Base points:** 10 for a correct answer (20 in Level 1 Hard).
- **Answer fraction:** 1 for a fully correct answer, 0 for a wrong answer, or a value between 0 and 1 for a partly correct answer (Levels 2–5 only).
- **Streak bonus:** extra points for a correct answer that continues a streak. Only fully correct answers get a streak bonus.
- **Level multiplier:** ×1 to ×5, depending on the level the game is played in. It is applied once, after the base points and the streak bonus.

## Points per correct answer

The streak is the number of consecutive fully correct answers including the current one (the first correct answer has streak 1).

| Mode | Points for a correct answer (before the multiplier) | Maximum streak bonus | Perfect 10-round game (before the multiplier) |
|---|---|---|---|
| Level 1 Easy | `10 + min(5, streak − 1)` | 5 | 135 |
| Level 1 Hard | `20 + min(10, 2 × (streak − 1))` | 10 | 270 |
| Levels 2–5 | `10 + min(5, streak − 1)` | 5 | 135 |

Points for consecutive correct answers:

| Correct answer in a row | 1st | 2nd | 3rd | 4th | 5th | 6th and later |
|---|---|---|---|---|---|---|
| Easy and Levels 2–5 | 10 | 11 | 12 | 13 | 14 | 15 |
| Level 1 Hard | 20 | 22 | 24 | 26 | 28 | 30 |

Level 1 Hard always gives exactly twice the points of Easy for the same answers.

## Penalties

- A **wrong answer** scores 0 points and resets the streak to 0.
- Points are **never subtracted** from a score. There are no negative points.
- In questions with several answers, **wrong picks reduce** the partial points for that question (see below).

## Bonuses

- **Streak bonus:** see the tables above.
- **Level multiplier:** see below.
- There is **no time bonus** in version 2.3.0.

## Partial answers (Levels 2–5)

Questions with several correct answers (several options, several countries on the map) and matching questions give partial points.

| Question kind | Answer fraction |
|---|---|
| Several answers (options or countries) | `max(0, (correct picks − wrong picks) ÷ number of correct answers)` |
| Matching | `correct pairs ÷ total pairs` |

The base points of a partial answer are `round(10 × answer fraction)`. A partial answer gets **no streak bonus** and **resets the streak**. An answer counts as correct only when the fraction is 1.

## Level multipliers

| Level | Multiplier | One correct answer without bonus | Perfect game |
|---|---|---|---|
| 1 Atlas Explorer | ×1 | 10 (Hard: 20) | 135 (Hard: 270) |
| 2 Hydro Explorer | ×2 | 20 | 270 |
| 3 Earth Explorer | ×3 | 30 | 405 |
| 4 Resource Explorer | ×4 | 40 | 540 |
| 5 Master Explorer | ×5 | 50 | 675 |

- The multiplier belongs to the level the game is **played in**.
- The rules and the multiplier are fixed when a game starts. A rule change by the game team never changes a game that is already running or finished.

## Score aggregation

- **Game score:** the sum of the final points of all 10 rounds.
  - Levels 2–5: each answer is scored and multiplied when it is submitted.
  - Level 1: the game is played in the app; at the end the server checks the base score and multiplies it by ×1.
- **Lifetime score:** the sum of the scores of all saved games of the player, in every level and mode. It is calculated from the saved results every time it is shown, so it cannot drift. Abandoned games do not count.
- **Best score:** the highest single-game score, per mode and per level (Level 1: the higher of Easy and Hard).

### Results from earlier versions

Version 2.1.0 divided all point values by 10. Results saved before version 2.1.0 are **counted as one tenth** of their stored value in the lifetime score and in best scores. For example, a perfect Easy game saved before 2.1.0 was stored as 1,350 points and counts as 135. Stored results are never changed.

## Result calculation (end of a game)

The result screen shows:

- correct answers out of 10 (only fully correct answers count),
- the game score (in Levels 2–5 with the multiplier, for example "points (×2)"),
- the best streak of the game,
- the best score ever in this mode or level,
- "New best score!" when the game beats the previous best.

## Examples of score calculations

**Example 1: Level 1 Easy, three correct answers in a row, then a wrong one.**
10 + 11 + 12 + 0 = **33 points**. After the wrong answer the streak is 0, so the next correct answer is worth 10 again.

**Example 2: a perfect Level 1 Easy game.**
10 + 11 + 12 + 13 + 14 + 15 + 15 + 15 + 15 + 15 = **135 points**. Level 1 Hard: **270 points**.

**Example 3: Level 2 (×2), first two answers correct.**
Round 1: (10 + 0) × 2 = **20**. Round 2: (10 + 1) × 2 = **22**.

**Example 4: Level 2 (×2), a question with 3 correct countries.**

| Picks | Fraction | Base points | Final points |
|---|---|---|---|
| 3 correct, 0 wrong | 1 | 10 + streak bonus | (10 + bonus) × 2 |
| 2 correct, 0 wrong | 2 ÷ 3 | round(6.67) = 7 | 7 × 2 = **14** |
| 2 correct, 1 wrong | (2 − 1) ÷ 3 | round(3.33) = 3 | 3 × 2 = **6** |
| 1 correct, 2 wrong | 0 (never below 0) | 0 | **0** |

**Example 5: Level 3 (×3), a matching question with 4 pairs, 3 matched correctly.**
Fraction 3 ÷ 4; base points round(7.5) = 8; final points 8 × 3 = **24**. The streak resets.

**Example 6: a perfect Level 5 game.**
Base 135 × 5 = **675 points**.

**Example 7: unlocking.**
A player with a lifetime score of 940 finishes a Level 1 Easy game with 70 points. The new lifetime score is 1,010, so Level 2 unlocks immediately (threshold 1,000). See [Levels and Stages](levels-guide.md#unlocking-levels).
