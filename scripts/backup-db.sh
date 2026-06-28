#!/usr/bin/env bash
# INSPECTA BUILDOS — PostgreSQL backup helper.
# Produces a compressed, timestamped dump. Safe to run from cron.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/db ./scripts/backup-db.sh [out_dir]
#
# Restore with: ./scripts/restore-db.sh <dump_file.sql.gz>
set -euo pipefail

OUT_DIR="${1:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/inspecta-${STAMP}.sql.gz"

echo "→ Dumping database to ${FILE} ..."
# --no-owner/--no-acl keep the dump portable across roles.
pg_dump --no-owner --no-acl --clean --if-exists "$DATABASE_URL" | gzip -9 > "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ Backup complete (${SIZE})."

# Prune old backups.
find "$OUT_DIR" -name 'inspecta-*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete \
  | sed 's/^/  pruned: /' || true

echo "✓ Done. Retention: ${RETENTION_DAYS} days."
