#!/bin/bash
# Migration script for 007_add_plan_to_users.sql
# Applies migration to add plan column and subscription tracking to users table

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get repo root (assuming script is in app/scripts/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Migration file path
MIGRATION_FILE="$REPO_ROOT/app/db/migrations/007_add_plan_to_users.sql"

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}Error: Migration file not found: $MIGRATION_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}Migration 007: Add plan column to users table${NC}"
echo ""

# Function to check if column exists
check_column_exists() {
    local db_name=$1
    local column_name=$2
    # Query PRAGMA table_info and use exact column name matching
    # Use grep with word boundaries to avoid partial matches (e.g., "plan" matching "scheduled_plan")
    # The PRAGMA output is JSON, so we look for the exact column name in the "name" field
    # Use [[:space:]] instead of \s for POSIX ERE compatibility (works on BSD/macOS grep)
    # Capture stderr to detect authentication/connection errors instead of silently ignoring them
    local stdout_output
    local stderr_output
    local exit_code
    local temp_stderr
    
    temp_stderr=$(mktemp)
    
    # Capture stdout and stderr separately
    stdout_output=$(wrangler d1 execute "$db_name" \
        --command="PRAGMA table_info(users);" \
        --json 2>"$temp_stderr")
    exit_code=$?
    stderr_output=$(cat "$temp_stderr" 2>/dev/null || echo "")
    rm -f "$temp_stderr"
    
    # Check if wrangler command failed
    if [ $exit_code -ne 0 ]; then
        echo -e "${RED}Error checking column: wrangler command failed (exit code: $exit_code)${NC}" >&2
        if [ -n "$stderr_output" ]; then
            echo "$stderr_output" >&2
        fi
        return 1
    fi
    
    # Check stderr for error messages even if exit code was 0 (wrangler sometimes returns 0 with errors)
    if [ -n "$stderr_output" ] && echo "$stderr_output" | grep -qiE "(error|failed|unauthorized|authentication|couldn't find|not found)"; then
        echo -e "${RED}Error checking column: wrangler reported an error${NC}" >&2
        echo "$stderr_output" >&2
        return 1
    fi
    
    # Extract result from stdout using POSIX-compliant pattern
    local result=$(echo "$stdout_output" | grep -oE "\"name\"[[:space:]]*:[[:space:]]*\"${column_name}\"" || echo "")
    [ -n "$result" ]
}

# Function to check if migration is complete
# Migration 007 adds 10 columns total. We check for all critical columns to detect partial migrations.
check_migration_complete() {
    local db_name=$1
    # Check for all columns added by migration 007
    # These are the critical columns used by getUserPlanData and updateUserPlan
    local required_columns=(
        "plan"
        "stripe_customer_id"
        "stripe_subscription_id"
        "subscription_status"
        "trial_ends_at"
        "current_period_end"
        "cancel_at"
        "scheduled_plan"
        "scheduled_at"
        "plan_updated_at"
    )
    
    local missing_columns=()
    for column in "${required_columns[@]}"; do
        if ! check_column_exists "$db_name" "$column"; then
            missing_columns+=("$column")
        fi
    done
    
    if [ ${#missing_columns[@]} -eq 0 ]; then
        return 0  # All columns exist
    else
        # Return missing columns via global or echo (we'll use return code + echo)
        echo "${missing_columns[*]}"
        return 1  # Some columns missing
    fi
}

# Function to run migration
run_migration() {
    local db_name=$1
    local env_name=$2
    
    echo -e "${YELLOW}Checking $env_name database ($db_name)...${NC}"
    
    # Check if all migration columns exist (not just 'plan')
    # This detects partial migrations where only some columns were added
    local missing_cols
    missing_cols=$(check_migration_complete "$db_name")
    local migration_status=$?
    
    if [ $migration_status -eq 0 ]; then
        echo -e "${GREEN}✓ All migration columns already exist in $env_name database${NC}"
        echo -e "${YELLOW}  Skipping migration (migration already complete)${NC}"
        return 0
    fi
    
    # Some columns are missing - need to run migration
    if [ -n "$missing_cols" ]; then
        echo -e "${YELLOW}Missing columns detected: ${missing_cols}${NC}"
        echo -e "${YELLOW}Running migration to add missing columns...${NC}"
    else
        echo -e "${YELLOW}Migration columns not found. Running migration...${NC}"
    fi
    
    if wrangler d1 execute "$db_name" --file="$MIGRATION_FILE"; then
        echo -e "${GREEN}✓ Migration applied successfully to $env_name database${NC}"
        
        # Verify all columns exist after migration
        local verify_missing
        verify_missing=$(check_migration_complete "$db_name")
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Verification: All migration columns confirmed in $env_name database${NC}"
        else
            echo -e "${RED}✗ Warning: Migration completed but some columns are still missing: ${verify_missing}${NC}"
            echo -e "${YELLOW}  You may need to run the migration again or check for errors${NC}"
        fi
        return 0
    else
        echo -e "${RED}✗ Migration failed for $env_name database${NC}"
        echo -e "${YELLOW}  You can run manually with:${NC}"
        echo -e "${YELLOW}  wrangler d1 execute $db_name --file=$MIGRATION_FILE${NC}"
        return 1
    fi
}

# Database names
DEV_DB_NAME="jobhackai-dev-db"
QA_DB_NAME="jobhackai-qa-db"
PROD_DB_NAME="jobhackai-prod-db"

# Ask which environment to migrate
echo "Which environment(s) would you like to migrate?"
echo "1) Dev only"
echo "2) QA only"
echo "3) Production only"
echo "4) Dev + QA"
echo "5) All (Dev + QA + Production)"
echo ""
read -p "Enter choice [1-5]: " choice

case $choice in
    1)
        run_migration "$DEV_DB_NAME" "Dev"
        ;;
    2)
        run_migration "$QA_DB_NAME" "QA"
        ;;
    3)
        read -p "Are you sure you want to run this migration on Production? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            run_migration "$PROD_DB_NAME" "Production"
        else
            echo -e "${YELLOW}Migration cancelled.${NC}"
        fi
        ;;
    4)
        run_migration "$DEV_DB_NAME" "Dev"
        run_migration "$QA_DB_NAME" "QA"
        ;;
    5)
        read -p "Are you sure you want to run this migration on Production? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            run_migration "$DEV_DB_NAME" "Dev"
            run_migration "$QA_DB_NAME" "QA"
            run_migration "$PROD_DB_NAME" "Production"
            echo -e "${GREEN}Migration complete!${NC}"
        else
            run_migration "$DEV_DB_NAME" "Dev"
            run_migration "$QA_DB_NAME" "QA"
            echo -e "${YELLOW}Production migration skipped.${NC}"
            echo -e "${GREEN}Migration complete!${NC}"
        fi
        ;;
    *)
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}Migration 007 complete!${NC}"

