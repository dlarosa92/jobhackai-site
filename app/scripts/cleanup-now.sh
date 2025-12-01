#!/usr/bin/env bash
set -euo pipefail

# Direct cleanup using Cloudflare API
ACCOUNT_ID="fabf4409ef32f8c64354a1a099bef2a2"
KV_DEV="5237372648c34aa6880f91e1a0c9708a"
DEV_DB_ID="c5c0eee5-a223-4ea2-974e-f4aee5a28bab"
QA_DB_ID="80d87a73-6615-4823-b7a4-19a8821b4f87"

emails=("jobshackai@gmail.com" "dlarosa92@gmail.com" "sebastian.larosa@jobhackai.io")

echo "🧹 Cleaning up test user data..."
echo ""

# Get QA KV namespace ID
echo "Finding QA KV namespace..."
QA_KV=$(wrangler kv namespace list 2>&1 | grep -i "qa" | head -1 | grep -oE '[a-f0-9]{32}' | head -1 || echo "")

if [ -z "$QA_KV" ]; then
  echo "⚠️  Could not find QA KV namespace, will only clean DEV"
else
  echo "✅ Found QA KV: $QA_KV"
fi

echo ""
echo "Cleaning D1 databases..."

# Clean D1 - use wrangler with config file
cd "$(dirname "$0")/.."
for email in "${emails[@]}"; do
  echo "  Deleting $email from D1..."
  wrangler d1 execute --config=wrangler.local.toml --database-id="$DEV_DB_ID" --command="DELETE FROM users WHERE email = '$email';" --json 2>&1 | grep -q "success" && echo "    ✅ Dev DB" || echo "    ⚠️  Not found in Dev DB"
  if [ -n "$QA_KV" ]; then
    wrangler d1 execute --config=wrangler.local.toml --database-id="$QA_DB_ID" --command="DELETE FROM users WHERE email = '$email';" --json 2>&1 | grep -q "success" && echo "    ✅ QA DB" || echo "    ⚠️  Not found in QA DB"
  fi
done

echo ""
echo "✅ D1 cleanup complete"
echo ""
echo "For KV cleanup, the keys may not exist or may be in a different namespace."
echo "If you have CLOUDFLARE_API_TOKEN, you can run the full cleanup script."


