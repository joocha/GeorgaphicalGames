---
title: Game Features
description: Sign-in, Telegram integration, screens, navigation, map controls, progress tracking and features that are not available yet.
version: 2.3.0
lastUpdated: 2026-11-19
---
# Game Features

This page lists the features that exist in version 2.3.0. Features that do not exist yet are listed at the end.

## User registration and authentication

- **Telegram only.** There is no separate account, password or e-mail registration.
- When the Mini App opens inside Telegram, it signs the player in automatically. The first sign-in creates the player's profile; later sign-ins update the name and photo from Telegram.
- During sign-in the app shows "Starting…". If sign-in fails:
  - "Try again" appears when the server cannot be reached.
  - "Close" appears when Telegram's launch data is invalid or too old. Reopen the Mini App from the bot.
- The sign-in renews itself while the app is open. If renewal is no longer possible, the app shows "Session expired"; reopening the Mini App from the bot fixes it.

Security details: [Privacy and Security](privacy-and-security.md).

## Telegram integration

| Feature | What it does |
|---|---|
| Mini App | The game opens inside Telegram at `t.me/geoaigames_bot/play`. |
| Automatic sign-in | Uses the signed launch data that Telegram gives the Mini App. |
| Theme colours | The app uses the colours of the player's Telegram theme (light or dark). |
| Back button | Telegram's Back button returns to the Level Selection screen. During a game it abandons the game. |
| Haptic feedback | Short vibrations for taps, correct answers, wrong answers and unlocks (on devices that support it). |
| Device best scores | Level 1 best scores are also kept in Telegram's cloud storage for the Mini App, or in the browser outside Telegram. |
| Challenge a friend | The result screen opens Telegram's share dialog with a message and the game link. |

The share message contains the result, for example "I found 8/10 countries (98 pts) in Atlas Quest. Can you beat me?" (Level 1) or "I scored 270 points in Hydro Explorer on GeoAIGames. Can you beat me?" (Levels 2–5). The message is sent only if the player chooses a chat and sends it.

## Game interface

| Screen | Contents |
|---|---|
| Sign-in | Shown while the app signs in, or when sign-in fails. |
| Level Selection (home) | The player's name with lifetime score and player level, and five level cards. A line shows whether progress is saved ("☁️ Progress is saved to your profile"). |
| Level card | Level number, icon, name, multiplier, short description (or the unlock hint when locked), best score, a progress bar and a Play label. Locked cards show the points needed. |
| Level 1 introduction | Easy/Hard choice, an animated map preview, best score, the points rule of the selected mode, Play. |
| Levels 2–5 introduction | Description, categories ("soon" for categories without questions), rules, best score, Start game. |
| Game | Round dots (green correct, red wrong), streak badge (🔥 from 2 correct in a row), current points, the map, and the answer panel. |
| Result | Correct answers out of 10, a message, points, best streak, best ever, "New best score!", newly unlocked level, Play again, Challenge a friend, Menu. |

## Navigation

- Tap a level card to open its introduction screen.
- **Menu** on the result screen and Telegram's **Back** button return to Level Selection.
- **Next** moves to the next round after an answer; on the last round the button says **Results**.

## Maps and geographical interactions

- The map is an interactive world map of countries (source: Natural Earth).
- **Answering on the map:** tap a country to answer; in multi-select questions, tap countries to select or unselect them, then tap Check.
- **Background layers (Levels 2–5):** the **Rivers** and **Lakes** buttons turn river and lake layers on and off. Layers load only when they are first needed.
- **Re-centre (Levels 2–5):** the **⤢** button returns the map to the question's view.
- **Reveal after answering:** correct countries in green, wrong picks in red, missed countries in light green, with labels. A river, lake or marked place is highlighted and named.
- Very small countries (micro-states) cannot be tapped on this world map.

## Zoom and touch controls

| Control | Level 1 | Levels 2–5 |
|---|---|---|
| Tap with one finger | answers | answers |
| Drag with one finger | no effect (one finger only taps) | moves the map |
| Pinch with two fingers | zooms (since version 2.3.0) | zooms |
| Drag with two fingers | moves the map (since version 2.3.0) | moves the map |
| Mouse wheel (desktop) | no effect | zooms |
| Mouse drag (desktop) | no effect | moves the map |

- A pinch or drag never counts as an answer.
- Zooming keeps the point between the fingers in place.
- The map cannot be zoomed out too far or moved out of sight.
- In Level 1, every new round starts from its own zoomed view of the right area.

## Progress tracking

- **Lifetime score and player level** next to the player's name, updated after every saved game.
- **Best score** per level card and on introduction screens.
- **Progress bar** on each card: mastery for Levels 2–5 ("12/110 mastered"), completion for Level 1.
- **Unlock progress** on locked cards ("🔒 1,095 / 3,000 points").
- **Explanations and sources** after every answer in Levels 2–5. The app shows "Source:" with the name of the source and, for statistics, the year of the data.

Details: [User Statistics](user-statistics.md).

## Playing outside Telegram

In a regular web browser the game opens without sign-in. Only Level 1 can be played, and best scores are saved on the device only. The home screen shows "Open in Telegram to save your progress".

## Web Game

A separate, older browser game exists alongside the Mini App. It has five expeditions (countries, capitals and big cities, rivers/lakes/seas, mountains and relief, and a border journey). It keeps scores only on the device and is not connected to the five levels, the lifetime score or the player profile.

## Features not available in version 2.3.0

These features do **not** exist in this version. They must not be described as available.

- Achievements and badges.
- Leaderboards, rankings and public player profiles.
- A statistics screen in the app (the server records statistics, but the app does not show them yet).
- Time limits, timed rounds and time bonuses.
- Choosing the number of rounds (always 10).
- Choosing the difficulty in Levels 2–5, or difficulty that adapts to the player.
- Daily challenges and friend duels.
- AI hints. Answers are never checked by AI.
- Interface or questions in languages other than English.
- Deleting a profile from within the app.
