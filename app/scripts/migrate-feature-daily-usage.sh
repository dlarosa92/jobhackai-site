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

# Database names
QA_DB="jobhackai-qa-db"
PROD_DB="jobhackai-prod-db"

# Migration file path
MIGRATION_FILE="app/db/migrations/002_add_feature_daily_usage.sql"

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}Error: Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

# Function to check if table exists
check_table_exists() {
    local db_name=$1
    local result=$(wrangler d1 execute "$db_name" \
        --command="SELECT name FROM sqlite_master WHERE type='table' AND name='feature_daily_usage';" \
        2>/dev/null | grep -c "feature_daily_usage" || echo "0")
    
    if [ "$result" -gt 0 ]; then
        return 0  # Table exists
    else
        return 1  # Table does not exist
    fi
}

# Function to run migration
run_migration() {
    local db_name=$1
    local env_name=$2
    
    echo -e "${YELLOW}Checking $env_name database ($db_name)...${NC}"
    
    # Check if table already exists
    if check_table_exists "$db_name"; then
        echo -e "${GREEN}✓ Table 'feature_daily_usage' already exists in $env_name database${NC}"
        echo -e "${YELLOW}  Skipping migration (table already present)${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}Table 'feature_daily_usage' not found. Running migration...${NC}"
    
    # Run migration
    if wrangler d1 execute "$db_name" --file="$MIGRATION_FILE"; then
        echo -e "${GREEN}✓ Migration applied successfully to $env_name database${NC}"
        
        # Verify table was created
        if check_table_exists "$db_name"; then
            echo -e "${GREEN}✓ Verified: Table 'feature_daily_usage' now exists in $env_name database${NC}"
            return 0
        else
            echo -e "${RED}✗ Warning: Migration completed but table verification failed${NC}"
            return 1
        fi
    else
        echo -e "${RED}✗ Migration failed for $env_name database${NC}"
        return 1
    fi
}

# Main execution
ENVIRONMENT=${1:-"both"}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Feature Daily Usage Migration${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

case "$ENVIRONMENT" in
    qa)
        run_migration "$QA_DB" "QA"
        ;;
    prod|production)
        echo -e "${RED}⚠️  WARNING: You are about to modify the PRODUCTION database${NC}"
        echo -e "${YELLOW}This will create the feature_daily_usage table in production.${NC}"
        echo ""
        read -p "Are you sure you want to continue? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo -e "${YELLOW}Migration cancelled.${NC}"
            exit 0
        fi
        run_migration "$PROD_DB" "Production"
        ;;
    both)
        run_migration "$QA_DB" "QA"
        echo ""
        run_migration "$PROD_DB" "Production"
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

