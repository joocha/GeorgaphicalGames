# Documentation map

GeoAIGames has two sets of documentation. They have different readers and different rules.

| | Developer documentation | Public documentation |
|---|---|---|
| Where | `docs/` (this folder), `CLAUDE.md`, `backend/docs/` | `docs-site/versions/vX.Y.Z/*.md`, published at `https://docs.geoaigames.joocha.com/` |
| Readers | developers and AI coding agents | players, the GeoAIGames AI Assistant, other AI systems |
| Content | architecture, schema, API, decisions, operations | rules, scoring, levels, features, statistics, privacy |
| Versioning | one living copy, kept in sync with the code | one frozen copy per release; history never changes |
| May contain | internal names, endpoints, server details | only player-visible behaviour; no secrets, no infrastructure, no personal data |

## Developer documentation

| Document | Topic |
|---|---|
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | components, data flows, deployment |
| [GAME_DESIGN.md](GAME_DESIGN.md) | gameplay and levels |
| [SCORING_AND_PROGRESSION.md](SCORING_AND_PROGRESSION.md) | points, multipliers, unlocking |
| [QUESTION_ENGINE.md](QUESTION_ENGINE.md) | question types and validation |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | tables and migrations |
| [GEOGRAPHIC_DATA_SOURCES.md](GEOGRAPHIC_DATA_SOURCES.md) | facts, sources, licences |
| [API_REFERENCE.md](API_REFERENCE.md) | endpoints |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | setup, testing, deployment |
| [ROADMAP.md](ROADMAP.md) / [CHANGELOG.md](CHANGELOG.md) | status and history |
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | goals and audience |

## Public documentation platform

| Document | Topic |
|---|---|
| [DOCUMENTATION_GUIDELINES.md](DOCUMENTATION_GUIDELINES.md) | how to write and check public documentation |
| [VERSIONING.md](VERSIONING.md) | version numbers, immutability, the manifest |
| [RELEASE_PROCESS.md](RELEASE_PROCESS.md) | generating, validating and publishing docs for a release; first deployment |
| [AI_KNOWLEDGE_BASE.md](AI_KNOWLEDGE_BASE.md) | URLs and formats for AI agents (RAG) |
| [../docs-site/README.md](../docs-site/README.md) | the site's source layout and commands |

**Documentation is a mandatory part of every release** (see `CLAUDE.md`). A release is fully documented only when its public documentation has been generated, validated and published.
