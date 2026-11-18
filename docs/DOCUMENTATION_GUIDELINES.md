# Documentation guidelines (public documentation)

Rules for writing the public documentation in `docs-site/versions/`. They apply to people and to AI coding agents. Most rules are enforced by `node docs-site/tools/docs.js validate`; the others are checked in review.

## 1. Truth comes from the code

- Document only behaviour that exists in the deployed code, the database configuration or the reviewed content. If the code and the developer docs disagree, the code wins (and the developer docs get fixed).
- **Never** document a planned, partial or hidden feature as available. Features that don't exist are listed as "not available in version X" (`game-features.md`), and the validator rejects lines that mention them without a negation (`site.config.json` → `unavailableFeatures`). When a feature ships, remove its entry from that list in the same change.
- Commit messages and release notes are hints, not evidence. Verify every statement against the code.
- If you can't verify something, leave it out and say so in the review, rather than guessing.
- Geographic facts follow the rules in `CLAUDE.md` ("Facts and AI"): no unverified facts, sources named, statistic types (`mine_production`, `reserves`, `identified_resources`) never mixed.

## 2. Write for players and for AI systems

- Simple, plain English. Short sentences. Present tense. No marketing language.
- Use the terms from the glossary in `game-overview.md` ("Terminology") with exactly that meaning: game, round, level, mode, base score, level multiplier, streak, streak bonus, lifetime score, player level, best score, mastery, unlock.
- State rules explicitly, with numbers: "10 rounds", "1,000 points", "×3". Give formulas and worked examples for anything calculated.
- Use the exact labels shown in the app, in quotes or bold: "Start game", "☁️ Saved to your profile".
- Every page must make sense on its own (AI systems retrieve single pages). Link to the page with the details instead of repeating them.
- Mark version-specific statements: "in version 2.3.0", "since version 2.3.0".

## 3. Never publish

- Secrets: tokens, keys, passwords, connection strings, environment files.
- Infrastructure: IP addresses, host names other than the public URLs, ports, server paths, service names, database or table names.
- Personal data: real player names, Telegram IDs or usernames, e-mail addresses, phone numbers, real scores of real people. Examples use invented names ("Ana").
- Internal API details. Player-facing behaviour only.

The validator scans every page for these patterns (`SECRET_PATTERNS`, `PRIVATE_DATA_PATTERNS` in `docs-site/tools/lib/validate.js`). A false positive is fixed by rewording, never by weakening a pattern without review.

## 4. Structure

Every version contains these pages, in this order (`docs-site/navigation.json`):

| File | Section |
|---|---|
| `index.md` | Introduction, key facts |
| `game-overview.md` | 4.1 Game Overview |
| `game-rules.md` | 4.2 Game Rules and Conditions |
| `scoring-system.md` | 4.3 Scoring System |
| `levels-guide.md` | 4.4 Levels and Stages |
| `game-features.md` | 4.5 Game Features |
| `faq.md` | 4.6 FAQ |
| `user-statistics.md` | 4.7 User Statistics |
| `privacy-and-security.md` | 4.8 Privacy and Security |
| `whats-new.md` | 4.9 What's New in This Version (**always last**) |

Each page starts with front matter and exactly one `#` heading equal to `title`:

```
---
title: Scoring System
description: One sentence, used in search results and the AI index.
version: 2.3.0
lastUpdated: 2026-11-19
---
# Scoring System
```

`whats-new.md` must contain `- **Version:** X.Y.Z` and `- **Release date:** YYYY-MM-DD` (equal to `versions.json`), then the categories `## New Features`, `## Improvements`, `## Bug Fixes`, `## Technical Updates`, `## Breaking Changes` in this order. Each category has at least one `- ` item (`- None.` when nothing changed). `## Known Issues` may follow.

A new page is added to `navigation.json` (before `whats-new`) and appears from the version that contains it; old versions are not changed.

## 5. Markdown subset

The site renderer (`docs-site/tools/lib/markdown.js`) supports headings, paragraphs, lists (nested by two spaces), GFM tables, fenced code blocks, blockquotes, horizontal rules, links, `**bold**`, `*italic*` and `` `code` ``. Raw HTML is shown as text; HTML comments are dropped (they are used for `REVIEW` markers). Links between pages are relative (`scoring-system.md#level-multipliers`); anchors follow GitHub's rules and are checked by the validator.

## 6. Review markers

`docs generate` inserts `<!-- REVIEW ... -->` comments into pages the code changes may affect. A marker means "a person must check this page against the code". Delete it only after checking (and updating) the page. Validation fails while any marker remains in a version that is about to be frozen or published.

## 7. Checklist for a documentation change

1. Read the evidence report (`docs-site/reviews/vX.Y.Z.md`) and the code it points to.
2. Update the affected pages and their `lastUpdated` (freeze sets it automatically for changed pages).
3. Update "not available" lists and `site.config.json` → `unavailableFeatures` if a feature shipped.
4. `node docs-site/tools/docs.js validate --strict`
5. `node docs-site/tools/docs.js build && node docs-site/tools/docs.js preview`, and read the changed pages in a browser, including on a phone-sized window.
