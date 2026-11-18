# AI knowledge base

The public documentation is the official knowledge base for the planned GeoAIGames Telegram AI Assistant and for any other AI system that answers questions about the game. This document describes what such an agent should read, and the rules for keeping the source reliable.

## Endpoints (static files, no authentication)

Base URL: `https://docs.geoaigames.joocha.com` (live once the first deployment in [RELEASE_PROCESS.md](RELEASE_PROCESS.md#first-deployment-one-time-administrator) is done).

| Path | Content | Use |
|---|---|---|
| `/data/docs-index.json` | product, `currentVersion`, `releaseDate`, `generatedAt`, and every section of the current version with `id`, `title`, `description`, `lastUpdated`, `path` (Markdown), `html`, `url` | start here; detect new releases by `currentVersion` |
| `/data/versions.json` | all published versions: `version`, `releaseDate`, `status`, `latest`, `path`, `checksum`; `currentVersion` | version history, stable paths |
| `/latest/<section>.md` | one section of the current version, raw Markdown with front matter | RAG: fetch and index per section |
| `/latest/all.md` | all sections of the current version in order, What's New last | small agents: one fetch |
| `/versions/vX.Y.Z/<section>.md` | the same for a specific version (never changes) | answering about older versions, citations |
| `/versions/vX.Y.Z/docs-index.json` | per-version index | |
| `/changelog/index.md` | all What's New sections, newest first, plus earlier history | "what changed" questions |
| `/llms.txt` | short orientation for language models | discovery |

`.md` and `.json` files are served with `Access-Control-Allow-Origin: *` and `Cache-Control: no-cache`. The agent never needs the game's servers, database or private infrastructure.

Example `docs-index.json` (trimmed):

```json
{
  "product": "GeoAIGames",
  "documentationLanguage": "en",
  "currentVersion": "2.3.0",
  "releaseDate": "2026-11-18",
  "fullText": "/latest/all.md",
  "sections": [
    { "id": "scoring-system", "title": "Scoring System", "lastUpdated": "2026-11-19",
      "path": "/latest/scoring-system.md", "url": "https://docs.geoaigames.joocha.com/latest/scoring-system.md" }
  ]
}
```

## Recommended agent behaviour

1. Fetch `/data/docs-index.json`. Re-index when `currentVersion` or `generatedAt` changes (a cheap poll, or after a deploy notification).
2. Index each section's Markdown separately. Split chunks at `##` headings; keep the page title, the version and `lastUpdated` as metadata. Front matter is plain `key: value` lines between `---`.
3. Answer from the current version unless the user asks about an older one. Say which version the answer refers to when it matters (rules can change between versions).
4. Treat the documentation as the only source for rules, scoring and features. If it doesn't cover a question, say so instead of guessing. Lists of features that are *not available* are explicit (`game-features.md`, "Features not available").
5. Never invent personal data; the documentation contains none, and an agent with only documentation access cannot see any player's score.

## Language

- The documentation and the assistant's system prompt are written in **English**.
- The assistant may answer in the user's language (for example Georgian or English). It translates from the English documentation; the documentation itself is not translated in this version.
- Use the terms defined in `game-overview.md` ("Terminology") consistently, including in translations.

## What makes the source reliable (rules for maintainers)

- Pages are generated from versioned Markdown in `docs-site/versions/`, validated before every publication ([DOCUMENTATION_GUIDELINES.md](DOCUMENTATION_GUIDELINES.md)).
- Released versions are immutable (checksums), so citations to `/versions/vX.Y.Z/…` stay valid forever.
- `/latest/` only changes after a successful app deploy of a new version.
- Headings, file names and section ids are stable. Renaming a page breaks agents' citations: add a new page instead, and keep the old one in old versions.
