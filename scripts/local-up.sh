#!/usr/bin/env bash
# Local stack WITHOUT Docker: Postgres (yours) + local gateway + both demo studios + Vite dev server.
# Needs a running Postgres reachable via ADMIN_DATABASE_URL (superuser), e.g. Postgres.app on macOS.
# With Docker available prefer the real thing: `pnpm supabase start` (see SETUP.md).
set -euo pipefail
cd "$(dirname "$0")/.."

export ADMIN_DATABASE_URL="${ADMIN_DATABASE_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
export GATEWAY_PORT="${GATEWAY_PORT:-54321}"
export GATEWAY_JWT_SECRET="${GATEWAY_JWT_SECRET:-local-gateway-secret-not-for-production-use-0001}"

export DATABASE_URL="$(bash scripts/db-reset.sh autoservice_dev | tail -n1)"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f supabase/seed.sql

LOG="$(mktemp)"
pkill -f "scripts/local-gateway/server[.]ts" 2>/dev/null || true
npx tsx scripts/local-gateway/server.ts >"$LOG" 2>&1 &
GW_PID=$!
trap 'kill $GW_PID 2>/dev/null || true; pkill -f "scripts/local-gateway/server[.]ts" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null && break; sleep 0.2; done

export SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT"
export SUPABASE_ANON_KEY="$(grep '^VITE_SUPABASE_ANON_KEY=' "$LOG" | cut -d= -f2-)"
export SUPABASE_SERVICE_ROLE_KEY="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$LOG" | cut -d= -f2-)"
cat > .env.local <<ENV
# written by scripts/local-up.sh — local gateway, not for production
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
SUPABASE_URL=$SUPABASE_URL
SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL=$DATABASE_URL
ENV

npx tsx scripts/tenant/publish.ts ngx-detailing
npx tsx scripts/tenant/publish.ts tork-service

echo
echo "Клиенты:   http://localhost:5173/s/ngx-detailing/   и   /s/tork-service/"
echo "Кабинет:   http://localhost:5173/s/ngx-detailing/owner/  (owner+ngx@example.com / demo-ngx-2026)"
echo
npx vite --host
