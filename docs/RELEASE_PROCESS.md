# Release process (with documentation)

A release is complete when the app is deployed **and** its documentation is generated, validated and published. This document covers the documentation part and how it fits into the existing deploy. App-specific steps (migrations, content import) stay in [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#deploying-a-release).

All commands run from the repository root with Node.js ≥ 20.19. The tools have no dependencies (`npm install` is not needed).

## Overview

| # | Step | Who / where | Gate |
|---|---|---|---|
| 1 | Implement the change, add release notes to `docs-site/release-notes/NEXT.md` | developer / AI agent | |
| 2 | Tests: `cd backend && npm test`, `cd docs-site && npm test` | local, CI | must pass |
| 3 | Build the app if the UI changed (`cd tools && npm run build-app`) | local | |
| 4 | Bump `backend/package.json` ([VERSIONING.md](VERSIONING.md)) | developer | |
| 5 | `docs generate`: draft docs + evidence report | local | |
| 6 | Review: update pages, remove REVIEW markers, `validate --strict` | developer / AI agent | must pass |
| 7 | `docs freeze X.Y.Z --date <deploy date>` | local | must pass |
| 8 | Commit app + `docs-site/` together; the owner merges to `main` | owner | `Documentation checks` workflow |
| 9 | `deploy.yml`: API deployed, health check | server | must pass |
| 10 | `deploy.yml` → `publish.sh`: validate, build, validate build, atomic switch | server | must pass, else previous docs stay |
| 11 | Health check (filesystem; public URL if `DOCS_HEALTH_URL` is set), rollback on failure | server | |
| 12 | `published.json` and `publish.log` record the release as published | server | |

## Step by step (local)

```bash
# 1. While developing: player-facing notes, one line per change
$EDITOR docs-site/release-notes/NEXT.md

# 4. Bump the version (example: 2.4.0) in backend/package.json and package-lock.json
#    (cd backend && npm version 2.4.0 --no-git-tag-version)

# 5. Generate the draft documentation and the evidence report
node docs-site/tools/docs.js generate --date 2026-12-01
#    → docs-site/versions/v2.4.0/   (copy of 2.3.0, version updated, REVIEW markers)
#    → docs-site/reviews/v2.4.0.md  (evidence: changed files by area, fact changes,
#                                    migrations, commits, release notes, dev changelog)
#    → versions.json: 2.4.0 as "draft"
#    Preview only: add --dry-run (prints the report, writes nothing)

# 6. Review: for every page in the report, check the code, update the page,
#    delete its REVIEW marker. Write What's New from the verified changes.
node docs-site/tools/docs.js validate --strict
node docs-site/tools/docs.js build && node docs-site/tools/docs.js preview   # http://127.0.0.1:4000/

#    After more commits on the same release: refresh the report (pages untouched)
node docs-site/tools/docs.js evidence

# 7. Freeze: sets lastUpdated of changed pages, checks again, records the checksum,
#    archives NEXT.md to release-notes/archive/ and resets it.
node docs-site/tools/docs.js freeze 2.4.0 --date 2026-12-01

# Same check as the deploy will run:
node docs-site/tools/docs.js validate --release
```

The generator does the mechanical part only. It never writes descriptions of new features: a person, or an AI coding agent working from the evidence report and the code, writes them. Anything that cannot be verified is left out.

How the generator finds the previous release: it takes the newest version in `versions.json` and finds the **last commit in which `backend/package.json` had that version** (the deployed state of that release). The evidence covers everything between that commit and the working tree, committed or not. Override with `--since <ref>`.

## What happens on deploy

`deploy.yml` step 8 runs `docs-site/tools/publish.sh` after the API passed its health check:

1. **Not set up?** If `DOCS_ROOT` (`/home/projects/geoaigames-docs`) doesn't exist, it prints a note and does nothing. The deploy succeeds.
2. **Lock** (`DOCS_ROOT/.publish.lock`) so two publications never overlap.
3. **Source validation** in release mode: all rules, plus "the deployed app version has final documentation" and "every previously published version is still present, unchanged".
4. **Build** into `DOCS_ROOT/releases/.staging-<time>`, then **validate the build** (all pages, `/latest/` equals the current version, What's New last, indexes valid, no sensitive data in any served file).
5. **Activate:** rename the build to `releases/v<version>-<commit>-<time>` and switch the `current` symlink with an atomic rename.
6. **Health check:** `current/data/versions.json` must name the deployed version. If `DOCS_HEALTH_URL` is set (a GitHub repository variable), the public URL must serve the new build; otherwise the symlink is switched back to the previous build.
7. **Record:** `DOCS_ROOT/state/published.json` (current and history) and `DOCS_ROOT/logs/publish.log`. Keep the 5 newest builds (plus current and previous).

On any failure, the staging directory is removed, the previous build stays live, the failure is logged, and the deploy job fails with "the API is deployed and healthy, but the documentation was NOT published". Fix the cause and re-run the workflow (`workflow_dispatch`); publishing is idempotent.

## First deployment (one-time, administrator)

The documentation site needs a DNS record, a certificate, a directory and an Nginx server block. None of this is done automatically. The game is not affected at any step.

**Status on 2026-11-19 (checked from outside):** `docs.geoaigames.joocha.com` has **no DNS record**. The certificate served for `geoaigames.joocha.com` (Let's Encrypt) covers `api.joocha.com`, `geoaigames.joocha.com`, `joocha.com` and `www.joocha.com`, but not the docs subdomain.

### 1. DNS

In the DNS zone of `joocha.com`, add an `A` record (and `AAAA` if the server has IPv6) for `docs.geoaigames` pointing to the same address as `geoaigames.joocha.com`. Check:

```bash
dig +short docs.geoaigames.joocha.com    # must print the server's address
```

### 2. Publication directory

```bash
# On the server, as the deploy user (the one deploy.yml logs in as):
sudo mkdir -p /home/projects/geoaigames-docs
sudo chown "$USER": /home/projects/geoaigames-docs
chmod 755 /home/projects/geoaigames-docs     # Nginx must be able to read it
cd /home/projects/geographical-games          # after the commit with docs-site/ is deployed
DOCS_ROOT=/home/projects/geoaigames-docs bash docs-site/tools/publish.sh "$PWD"
ls -l /home/projects/geoaigames-docs/current  # -> releases/v2.3.0-…
```

Nginx must be able to traverse `/home/projects` and read the files (`namei -l /home/projects/geoaigames-docs/current/index.html`). It already reads the game from `/home/projects/geographical-games`, so the same permissions normally work.

### 3. Certificate

Issue a certificate that covers `docs.geoaigames.joocha.com` with the same method used for the existing certificate. Examples (choose the one that matches the server):

```bash
# certbot, webroot method (keep the acme-challenge location of the config file)
sudo certbot certonly --webroot -w /var/www/letsencrypt -d docs.geoaigames.joocha.com
# or extend the existing certificate (all current names plus the new one)
sudo certbot certonly --cert-name <existing name> --expand -d joocha.com,www.joocha.com,api.joocha.com,geoaigames.joocha.com,docs.geoaigames.joocha.com
```

If the certificates are managed by GitLab's built-in Let's Encrypt integration, add the name there instead.

### 4. Nginx

The prepared server block is `docs-site/deploy/nginx-docs.geoaigames.joocha.com.conf`. It serves `/home/projects/geoaigames-docs/current`, resolves `/latest/scoring-system` to `scoring-system.html`, serves `.md` as `text/markdown` with CORS for AI agents, and denies dotfiles. Adapt the certificate paths.

Nginx on this server is GitLab's bundled one. Don't edit GitLab's generated files; include the block:

```bash
sudo cp docs-site/deploy/nginx-docs.geoaigames.joocha.com.conf /etc/gitlab/nginx-docs.conf   # or another stable path
sudo $EDITOR /etc/gitlab/gitlab.rb
#   nginx['custom_nginx_config'] = "include /etc/gitlab/nginx-docs.conf;"
#   (append to the existing value if it is already set, e.g. by the game's server block)
sudo gitlab-ctl reconfigure
sudo gitlab-ctl status nginx
```

If the game's server block is included differently, follow the same mechanism for this file. Check that the game still answers afterwards: `curl -sI https://geoaigames.joocha.com/ | head -1`.

### 5. Verify and switch on the public health check

```bash
node docs-site/tools/docs.js verify --url https://docs.geoaigames.joocha.com --expect 2.3.0
```

Then set the GitHub repository variable `DOCS_HEALTH_URL` = `https://docs.geoaigames.joocha.com` (Settings → Secrets and variables → Actions → Variables). From then on, every deploy checks the public URL and rolls back if the new build isn't served.

## Rollback by hand

```bash
cd /home/projects/geoaigames-docs
ls -t releases/                                   # newest first
ln -sfn releases/<previous build> current.tmp && mv -T current.tmp current
```

## Troubleshooting

| Message | Meaning / fix |
|---|---|
| `the deployed app version X has no documentation` | Run `docs generate`, review, `docs freeze`, commit, re-deploy. |
| `documentation for X is still a draft` | Finish the review and run `docs freeze X`. |
| `published documentation was modified (checksum mismatch)` | A final version was edited. Revert it (`git checkout <ref> -- docs-site/versions/vX`), and put the correction in the next version. |
| `open REVIEW item` | A page still has a review marker: check it and delete the marker. |
| `mentions "leaderboards", which does not exist` | Say it's not available, or, if it shipped, remove it from `unavailableFeatures`. |
| `secret: …` / `private data: …` | Remove it from the page. Never weaken a pattern to make it pass. |
| `another publication is running` | A previous run was killed. Remove `DOCS_ROOT/.publish.lock` if no deploy is running. |
| `health check failed … rolled back` | Nginx doesn't serve `DOCS_ROOT/current` at `DOCS_HEALTH_URL` (config, DNS, certificate, or permissions). |
