#!/usr/bin/env bash
set -euo pipefail

# D1 Database Setup Script
# Automates creation of D1 databases, schema application, and Cloudflare Pages binding configuration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEV_DB_NAME="jobhackai-dev-db"
QA_DB_NAME="jobhackai-qa-db"
PROD_DB_NAME="jobhackai-prod-db"

DEV_PROJECT="jobhackai-app-dev"
QA_PROJECT="jobhackai-app-qa"
PROD_PROJECT="jobhackai-app-prod"

SCHEMA_FILE="$APP_DIR/db/schema.sql"

# Check prerequisites
check_prerequisites() {
  echo -e "${BLUE}🔍 Checking prerequisites...${NC}"
  
  if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ wrangler CLI not found. Install with: npm install -g wrangler${NC}"
    exit 1
  fi
  
  if [ ! -f "$SCHEMA_FILE" ]; then
    echo -e "${RED}❌ Schema file not found: $SCHEMA_FILE${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}✅ Prerequisites check passed${NC}\n"
}

# Prompt for Cloudflare credentials
get_credentials() {
  echo -e "${BLUE}📝 Cloudflare Credentials Required${NC}"
  echo -e "${YELLOW}You can get these from:${NC}"
  echo -e "  - API Token: https://dash.cloudflare.com/profile/api-tokens"
  echo -e "  - Account ID: https://dash.cloudflare.com → Right sidebar\n"
  
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    if [ -t 0 ]; then
      # Interactive terminal
      read -sp "Enter Cloudflare API Token (with Pages:Edit permission): " CLOUDFLARE_API_TOKEN
      echo ""
    else
      # Non-interactive - check for command line arg
      if [ $# -ge 1 ]; then
        CLOUDFLARE_API_TOKEN="$1"
      else
        echo -e "${RED}❌ CLOUDFLARE_API_TOKEN not set. Set as environment variable or pass as first argument.${NC}"
        echo -e "${YELLOW}Usage: CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy ./scripts/setup-d1.sh${NC}"
        exit 1
      fi
    fi
    export CLOUDFLARE_API_TOKEN
  else
    echo -e "${GREEN}✅ Using CLOUDFLARE_API_TOKEN from environment${NC}"
  fi
  
  if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    if [ -t 0 ]; then
      # Interactive terminal
      read -p "Enter Cloudflare Account ID: " CLOUDFLARE_ACCOUNT_ID
    else
      # Non-interactive - check for command line arg
      if [ $# -ge 2 ]; then
        CLOUDFLARE_ACCOUNT_ID="$2"
      else
        echo -e "${RED}❌ CLOUDFLARE_ACCOUNT_ID not set. Set as environment variable or pass as second argument.${NC}"
        echo -e "${YELLOW}Usage: CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy ./scripts/setup-d1.sh${NC}"
        exit 1
      fi
    fi
    export CLOUDFLARE_ACCOUNT_ID
  else
    echo -e "${GREEN}✅ Using CLOUDFLARE_ACCOUNT_ID from environment${NC}"
  fi
  
  echo ""
}

# Create D1 database
create_database() {
  local db_name=$1
  echo -e "${BLUE}📦 Creating D1 database: $db_name${NC}"
  
  # Check if database already exists
  # Try JSON output first (more reliable)
  local db_id=$(wrangler d1 list --json 2>/dev/null | jq -r ".[] | select(.name == \"$db_name\") | .uuid" 2>/dev/null)
  
  if [ -z "$db_id" ] || [ "$db_id" = "null" ]; then
    # Fallback to table parsing
    local list_output=$(wrangler d1 list 2>/dev/null)
    if echo "$list_output" | grep -q "$db_name"; then
      # Extract UUID from table format (second column after pipe separator)
      db_id=$(echo "$list_output" | grep "$db_name" | awk -F'│' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' | head -1)
    fi
  fi
  
  if [ -n "$db_id" ] && [ "${#db_id}" -eq 36 ]; then
    echo -e "${YELLOW}⚠️  Database $db_name already exists, skipping creation${NC}"
    echo -e "${GREEN}✅ Using existing database ID: $db_id${NC}\n"
    echo "$db_id"
    return
  fi
  
  # Create database and extract ID
  local output=$(wrangler d1 create "$db_name" 2>&1)
  echo "$output"
  
  # Extract database ID from output (macOS-compatible)
  local db_id=$(echo "$output" | grep -o 'database_id = "[^"]*"' | sed 's/database_id = "//;s/"//' | head -1)
  
  if [ -z "$db_id" ]; then
    echo -e "${RED}❌ Failed to extract database ID from output${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}✅ Created database $db_name with ID: $db_id${NC}\n"
  echo "$db_id"
}

# Apply schema to database
apply_schema() {
  local db_name=$1
  local db_id=$2
  local is_local=${3:-false}
  
  echo -e "${BLUE}📋 Applying schema to $db_name${NC}"
  
  if [ "$is_local" = "true" ]; then
    # For local, use wrangler
    if wrangler d1 execute "$db_name" --file="$SCHEMA_FILE" --local 2>&1; then
      echo -e "${GREEN}✅ Schema applied successfully${NC}\n"
    else
      echo -e "${RED}❌ Failed to apply schema locally${NC}"
      exit 1
    fi
  else
    # For remote, use Cloudflare API directly (more reliable than wrangler)
    local sql_content=$(cat "$SCHEMA_FILE")
    local sql_json=$(echo "$sql_content" | jq -Rs .)
    
    local response=$(curl -s -X POST \
      "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${db_id}/query" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"sql\":$sql_json}")
    
    # Check if response indicates success
    # API can return either {success: true} or {result: [{success: true}]}
    local success_check=$(echo "$response" | jq -r '.success // .result[0].success // "false"' 2>/dev/null)
    if [ "$success_check" = "true" ]; then
      echo -e "${GREEN}✅ Schema applied successfully${NC}\n"
    else
      echo -e "${RED}❌ Failed to apply schema${NC}"
      echo "Response:"
      echo "$response" | jq '.' 2>/dev/null || echo "$response" | head -30
      exit 1
    fi
  fi
}

# Verify schema
verify_schema() {
  local db_name=$1
  echo -e "${BLUE}🔍 Verifying schema for $db_name${NC}"
  
  local tables=$(wrangler d1 execute "$db_name" --command="SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null | grep -E 'users|resume_sessions|feedback_sessions|usage_events' | wc -l | tr -d ' ')
  
  if [ "$tables" -eq 4 ]; then
    echo -e "${GREEN}✅ All 4 tables found${NC}\n"
  else
    echo -e "${YELLOW}⚠️  Expected 4 tables, found $tables${NC}\n"
  fi
}

# Configure D1 binding in Cloudflare Pages via API
configure_pages_binding() {
  local project_name=$1
  local db_name=$2
  local db_id=$3
  
  echo -e "${BLUE}🔗 Configuring D1 binding for $project_name${NC}"
  
  # Get project ID first
  local project_id=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" | \
    jq -r ".result[] | select(.name == \"$project_name\") | .id")
  
  if [ -z "$project_id" ] || [ "$project_id" = "null" ]; then
    echo -e "${YELLOW}⚠️  Project $project_name not found, skipping binding configuration${NC}"
    echo -e "${YELLOW}   You'll need to configure this manually in the Cloudflare Dashboard${NC}\n"
    return
  fi
  
  # Check if binding already exists
  local existing_bindings=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project_id}/deployments" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" | \
    jq -r '.result[0].deployment_trigger.config.d1_databases // []' 2>/dev/null || echo "[]")
  
  # Get deployment config
  local deployment_config=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project_id}/deployments" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" | \
    jq -r '.result[0].deployment_trigger.config' 2>/dev/null || echo "{}")
  
  # Note: Cloudflare Pages API doesn't directly support updating D1 bindings
  # They need to be configured via the dashboard or during deployment
  # We'll provide instructions instead
  echo -e "${YELLOW}ℹ️  D1 bindings must be configured in Cloudflare Dashboard:${NC}"
  echo -e "   1. Go to: Workers & Pages → $project_name"
  echo -e "   2. Settings → Functions → D1 database bindings"
  echo -e "   3. Add binding: Variable name 'DB', Database '$db_name'"
  echo -e "   4. Database ID: $db_id\n"
}

# Main setup function
main() {
  echo -e "${GREEN}🚀 Starting D1 Database Setup${NC}\n"
  
  check_prerequisites
  get_credentials
  
  cd "$APP_DIR"
  
  # Create databases
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}Step 1: Creating D1 Databases${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  
  DEV_DB_ID=$(create_database "$DEV_DB_NAME")
  QA_DB_ID=$(create_database "$QA_DB_NAME")
  PROD_DB_ID=$(create_database "$PROD_DB_NAME")
  
  # Apply schema
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}Step 2: Applying Schema${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  
  apply_schema "$DEV_DB_NAME" "$DEV_DB_ID"
  apply_schema "$QA_DB_NAME" "$QA_DB_ID"
  apply_schema "$PROD_DB_NAME" "$PROD_DB_ID"
  
  # Apply schema locally
  echo -e "${BLUE}Applying schema to local DEV database...${NC}"
  apply_schema "$DEV_DB_NAME" "$DEV_DB_ID" true
  
  # Verify schema
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}Step 3: Verifying Schema${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  
  verify_schema "$DEV_DB_NAME"
  verify_schema "$QA_DB_NAME"
  verify_schema "$PROD_DB_NAME"
  
  # Update wrangler.local.toml
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}Step 4: Updating Local Configuration${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  
  update_wrangler_local "$DEV_DB_ID"
  
  # Configure Pages bindings
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}Step 5: Configuring Cloudflare Pages Bindings${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  
  configure_pages_binding "$DEV_PROJECT" "$DEV_DB_NAME" "$DEV_DB_ID"
  configure_pages_binding "$QA_PROJECT" "$QA_DB_NAME" "$QA_DB_ID"
  configure_pages_binding "$PROD_PROJECT" "$PROD_DB_NAME" "$PROD_DB_ID"
  
  # Summary
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo -e "${GREEN}✅ Setup Complete!${NC}"
  echo -e "${GREEN}════════════════════════════════════════${NC}\n"
  
  echo -e "${BLUE}Database IDs:${NC}"
  echo -e "  DEV:  $DEV_DB_NAME → $DEV_DB_ID"
  echo -e "  QA:   $QA_DB_NAME → $QA_DB_ID"
  echo -e "  PROD: $PROD_DB_NAME → $PROD_DB_ID\n"
  
  echo -e "${YELLOW}⚠️  Next Steps:${NC}"
  echo -e "  1. Configure D1 bindings in Cloudflare Dashboard (see instructions above)"
  echo -e "  2. Test locally: wrangler pages dev ./out --d1=DB"
  echo -e "  3. Deploy and test on dev.jobhackai.io\n"
}

# Update wrangler.local.toml with D1 binding
update_wrangler_local() {
  local db_id=$1
  local wrangler_file="$APP_DIR/wrangler.local.toml"
  
  echo -e "${BLUE}📝 Updating $wrangler_file${NC}"
  
  # Check if D1 binding already exists
  if grep -q "\[\[d1_databases\]\]" "$wrangler_file"; then
    echo -e "${YELLOW}⚠️  D1 binding already exists in wrangler.local.toml${NC}"
    echo -e "${YELLOW}   Updating database_id...${NC}"
    
    # Update existing binding
    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS
      sed -i '' "s/database_id = \".*\"/database_id = \"$db_id\"/" "$wrangler_file"
    else
      # Linux
      sed -i "s/database_id = \".*\"/database_id = \"$db_id\"/" "$wrangler_file"
    fi
  else
    # Add new binding
    cat >> "$wrangler_file" << EOF

# D1 database binding for local development
[[d1_databases]]
binding = "DB"
database_name = "$DEV_DB_NAME"
database_id = "$db_id"
EOF
  fi
  
  echo -e "${GREEN}✅ Updated wrangler.local.toml${NC}\n"
}

# Run main function
main "$@"

