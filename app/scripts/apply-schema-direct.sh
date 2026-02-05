#!/usr/bin/env bash
# Direct schema application using Cloudflare API
# This bypasses wrangler's file upload which can be unreliable

set -euo pipefail

DB_NAME=$1
DB_ID=$2
SCHEMA_FILE=$3
API_TOKEN=${CLOUDFLARE_API_TOKEN}
ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID}

echo "Applying schema to $DB_NAME ($DB_ID)..."

# Read schema file and execute statements one by one
# SQLite/D1 doesn't support multi-statement execution well via API
# So we'll execute the whole file as one statement

SQL_CONTENT=$(cat "$SCHEMA_FILE")

# Execute via Cloudflare API
RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sql\":$(echo "$SQL_CONTENT" | jq -Rs .)}")

if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
  echo "✅ Schema applied successfully"
  exit 0
else
  echo "❌ Failed to apply schema:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

