#!/usr/bin/env bash
# Recreate a database from scratch on a bare Postgres: bootstrap (Supabase stand-ins) + migrations.
# Usage: DATABASE_URL=postgres://postgres@127.0.0.1:54322/postgres scripts/db-reset.sh [dbname]
# For a real Supabase stack use `supabase db reset` instead (it applies the same migrations).
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL="${ADMIN_DATABASE_URL:-postgres://postgres@127.0.0.1:54322/postgres}"
DB="${1:-autoservice}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
TARGET="${ADMIN_URL%/*}/$DB"

psql "$TARGET" -v ON_ERROR_STOP=1 -q -f supabase/local/bootstrap.sql
for f in supabase/migrations/*.sql; do
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$f" || { echo "migration failed: $f" >&2; exit 1; }
done
echo "$TARGET"
