---
title: Privacy and Security
description: How players are authenticated, which personal data is stored, what is public or private, and how access is restricted.
version: 2.3.0
lastUpdated: 2026-11-19
---
# Privacy and Security

This page describes how the GeoAIGames software handles player data in version 2.3.0. It is a technical description, not a legal privacy policy.

## User authentication

- Players sign in **only through Telegram**. GeoAIGames has no passwords.
- When the Mini App opens, Telegram gives it signed launch data. The app sends this data to the GeoAIGames server, which checks Telegram's cryptographic signature.
- The server accepts the launch data only if it is **recent** (by default, no older than 5 minutes). This limits replays of old launch data.
- The player's identity is taken **only from the verified Telegram data**. Any user ID sent in a request is ignored.
- After a successful check, the server issues a signed access token. The app keeps it **in memory only** (it is not written to the device's storage) and renews it automatically. By default a token is valid for 24 hours.
- If the token cannot be renewed, the app shows "Session expired" and the player reopens the Mini App.

## Personal data handling

### Data stored about a player

| Data | Source | Purpose |
|---|---|---|
| Telegram user ID | Telegram (verified launch data) | Identifies the player's account |
| Display name (first and last name, or username) | Telegram | Shown as the player's name in the app |
| Telegram username, profile photo link, language code, Premium status | Telegram | Profile information |
| Launch context (for example the type of chat the app was opened from) and the app platform and version | Telegram and the app | Technical and usage information |
| Time of registration and last sign-in | Server | Account management |
| Games: mode, start and end time, score, correct answers, best streak | Server | Scoring, unlocking, best scores |
| Answers in Levels 2–5: the answer given, correctness, points, response time | Server | Scoring and statistics |
| Level 1 game details: the countries asked and whether each answer was correct | The app | Game history |
| Level unlocks and player level | Server | Progression |

The name and photo are refreshed from Telegram at every sign-in.

### Data stored on the device

Level 1 best scores are also stored in Telegram's cloud storage for the Mini App (or in the browser's local storage outside Telegram), so that they are available offline.

### Data not collected

- No passwords, e-mail addresses or phone numbers are collected by GeoAIGames.
- The app loads no analytics or advertising scripts. The only external script is Telegram's official Mini App script.

## Public versus private information

- All game data is **private** to the player. There are no public profiles, rankings or leaderboards.
- Players can see only their own profile, sessions and statistics. The server rejects requests for another player's games.
- Sharing a result ("Challenge a friend") is optional. It opens Telegram's share dialog with a prepared message; nothing is sent until the player sends it.

## Telegram integration security

- The signature of Telegram's launch data is verified on the server with the bot's secret key, which never leaves the server.
- Unsigned launch information supplied by the app is never used to identify the player.
- Invalid launch data is refused with "Couldn't sign you in"; expired launch data requires reopening the Mini App.

## Data access restrictions

- Every player request must carry a valid access token. The account is always the one in the token.
- **Scores, multipliers, unlocks and player levels are calculated by the server only.** The app cannot set them, and no endpoint allows the app or an AI system to write them.
- Saved game results cannot be modified or deleted through the game; they are protected in the database against changes.
- The internal interface for automation and AI tools returns only verified geographic facts and accepts only question drafts for human review. It does not provide access to player data, and it is disabled unless it has been configured with its own secret key.

## AI and content

- AI may help write **draft questions** from verified facts. A person reviews and approves every draft before players can see it.
- AI is **never** used to check answers or calculate points.

## Privacy principles

1. **Collect what the game needs.** The game stores Telegram profile information, game results and answers; it asks for nothing else.
2. **The player's data stays private.** No public profiles or rankings.
3. **The server is the referee.** Identity, scores and unlocks are decided only by the server.
4. **Never publish secrets.** Keys, passwords and server details are never part of the app, the documentation or the public source files.
5. **Preserve player progress.** Profiles and saved results are never reset or rewritten.

## Not available in version 2.3.0

- Deleting or exporting a profile from within the app.
- A published privacy policy or terms of service.
