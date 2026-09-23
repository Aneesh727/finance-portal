#!/usr/bin/env bash
# Full PostgreSQL backup (schema + data) + the uploaded files, with retention.
#   ./scripts/backup.sh                 -> ./backups/finance-portal-YYYYmmdd-HHMMSS.{dump,files.tar.gz}
#   BACKUP_DIR=/mnt/backups KEEP_DAYS=30 ./scripts/backup.sh
# Requires pg_dump (client version >= server version). Reads DATABASE_URL from the environment or .env.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
DB_URL="${DATABASE_URL%%\?*}"            # pg_dump does not understand ?schema=public
DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
umask 077
pg_dump --format=custom --no-owner --no-privileges --file="$DIR/finance-portal-$STAMP.dump" "$DB_URL"
STORAGE="${STORAGE_DIR:-./storage}"
if [ -d "$STORAGE" ] && [ -n "$(ls -A "$STORAGE" 2>/dev/null)" ]; then
  tar -czf "$DIR/finance-portal-$STAMP.files.tar.gz" -C "$STORAGE" .
fi
# verify the dump is readable before we trust it
pg_restore --list "$DIR/finance-portal-$STAMP.dump" > /dev/null
find "$DIR" -name 'finance-portal-*' -type f -mtime +"$KEEP" -delete
echo "Backup written: $DIR/finance-portal-$STAMP.dump ($(du -h "$DIR/finance-portal-$STAMP.dump" | cut -f1))"
