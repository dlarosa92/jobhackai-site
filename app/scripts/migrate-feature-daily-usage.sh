#!/bin/bash

# Migration script for feature_daily_usage table
# Applies migration 002_add_feature_daily_usage.sql to QA and Production databases
#
# Usage:
#   ./migrate-feature-daily-usage.sh qa      # Run on QA database
#   ./migrate-feature-daily-usage.sh prod    # Run on Production database
#   ./migrate-feature-daily-usage.sh both    # Run on both QA and Production

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Database UUIDs (from wrangler.toml)
# These can be used directly with wrangler d1 execute
QA_DB_UUID="80d87a73-6615-4823-b7a4-19a8821b4f87"  # jobhackai-qa-db
PROD_DB_UUID="f9b709fd-56c3-4a0b-8141-4542327c9d4d"  # jobhackai-prod-db

# Database names (for display)
QA_DB_NAME="jobhackai-qa-db"
PROD_DB_NAME="jobhackai-prod-db"

# Get script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Migration file path (relative to repo root)
MIGRATION_FILE="$REPO_ROOT/app/db/migrations/002_add_feature_daily_usage.sql"

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}Error: Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

# Function to check if table exists
check_table_exists() {
    local db_uuid=$1
    # Use UUID as positional argument (wrangler accepts UUIDs as database names)
    local result=$(wrangler d1 execute "$db_uuid" \
        --command="SELECT name FROM sqlite_master WHERE type='table' AND name='feature_daily_usage';" \
        2>/dev/null | grep -o "feature_daily_usage" | wc -l | tr -d ' ' || echo "0")
    
    # Handle case where result is empty or non-numeric
    if [ -z "$result" ] || [ "$result" = "" ]; then
        result=0
    fi
    
    # Convert to integer for comparison
    result=$((result + 0))
    
    if [ "$result" -gt 0 ]; then
        return 0  # Table exists
    else
        return 1  # Table does not exist
    fi
}

# Function to run migration
run_migration() {
    local db_uuid=$1
    local db_name=$2
    local env_name=$3
    
    echo -e "${YELLOW}Checking $env_name database ($db_name)...${NC}"
    
    # Check if table already exists
    if check_table_exists "$db_uuid"; then
        echo -e "${GREEN}✓ Table 'feature_daily_usage' already exists in $env_name database${NC}"
        echo -e "${YELLOW}  Skipping migration (table already present)${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}Table 'feature_daily_usage' not found. Running migration...${NC}"
    
    # Run migration using UUID as positional argument
    # wrangler d1 execute accepts UUIDs directly as the database identifier
    if wrangler d1 execute "$db_uuid" --file="$MIGRATION_FILE"; then
        echo -e "${GREEN}✓ Migration applied successfully to $env_name database${NC}"
        
        # Verify table was created
        if check_table_exists "$db_uuid"; then
            echo -e "${GREEN}✓ Verified: Table 'feature_daily_usage' now exists in $env_name database${NC}"
            return 0
        else
            echo -e "${RED}✗ Warning: Migration completed but table verification failed${NC}"
            return 1
        fi
    else
        echo -e "${RED}✗ Migration failed for $env_name database${NC}"
        echo -e "${YELLOW}  You can also run manually:${NC}"
        echo -e "${YELLOW}  wrangler d1 execute $db_uuid --file=$MIGRATION_FILE${NC}"
        return 1
    fi
}

# Function to handle production confirmation
confirm_production() {
    echo -e "${RED}⚠️  WARNING: You are about to modify the PRODUCTION database${NC}"
    echo -e "${YELLOW}This will create the feature_daily_usage table in production.${NC}"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo -e "${YELLOW}Migration cancelled.${NC}"
        return 1
    fi
    return 0
}

# Main execution
ENVIRONMENT=${1:-""}

# If no environment provided, show usage and exit
if [ -z "$ENVIRONMENT" ]; then
    echo -e "${RED}Error: No environment specified.${NC}"
    echo ""
    echo "Usage:"
    echo "  $0 qa      # Run on QA database"
    echo "  $0 prod    # Run on Production database"
    echo "  $0 both    # Run on both QA and Production"
    exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Feature Daily Usage Migration${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

case "$ENVIRONMENT" in
    qa)
        run_migration "$QA_DB_UUID" "$QA_DB_NAME" "QA"
        ;;
    prod|production)
        if confirm_production; then
            run_migration "$PROD_DB_UUID" "$PROD_DB_NAME" "Production"
        else
            exit 0
        fi
        ;;
    both)
        run_migration "$QA_DB_UUID" "$QA_DB_NAME" "QA"
        echo ""
        if confirm_production; then
            run_migration "$PROD_DB_UUID" "$PROD_DB_NAME" "Production"
        else
            echo -e "${YELLOW}Skipping production migration.${NC}"
        fi
        ;;
    *)
        echo -e "${RED}Error: Invalid environment. Use 'qa', 'prod', or 'both'${NC}"
        echo ""
        echo "Usage:"
        echo "  $0 qa      # Run on QA database"
        echo "  $0 prod    # Run on Production database"
        echo "  $0 both    # Run on both QA and Production"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Migration complete!${NC}"
echo -e "${GREEN}========================================${NC}"

