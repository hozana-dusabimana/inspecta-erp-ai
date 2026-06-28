#!/usr/bin/env bash
# INSPECTA BUILDOS — PostgreSQL restore helper.
# Restores a gzipped dump produced by backup-db.sh. DESTRUCTIVE: the dump uses
# --clean, so it drops and recreates objects in the target database.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/db ./scripts/restore-db.sh <dump.sql.gz>
set -euo pipefail

FILE="${1:-}"
if [ -z "${DATABASE_URL:-}" ]; then echo "ERROR: DATABASE_URL is not set." >&2; exit 1; fi
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then echo "ERROR: dump file not found: '$FILE'" >&2; exit 1; fi

echo "!! This will OVERWRITE the database at the target DATABASE_URL with: $FILE"
read -r -p "   Type 'RESTORE' to continue: " CONFIRM
[ "$CONFIRM" = "RESTORE" ] || { echo "Aborted."; exit 1; }

echo "→ Restoring ..."
gunzip -c "$FILE" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
echo "✓ Restore complete. Run 'npx prisma migrate status' / health check to verify."
