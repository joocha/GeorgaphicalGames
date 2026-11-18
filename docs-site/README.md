# docs-site: public documentation of GeoAIGames

Source of `https://docs.geoaigames.joocha.com/`: Markdown documentation per release, a dependency-free static site generator, validation, the release generator and the publisher used by the deploy.

Rules: [../docs/DOCUMENTATION_GUIDELINES.md](../docs/DOCUMENTATION_GUIDELINES.md) · Versions: [../docs/VERSIONING.md](../docs/VERSIONING.md) · Releases and first deployment: [../docs/RELEASE_PROCESS.md](../docs/RELEASE_PROCESS.md) · AI access: [../docs/AI_KNOWLEDGE_BASE.md](../docs/AI_KNOWLEDGE_BASE.md)

## Layout

```
docs-site/
  versions.json            version manifest (draft/final, checksums)
  navigation.json          page order; whats-new is always last
  site.config.json         site URL, What's New categories, unavailable-feature rules
  versions/vX.Y.Z/*.md     the documentation of each release (final = immutable)
  changelog/history.md     releases before the documentation platform
  release-notes/NEXT.md    developer notes for the next release (TEMPLATE.md, archive/)
  reviews/vX.Y.Z.md        evidence reports written by "generate" (not published)
  assets/                  CSS, JS (search, version selector, mobile menu), images
  deploy/                  Nginx server block (installed by hand)
  tools/docs.js            CLI
  tools/lib/               markdown, build, validate, generate, release
  tools/publish.sh         called by .github/workflows/deploy.yml
  tools/test/              node:test suite
  dist/                    build output (git-ignored)
```

## Commands

```bash
node docs-site/tools/docs.js validate [--strict] [--release]
node docs-site/tools/docs.js build [--release]            # → docs-site/dist
node docs-site/tools/docs.js preview                      # http://127.0.0.1:4000/
node docs-site/tools/docs.js generate [--dry-run]         # new release: draft + evidence
node docs-site/tools/docs.js evidence                     # refresh the evidence report
node docs-site/tools/docs.js freeze X.Y.Z [--date D]      # finalize (immutable)
node docs-site/tools/docs.js publish --docs-root DIR      # server: build, validate, switch
node docs-site/tools/docs.js verify --url URL --expect X  # check the public site
cd docs-site && npm test                                  # tool tests
```

No `npm install` is needed: the tools use only Node.js built-ins, so the production server can build the site with the Node.js it already has.

## Built site

| URL | Content |
|---|---|
| `/` | landing page |
| `/latest/<page>` | current version (HTML; `.md` for raw Markdown) |
| `/versions/vX.Y.Z/<page>` | a specific version |
| `/changelog/` | release history |
| `/data/versions.json`, `/data/docs-index.json`, `/llms.txt`, `/latest/all.md` | machine-readable |
