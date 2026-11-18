---
title: Game Rules and Conditions
description: How to start, play, finish and leave a game, what counts as a correct answer, and which restrictions apply.
version: 2.3.0
lastUpdated: 2026-11-19
---
# Game Rules and Conditions

## General game rules

1. Every game has exactly **10 rounds**. Each round is one question.
2. Each round can be answered **once**. An answer cannot be changed after it is given.
3. Rounds are played **in order**. A round cannot be skipped.
4. The **server decides** whether an answer is correct and how many points it is worth. The app only displays the result.
5. A level can be played only after it is **unlocked**. Level 1 is always unlocked. See [Levels and Stages](levels-guide.md#unlocking-levels).
6. There are **no lives** and no early game over. A game always runs all 10 rounds.

## How to start a game

1. Open the Mini App in Telegram (`t.me/geoaigames_bot/play`). Inside Telegram the game opens only after a successful sign-in.
2. On the Level Selection screen, tap an unlocked level card.
3. **Level 1:** choose **Easy · big countries** or **Hard · all countries**, then tap **Play**.
4. **Levels 2–5:** read the introduction (categories and rules), then tap **Start game**.

If a level is locked, tapping its card shows how to unlock it, for example "Reach 3,000 total points to unlock".

## How to complete a task (answering a round)

### Level 1 · Atlas Explorer

Rounds alternate between two task types. Round 1 is "Find it", round 2 is "Name it", and so on.

| Task | What the player sees | How to answer |
|---|---|---|
| **Find it** | The name of a country and a map zoomed to its area | Tap that country on the map |
| **Name it** | A highlighted country on the map | Choose its name from 4 options (the other options are nearby countries) |

### Levels 2–5 · Question engine

Each question has an answer mode:

| Answer mode | How to answer |
|---|---|
| Options (one answer) | Tap one option. |
| Options (several answers) | Tap every correct option, then tap **Check**. |
| True / False | Tap True or False. |
| Map, one country | Tap one country on the map. |
| Map, several countries | Tap every correct country, then tap **Check**. |
| Matching | Match each item on the left with one item on the right, then tap **Check**. |

## Correct and incorrect answers

- **Correct:** the app shows "Correct! +N" with the points earned. The streak continues.
- **Incorrect:** the answer scores 0 points and the streak resets to 0.
  - Level 1 "Find it": the tapped country is shown in red with its name; the correct country is shown in green.
  - Level 1 "Name it": the correct option is marked; the wrong choice is marked as wrong.
- **Partly correct** (Levels 2–5, questions with several answers or matching only): the app shows "Partly right · +N". Partial points are awarded, there is no streak bonus, and the streak resets. See [Scoring System](scoring-system.md#partial-answers-levels-25).
- After every answer in Levels 2–5 the map shows the correct countries in green, wrong picks in red and missed countries in light green. The app shows an explanation and the source of the fact.
- Some correct answers are countries that are too small to tap on the world map. In that case the app names them after the answer ("Also: …, too small for this map").

## Time limits

There are **no time limits** in version 2.3.0. There is no countdown and no time bonus. The server records how long each answer took (Levels 2–5) for statistics only; it does not affect points.

## Game restrictions

- **Sign-in required in Telegram.** Inside Telegram, a game can start only when the player is signed in.
- **Locked levels cannot be played.** The server refuses to start a game in a locked level, even if the app is modified.
- **One unfinished game per game type.** Starting a new game closes any earlier unfinished game of the same type as abandoned. Abandoned games earn no points.
- **Level 1 results are checked.** The Level 1 game runs in the app, and the server checks that the submitted score is possible for the number of correct answers under the rules of the selected mode. An impossible score is rejected and not saved.
- **No double counting.** A finished game is saved once. Submitting it again adds no points.
- **Levels 2–5:** every round must be answered before the game can be finished.
- **Session length:** 10 rounds in every level. Players cannot choose another length in this version.

## Completion conditions

A game is complete when all 10 rounds are answered and the result screen appears. The app then saves the result to the player's profile:

- "☁️ Saved to your profile" means the result was saved. Its points are added to the lifetime score, and level unlocks are checked immediately.
- The lifetime score and player level next to the player's name are updated after every saved game.

A **level** counts as completed after at least one finished game in that level. The Level 1 card shows "Completed"; the cards of Levels 2–5 show mastery progress instead. Completion is for information only; it does not unlock other levels in this version.

## Failure conditions

There is no losing state: a game cannot be lost or ended early by wrong answers. A game ends **without points** in these cases:

| Situation | Result |
|---|---|
| The player presses Telegram's Back button during a game | The game is abandoned. No result is saved. |
| The player starts another game before finishing the current one | The earlier game is abandoned. |
| The result cannot be saved (no connection) in Levels 2–5 | The app shows "Couldn't save this game" with **Try again**. Tapping Try again sends the result again. |
| The result cannot be saved in Level 1 | The app shows "Couldn't save this game to your profile". The score still counts as a best score on the device, but it is not added to the lifetime score. |
| The sign-in has expired | The app shows "Session expired". Close the Mini App and open it again from the bot. |

## User responsibilities

GeoAIGames has no separate terms of service in version 2.3.0. To make sure progress is recorded correctly, the player should:

- Open the game from Telegram to have progress saved to their profile.
- Wait for "Saved to your profile" on the result screen before closing the app.
- Reopen the Mini App from the bot when the app reports that the session has expired.
