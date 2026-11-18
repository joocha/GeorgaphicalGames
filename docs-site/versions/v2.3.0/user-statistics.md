---
title: User Statistics
description: Total score, games, completed levels, results and progress indicators, and which information is personal or public.
version: 2.3.0
lastUpdated: 2026-11-19
---
# User Statistics

This page explains the numbers GeoAIGames keeps about a player's games and where the player can see them.

## Statistics shown in the app

| Statistic | Where it is shown | Meaning |
|---|---|---|
| **Total score** ("Score") | Next to the player's name on Level Selection | The lifetime score: the sum of the scores of all saved games, in all levels. Used for unlocking levels. |
| **Player level** ("Level") | Next to the player's name | The highest level up to which every level is unlocked. |
| **Best score** | Each level card, introduction screens, result screen ("best ever") | The highest score of a single game. Level 1 shows the higher of Easy and Hard. |
| **Mastery** (Levels 2–5) | Level card, for example "12/110 mastered" | How many different questions of the level the player has answered fully correctly at least once, out of all questions of the level. |
| **Completion** (Level 1) | Level card: "Completed" or "Not completed" | Whether the player has finished at least one game in the level. |
| **Unlock progress** | Locked level cards, for example "🔒 1,095 / 3,000 points" | Lifetime score compared with the threshold of the level. |
| **Game result** | Result screen | Correct answers out of 10, game score, best streak, best score, new best, newly unlocked level. |

The total score and player level are refreshed after every saved game.

## Statistics recorded but not shown in the app

The server also records, for each player:

- the number of games played,
- correct and incorrect answers and accuracy (percentage of correct answers),
- the average time per answer (Levels 2–5),
- unlocked and completed levels,
- per level: games played, best score, accuracy, mastery,
- per category of Levels 2–5: questions answered, correct answers, accuracy and mastery.

There is **no statistics screen** in version 2.3.0, so players cannot view these numbers in the app yet.

## Achievements

There are no achievements in version 2.3.0.

## How the numbers are calculated

- Only **saved, finished games** count. Abandoned games count nowhere.
- The **total score** is recalculated from the saved results every time it is shown.
- Results saved before version 2.1.0 count as one tenth of their stored value (see [Scoring System](scoring-system.md#results-from-earlier-versions)).
- "Correct answers" counts only fully correct answers. Partly correct answers count as not correct for accuracy, but they still earn partial points.
- A game's result is saved once and never changed afterwards.

## Personal versus public information

| Information | Who can see it |
|---|---|
| Total score, player level, best scores, mastery, unlock progress, game results | **Only the player**, in their own app. |
| Statistics recorded on the server | Only the player's own account can request them from the server. The game team can access the database to operate the game. |
| A shared result ("Challenge a friend") | The people in the Telegram chat the player chooses to send it to. The message contains only the result text and the game link. |

There are **no public profiles, rankings or leaderboards** in version 2.3.0. No other player can see a player's name, score or statistics through the game.

This documentation never contains real player records or personal identifiers. Examples such as "Ana (Score: 1,095 | Level: 2)" are invented for illustration.
