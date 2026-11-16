# Product vision

## Vision

GeoAIGames makes the world interesting to explore. It is a geography game that grows with the player. It starts with recognising a country by its shape and builds up to understanding why the Strait of Hormuz matters, or why Chile has the largest lithium reserves while Australia mines the most.

## Target audience

- **Primary:** Telegram users, from curious teenagers to adults, who want a quick, satisfying game they can play in a few minutes.
- **Secondary:** students and teachers who want verified, sourced geography facts in a playful format.
- The interface is in English today; the data model is prepared for more languages (`question_bank.language`).

## Core objectives

1. **Learn by playing.** Every answer is followed by a short, sourced explanation.
2. **A real map, not decoration.** The map is where players answer: tapping countries, spotting rivers and finding straits.
3. **Trustworthy facts.** Every fact has a source. Statistics have a year and say whether they are production, reserves or resources. AI never decides what is true.
4. **Long-term motivation.** Five levels with rising multipliers, progressive unlocking, personal bests per level and mastery progress.
5. **Continuously expandable.** New levels, categories, question types, objects and data sources are added through content files and configuration, not rewrites.

## Game concept

Short sessions (10 rounds by default) inside Telegram. Each level has a theme, a points multiplier and its own best score. Finishing a level unlocks the next one.

| Level | Name | Theme | Multiplier |
|---|---|---|---|
| 1 | Atlas Explorer | Countries: shapes, positions, neighbours | ×1 |
| 2 | Hydro Explorer | Rivers, basins, lakes, waterfalls, seas, oceans, straits, canals | ×2 |
| 3 | Earth Explorer | Mountain ranges, peaks, passes, valleys, volcanoes, canyons, tunnels | ×3 |
| 4 | Resource Explorer | Minerals, deposits, production versus reserves | ×4 |
| 5 | Master Explorer | Climate, regions, population, trade and shipping routes, multi-fact relationships | ×5 |

Details: [GAME_DESIGN.md](GAME_DESIGN.md).

## Product principles

- **Preserve what players have.** No reset of profiles, scores or achievements, ever.
- **The server is the referee.** Scores, unlocks and correctness are decided by the backend.
- **Verified before published.** Drafts, including AI drafts, are reviewed before players see them.
- **Mobile first, Telegram native.** Theme colours, haptics, back button, one-handed play.
- **Small, clear steps.** Reusable architecture first, then content. Document what remains.

## Future expansion opportunities

See [ROADMAP.md](ROADMAP.md). Highlights: dedicated neighbour and border questions for Level 1, mountain-range and route geometry layers, coal, oil and natural-gas statistics, cities and megacities, achievements, leaderboards, AI hints and adaptive difficulty through n8n, more languages, and 20- and 50-round sessions.
