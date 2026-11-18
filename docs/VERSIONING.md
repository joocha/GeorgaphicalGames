# Versioning

## One version number

The **app version** in `backend/package.json` is the single version of GeoAIGames. The public documentation uses the same number: documentation version 2.3.0 describes app version 2.3.0. The deploy publishes exactly the documentation of the app version it deployed.

Format: `MAJOR.MINOR.PATCH` ([Semantic Versioning](https://semver.org/)).

| Change | Bump | Example |
|---|---|---|
| Breaking change for players or clients, a new product structure, a migration that requires downtime | MAJOR | 2.0.0 (five-level platform) |
| New feature or content visible to players, rule changes | MINOR | 2.1.0 (new scoring), 2.2.0 (88 questions), 2.3.0 (pinch-to-zoom) |
| Bug fix, wording, small improvement without new behaviour | PATCH | 2.3.1 |
| Tooling, tests, developer docs only, with no change to the running game | none | the documentation platform itself was added on 2.3.0 |

Every player-visible change gets a new version, and every new version gets documentation. If a change doesn't need a new public version, it isn't player-visible.

### Git labels

Releases up to v1.4.8 were labelled in commit messages. The commits labelled **v1.5 to v1.5.5** carry app versions **2.0.0 to 2.3.0**:

| Commit label | Commit | App version (`backend/package.json`) |
|---|---|---|
| v1.5 | d622d27 | 2.0.0 |
| yml-1.5.1, v1.5.1 | 1720132, 1a3ec95 | 2.0.0, 2.1.0 |
| v1.5.2, v1.5.3, v1.5.4 | 0c8052c, e0babc8, dc02063 | 2.2.0 |
| v1.5.5 | 356eda1 | 2.3.0 |

From now on, use the app version in commit messages and tags (`v2.4.0`) so that Git, the documentation and the deployment use the same number. The documentation tools find releases by the version in `backend/package.json`, not by commit messages.

## Documentation versions

### The manifest: `docs-site/versions.json`

```json
{
  "product": "GeoAIGames",
  "versions": [
    { "version": "2.3.0", "releaseDate": "2026-11-18", "status": "final", "checksum": "sha256-…" }
  ]
}
```

- Ascending order, one entry per release, each with a directory `docs-site/versions/v<version>/`.
- `status: "draft"`: being written. Never published.
- `status: "final"`: frozen by `docs freeze`. The `checksum` (SHA-256 over every file of the version directory) makes it immutable.
- Edit it only through the tools (`generate` adds a draft, `freeze` finalizes it).

The public `data/versions.json` is generated at build time from this file. It lists the published versions, marks the current one `latest` and adds `currentVersion`, `generatedAt` and the source commit.

### Immutability

- A final version is never edited. Validation fails on any checksum mismatch, and the deploy then publishes nothing.
- Corrections go into the next version (and its What's New, under Bug Fixes or Improvements).
- A published version is never deleted. Before switching, the deploy checks that every version that was published before is still present with the same checksum.

### Which version is "latest"

The version equal to the deployed app version. A release build contains every final version up to and including it. Drafts and newer versions are never included. `/latest/` is a copy of it; `/versions/vX.Y.Z/` keeps every version at a stable URL.

### When documentation is missing

If the deployed app version has no final documentation, publication fails, the previous documentation stays online, and the deploy job reports the error after the API is already healthy. The `Documentation checks` workflow reports the same problem on the pull request and on `main`, before it reaches a deploy.
