---
title: GeoAIGames Documentation
description: Official documentation for GeoAIGames version 2.3.0, the geography game played as a Telegram Mini App.
version: 2.3.0
lastUpdated: 2026-11-19
---
# GeoAIGames Documentation

This is the official documentation for **GeoAIGames, version 2.3.0**. It describes how the game works, how points are calculated, how levels are unlocked and how player data is handled.

Version 2.3.0 is the **initial documentation release**. It documents everything that is implemented in the game at this version. Earlier releases did not have public documentation; their history is summarized in the [changelog](../../changelog/index.md).

## Who this documentation is for

- **Players** who want to understand the rules, the scoring and how to unlock levels.
- **The GeoAIGames AI Assistant** and other AI systems that answer questions about the game. Every page is plain Markdown with explicit rules and can be read on its own.

## Sections

| Section | What it covers |
|---|---|
| [Game Overview](game-overview.md) | What GeoAIGames is, who it is for, platforms and the general flow of play |
| [Game Rules and Conditions](game-rules.md) | How to start, answer, finish and leave a game; restrictions |
| [Scoring System](scoring-system.md) | Points per answer, streak bonuses, level multipliers, examples |
| [Levels and Stages](levels-guide.md) | The five levels, unlock thresholds, player level, difficulty |
| [Game Features](game-features.md) | Sign-in, Telegram integration, screens, map controls, progress tracking |
| [FAQ](faq.md) | Frequently asked questions |
| [User Statistics](user-statistics.md) | Total score, best scores, progress indicators; personal versus public information |
| [Privacy and Security](privacy-and-security.md) | Authentication, stored data, access restrictions |
| [What's New in This Version](whats-new.md) | Changes in version 2.3.0 |

## Key facts at a glance

| Fact | Value in version 2.3.0 |
|---|---|
| Where to play | Telegram Mini App: `t.me/geoaigames_bot/play` |
| Number of levels | 5 |
| Rounds per game | 10 |
| Points per correct answer (base) | 10 (Level 1 Hard: 20) |
| Level multipliers | Level 1 ×1, Level 2 ×2, Level 3 ×3, Level 4 ×4, Level 5 ×5 |
| Unlock thresholds (lifetime score) | Level 2: 1,000 · Level 3: 3,000 · Level 4: 6,000 · Level 5: 10,000 |
| Time limits | None |
| Interface language | English |

## How to read version information

- Each page states the game version it describes and the date it was last updated.
- The documentation for every released version is kept unchanged at its own address (`/versions/v2.3.0/`). The address `/latest/` always shows the version that is currently deployed.
- The final section of every version is [What's New in This Version](whats-new.md).
