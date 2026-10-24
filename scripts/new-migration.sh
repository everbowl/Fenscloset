#!/usr/bin/env bash
# Creates a migration from the schema diff (prisma migrate dev needs a TTY) and applies it locally.
# Usage: npm run db:new-migration -- <name>
set -euo pipefail
name="${1:?migration name}"
dir="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_${name}"
mkdir -p "$dir"
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script 2>/dev/null | grep -v '^Loaded' > "$dir/migration.sql"
if [ ! -s "$dir/migration.sql" ]; then rmdir "$dir"; echo "No schema changes."; exit 1; fi
cat "$dir/migration.sql"
for db in fenscloset fenscloset_test fenscloset_e2e; do
  DATABASE_URL="postgresql://postgres@localhost:5433/$db" npx prisma migrate deploy 2>&1 | grep -E 'Applying|Error' || true
done
npx prisma generate >/dev/null
