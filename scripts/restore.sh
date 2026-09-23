#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into an EMPTY database.
#   ./scripts/restore.sh backups/finance-portal-20260920-061500.dump [backups/....files.tar.gz]
# NEVER restore over a database that holds data you want to keep. Create a fresh database first:
#   createdb finance_portal_restored && DATABASE_URL=postgresql://.../finance_portal_restored ./scripts/restore.sh ...
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP="${1:?usage: restore.sh <dump> [files.tar.gz]}"
FILES="${2:-}"
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
DB_URL="${DATABASE_URL%%\?*}"
N="$(psql "$DB_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$N" != "0" ] && [ "${FORCE:-}" != "1" ]; then
  echo "Target database is not empty ($N tables). Restore into a fresh database, or set FORCE=1 if you really mean it." >&2
  exit 2
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DB_URL" "$DUMP"
if [ -n "$FILES" ]; then
  mkdir -p "${STORAGE_DIR:-./storage}"
  tar -xzf "$FILES" -C "${STORAGE_DIR:-./storage}"
fi
psql "$DB_URL" -Atc "select 'projects: ' || count(*) from projects"
echo "Restore finished. Start the app and sign in to verify."
