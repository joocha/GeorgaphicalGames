#!/usr/bin/env bash
# Check and repair the production database, then reload the API.
#
#   bash backend/scripts/repair.sh            # check, ask, repair, restart, check again
#   bash backend/scripts/repair.sh --check    # read-only health check only
#   bash backend/scripts/repair.sh --yes      # no confirmation prompt
#
# Run on the server as the deploy user (needs sudo for systemctl) or root.
# Steps, each skipped when not needed:
#   1. health check (prisma/checks/health_check.sql, read-only)
#   2. pg_dump backup to ~/backups/ (always, before any change)
#   3. temporary clone of the DEPLOYED commit (from the live checkout, so the
#      database is never migrated ahead of the running code) + npm ci
#   4. pending migrations: stop the API, `prisma migrate deploy`
#   5. `npm run content:import` (idempotent: only inserts/updates what changed)
#   6. restart the API, wait for /api/health
#   7. health check again; exit 1 if anything still fails
#
# It never deletes data, never edits game results, never runs migrate dev/reset.
# Docs: docs/DEVELOPMENT_GUIDE.md ("Health check and repair").
set -euo pipefail

APP_DIR="${APP_DIR:-/home/projects/geographical-games}"
SERVICE="${SERVICE:-geography-game-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3020/api/health}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
CHECK_SQL="$APP_DIR/backend/prisma/checks/health_check.sql"

MODE=repair; ASSUME_YES=0
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

for c in psql pg_dump git npm node curl; do command -v "$c" >/dev/null || die "$c is not installed"; done
[ -f "$APP_DIR/backend/.env" ] || die "$APP_DIR/backend/.env not found (set APP_DIR=...)"
set -a; . "$APP_DIR/backend/.env"; set +a
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set in backend/.env"

health() {  # prints the report; returns 1 when a check FAILs
  local out
  out=$(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -P pager=off -f "$CHECK_SQL") || die "health check could not run"
  echo "$out"
  ! grep -q 'NEEDS REPAIR' <<<"$out"
}

say "Health check (read-only)"
if health; then HEALTHY=1; else HEALTHY=0; fi
[ "$MODE" = check ] && exit $((1 - HEALTHY))

DEPLOYED=$(git -C "$APP_DIR" rev-parse HEAD)
say "Deployed commit: $(git -C "$APP_DIR" log -1 --format='%h %s' "$DEPLOYED")"
if [ "$HEALTHY" -eq 1 ]; then
  echo "Database is healthy. The repair will only re-run the (idempotent) content import and restart the API."
fi
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Back up the database, apply pending migrations/content and restart $SERVICE? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Nothing changed."; exit 0; }
fi

say "1/5 Backup"
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/geo-$(date +%F-%H%M%S).dump"
pg_dump "$DATABASE_URL" -Fc -f "$BACKUP" || die "backup failed; nothing was changed"
echo "Saved $BACKUP ($(du -h "$BACKUP" | cut -f1))"

say "2/5 Temporary checkout of $DEPLOYED"
TMP=$(mktemp -d /tmp/geo-repair.XXXXXX)
STOPPED=0
cleanup() {
  rm -rf "$TMP"
  # Never leave the API down because a step failed after stopping it.
  if [ "$STOPPED" -eq 1 ]; then echo "Starting $SERVICE again after an error..."; $SUDO systemctl start "$SERVICE" || true; fi
}
trap cleanup EXIT
git clone --quiet --no-checkout "$APP_DIR" "$TMP/app"
git -C "$TMP/app" checkout --quiet "$DEPLOYED"
cd "$TMP/app/backend"
npm ci --no-audit --no-fund --loglevel=error

say "3/5 Migrations"
STATUS=$(npx --no-install prisma migrate status 2>&1 || true)
echo "$STATUS" | grep -E 'migration|Database schema|not yet been applied|up to date' || true
if grep -qi 'failed' <<<"$STATUS"; then
  die "a migration is marked as failed; resolve it by hand (prisma migrate resolve). Backup: $BACKUP"
elif grep -qi 'not yet been applied' <<<"$STATUS"; then
  echo "Pending migrations found: stopping $SERVICE so old code never runs on a half-migrated database."
  $SUDO systemctl stop "$SERVICE"; STOPPED=1
  npx --no-install prisma migrate deploy
elif ! grep -qi 'up to date' <<<"$STATUS"; then
  echo "$STATUS"
  die "could not read the migration status (see above); nothing was migrated. Backup: $BACKUP"
else
  echo "No pending migrations."
fi

say "4/5 Content import"
npm run --silent content:import

say "5/5 Restart $SERVICE"
$SUDO systemctl restart "$SERVICE"; STOPPED=0
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then echo "API is up: $(curl -fsS "$HEALTH_URL")"; break; fi
  [ "$i" -eq 30 ] && { $SUDO journalctl -u "$SERVICE" -n 40 --no-pager || true; die "API did not answer $HEALTH_URL after 30 s"; }
  sleep 1
done

say "Health check after repair"
if health; then
  printf '\n\033[32mAll checks passed.\033[0m Backup kept at %s\n' "$BACKUP"
else
  printf '\n\033[31mSome checks still fail (see above).\033[0m Backup: %s\n' "$BACKUP"; exit 1
fi
