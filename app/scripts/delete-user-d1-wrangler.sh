#!/usr/bin/env bash
# One-time: Delete D1 data for a user in DEV and QA via wrangler.
# Usage: ./delete-user-d1-wrangler.sh <UID> [email]
# Auth: use `wrangler login` (OAuth), or set CLOUDFLARE_API_TOKEN (Account > D1 > Edit).
# Credentials via env only. Do not commit tokens.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

TARGET_UID="${1:?Usage: $0 <UID> [email]}"
EMAIL="${2:-}"

DEV_DB="jobhackai-dev-db"
QA_DB="jobhackai-qa-db"

# Auth: wrangler login (OAuth) or CLOUDFLARE_API_TOKEN. No token => use OAuth.
# Auth check: fail fast if D1 access fails
echo "Checking D1 API access..."
if ! npx wrangler d1 execute "$DEV_DB" --command "SELECT 1;" --remote --json >/dev/null 2>&1; then
  echo "Error: D1 API auth failed. Run 'wrangler login' or set CLOUDFLARE_API_TOKEN (Account > D1 > Edit)."
  exit 1
fi
echo "OK"

run_sql() {
  local db_name=$1
  local sql=$2
  npx wrangler d1 execute "$db_name" --command "$sql" --remote >/dev/null
}

run_for_db() {
  local db_name=$1
  local label=$2

  echo ""
  echo "--- $label ---"

  local raw
  raw=$(npx wrangler d1 execute "$db_name" --command "SELECT id FROM users WHERE auth_id = '$TARGET_UID' LIMIT 1;" --remote --json 2>/dev/null) || true
  local user_id=""
  if echo "$raw" | grep -q '"success":\s*true'; then
    user_id=$(echo "$raw" | grep -oE '"id":\s*[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
  fi

  if [ -n "$user_id" ]; then
    echo "  users: found id=$user_id"
    run_sql "$db_name" "DELETE FROM users WHERE id = $user_id;"
    echo "  users: deleted"
  else
    echo "  users: no row for auth_id"
  fi

  run_sql "$db_name" "DELETE FROM linkedin_runs WHERE user_id = '$TARGET_UID';"
  echo "  linkedin_runs: deleted"

  run_sql "$db_name" "DELETE FROM role_usage_log WHERE user_id = '$TARGET_UID';"
  echo "  role_usage_log: deleted"

  if [ -n "$EMAIL" ]; then
    raw=$(npx wrangler d1 execute "$db_name" --command "SELECT id FROM users WHERE email = '$EMAIL' LIMIT 1;" --remote --json 2>/dev/null || true)
    local eid=""
    if echo "$raw" | grep -q '"success":\s*true'; then
      eid=$(echo "$raw" | grep -oE '"id":\s*[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
    fi
    if [ -n "$eid" ] && [ "$eid" != "$user_id" ]; then
      run_sql "$db_name" "DELETE FROM users WHERE id = $eid;"
      echo "  users (by email): deleted extra id=$eid"
    fi
  fi
}

echo "Deleting D1 data for UID=$TARGET_UID${EMAIL:+ ($EMAIL)}"
run_for_db "$DEV_DB" "DEV"
run_for_db "$QA_DB" "QA"
echo ""
echo "Done."
