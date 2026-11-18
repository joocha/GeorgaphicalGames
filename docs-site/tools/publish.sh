#!/usr/bin/env bash
# Publishes the documentation for the app version that was just deployed.
# Called by .github/workflows/deploy.yml after the API health check passed.
#
#   DOCS_ROOT        publication directory, outside the game checkout
#                    (default /home/projects/geoaigames-docs). If it doesn't
#                    exist, publishing is skipped: it is set up once by an
#                    administrator (docs/RELEASE_PROCESS.md, "First deployment").
#   DOCS_HEALTH_URL  optional public URL; when set, the published version is
#                    checked over HTTP and rolled back if it isn't served.
#
# Validation, build, atomic switch, health check and rollback are done by
# `docs.js publish`; a failure leaves the previous documentation online.
set -Eeuo pipefail
REPO="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DOCS_ROOT="${DOCS_ROOT:-/home/projects/geoaigames-docs}"
args=(publish --docs-root "$DOCS_ROOT" --repo "$REPO" --keep "${DOCS_KEEP:-5}")
if [ -n "${DOCS_HEALTH_URL:-}" ]; then args+=(--health-url "$DOCS_HEALTH_URL"); fi
exec node "$REPO/docs-site/tools/docs.js" "${args[@]}"
