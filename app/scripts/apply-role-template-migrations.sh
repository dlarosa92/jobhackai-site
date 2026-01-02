#!/bin/bash
# Apply role template migrations to dev, QA, and prod D1 databases
# 
# Usage:
#   CLOUDFLARE_API_TOKEN=your-token ./app/scripts/apply-role-template-migrations.sh
#
# Database IDs:
#   DEV:  c5c0eee5-a223-4ea2-974e-f4aee5a28bab
#   QA:   80d87a73-6615-4823-b7a4-19a8821b4f87
#   PROD: f9b709fd-56c3-4a0b-8141-4542327c9d4d

set -e

MIGRATION_FILE="./app/db/migrations/009_role_templates.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN environment variable required"
  echo "Usage: CLOUDFLARE_API_TOKEN=your-token $0"
  exit 1
fi

echo "Applying migration to DEV database..."
wrangler d1 execute jobhackai-dev-db --file="$MIGRATION_FILE" --remote || {
  echo "Warning: DEV migration failed. You may need to run manually:"
  echo "  wrangler d1 execute jobhackai-dev-db --file=$MIGRATION_FILE --remote"
}

echo ""
echo "Applying migration to QA database..."
wrangler d1 execute jobhackai-qa-db --file="$MIGRATION_FILE" --remote || {
  echo "Warning: QA migration failed. You may need to run manually:"
  echo "  wrangler d1 execute jobhackai-qa-db --file=$MIGRATION_FILE --remote"
}

echo ""
echo "Applying migration to PROD database..."
wrangler d1 execute jobhackai-prod-db --file="$MIGRATION_FILE" --remote || {
  echo "Warning: PROD migration failed. You may need to run manually:"
  echo "  wrangler d1 execute jobhackai-prod-db --file=$MIGRATION_FILE --remote"
}

echo ""
echo "Migration script complete. Check warnings above if any migrations failed."


