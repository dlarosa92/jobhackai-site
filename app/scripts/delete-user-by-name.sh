#!/usr/bin/env bash
set -euo pipefail

# Delete all KV and D1 data for a user in DEV and QA using database names
# Usage: CLOUDFLARE_API_TOKEN="..." ./delete-user-by-name.sh <UID> [email]
#
# IMPORTANT: The API token must have the following permissions:
# - Account.Cloudflare D1:Edit
# - Account.Cloudflare Workers:Edit (for KV)
# See API_TOKEN_SETUP.md for detailed instructions

TARGET_UID="${1:?Usage: $0 <UID> [email]}"
EMAIL="${2:-}"

# Cloudflare credentials (from environment)
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-fabf4409ef32f8c64354a1a099bef2a2}"

# Database names (as used in wrangler.toml)
DEV_DB_NAME="jobhackai-dev-db"
QA_DB_NAME="jobhackai-qa-db"

# KV namespace ID
KV_NAMESPACE_ID="5237372648c34aa6880f91e1a0c9708a"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${YELLOW}Deleting all data for UID: ${TARGET_UID}${EMAIL:+ (${EMAIL})}${NC}"
echo -e "${YELLOW}Environments: DEV and QA${NC}\n"

# Function to execute D1 SQL via wrangler
d1_execute() {
  local db_name=$1
  local sql=$2
  local response=$(npx wrangler d1 execute "$db_name" \
    --command "$sql" \
    --remote \
    --json 2>&1)
  
  echo "$response"
}

# Function to delete D1 user data
delete_d1_user() {
  local db_name=$1
  local db_label=$2
  
  echo -e "${BLUE}Deleting D1 data from ${db_label} (${db_name})...${NC}"
  
  # First, find user by auth_id
  local check_response=$(d1_execute "$db_name" "SELECT id, email FROM users WHERE auth_id = '${TARGET_UID}' LIMIT 1;")
  local success=$(echo "$check_response" | jq -r '.success // false' 2>/dev/null || echo "false")
  
  if [ "$success" != "true" ]; then
    echo -e "  ${RED}❌ Error querying database:${NC}"
    echo "$check_response" | jq -r '.error // .errors[0].message // "Unknown error"' 2>/dev/null || echo "$check_response" | head -5
    return 1
  fi
  
  local user_id=$(echo "$check_response" | jq -r '.results[0].id // empty' 2>/dev/null || echo "")
  local user_email=$(echo "$check_response" | jq -r '.results[0].email // empty' 2>/dev/null || echo "")
  
  if [ -n "$user_id" ] && [ "$user_id" != "null" ]; then
    echo -e "  ${GREEN}✓ Found user with id=${user_id}${EMAIL:+ email=${user_email}}${NC}"
    
    # Delete from tables without cascade first
    echo -e "  ${BLUE}Deleting records without cascade...${NC}"
    
    d1_execute "$db_name" "DELETE FROM linkedin_runs WHERE user_id = '${TARGET_UID}';" >/dev/null 2>&1
    echo -e "    ${GREEN}✓ Deleted linkedin_runs${NC}"
    
    d1_execute "$db_name" "DELETE FROM role_usage_log WHERE user_id = '${TARGET_UID}';" >/dev/null 2>&1
    echo -e "    ${GREEN}✓ Deleted role_usage_log${NC}"
    
    d1_execute "$db_name" "DELETE FROM cover_letter_history WHERE user_id = '${TARGET_UID}';" >/dev/null 2>&1
    echo -e "    ${GREEN}✓ Deleted cover_letter_history${NC}"
    
    # Delete from tables with cascade (will be deleted automatically, but doing explicitly for clarity)
    d1_execute "$db_name" "DELETE FROM resume_sessions WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM feedback_sessions WHERE resume_session_id IN (SELECT id FROM resume_sessions WHERE user_id = ${user_id});" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM usage_events WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM interview_question_sets WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM mock_interview_sessions WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM mock_interview_usage WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM feature_daily_usage WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM cookie_consents WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    d1_execute "$db_name" "DELETE FROM plan_change_history WHERE user_id = ${user_id};" >/dev/null 2>&1 || true
    
    # Finally delete the user (this will cascade delete any remaining records)
    local delete_response=$(d1_execute "$db_name" "DELETE FROM users WHERE id = ${user_id};")
    local delete_success=$(echo "$delete_response" | jq -r '.success // false' 2>/dev/null || echo "false")
    
    if [ "$delete_success" = "true" ]; then
      local rows_deleted=$(echo "$delete_response" | jq -r '.meta.rows_written // 0' 2>/dev/null || echo "0")
      echo -e "    ${GREEN}✓ Deleted user (${rows_deleted} rows)${NC}"
    else
      echo -e "    ${RED}❌ Error deleting user:${NC}"
      echo "$delete_response" | jq -r '.error // .errors[0].message // "Unknown error"' 2>/dev/null || echo "$delete_response" | head -5
    fi
  else
    echo -e "  ${YELLOW}⚠ No user found with auth_id=${TARGET_UID}${NC}"
  fi
  
  # Also try to delete by email if provided
  if [ -n "$EMAIL" ]; then
    local email_check=$(d1_execute "$db_name" "SELECT id FROM users WHERE email = '${EMAIL}' LIMIT 1;")
    local email_success=$(echo "$email_check" | jq -r '.success // false' 2>/dev/null || echo "false")
    
    if [ "$email_success" = "true" ]; then
      local email_user_id=$(echo "$email_check" | jq -r '.results[0].id // empty' 2>/dev/null || echo "")
      
      if [ -n "$email_user_id" ] && [ "$email_user_id" != "null" ] && [ "$email_user_id" != "$user_id" ]; then
        echo -e "  ${GREEN}✓ Found additional user by email with id=${email_user_id}${NC}"
        d1_execute "$db_name" "DELETE FROM users WHERE id = ${email_user_id};" >/dev/null 2>&1
        echo -e "    ${GREEN}✓ Deleted user by email${NC}"
      fi
    fi
  fi
  
  echo -e "  ${GREEN}✅ D1 cleanup complete for ${db_label}${NC}\n"
}

# Function to delete KV key
delete_kv_key() {
  local key=$1
  local encoded_key=$(echo -n "$key" | jq -sRr @uri)
  
  local response=$(curl -s -X DELETE \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encoded_key}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")
  
  local success=$(echo "$response" | jq -r '.success // false')
  if [ "$success" = "true" ]; then
    return 0
  else
    # Check if error is "key not found" (which is fine)
    local error_code=$(echo "$response" | jq -r '.errors[0].code // ""')
    if [ "$error_code" = "10009" ]; then
      return 0  # Key doesn't exist, that's fine
    fi
    return 1
  fi
}

# Delete KV keys
echo -e "${BLUE}Deleting KV keys from namespace ${KV_NAMESPACE_ID}...${NC}"

keys=(
  "planByUid:${TARGET_UID}"
  "cusByUid:${TARGET_UID}"
  "trialEndByUid:${TARGET_UID}"
  "cancelAtByUid:${TARGET_UID}"
  "periodEndByUid:${TARGET_UID}"
  "scheduledPlanByUid:${TARGET_UID}"
  "scheduledAtByUid:${TARGET_UID}"
  "planTsByUid:${TARGET_UID}"
  "trialUsedByUid:${TARGET_UID}"
  "usage:${TARGET_UID}"
  "user:${TARGET_UID}"
  "session:${TARGET_UID}"
  "creditsByUid:${TARGET_UID}"
  "atsUsage:${TARGET_UID}"
  "feedbackUsage:${TARGET_UID}"
  "rewriteUsage:${TARGET_UID}"
  "mockInterviewUsage:${TARGET_UID}"
  "throttle:${TARGET_UID}"
  "user:${TARGET_UID}:lastResume"
  "iq_cooldown:${TARGET_UID}"
  "iq_lock:${TARGET_UID}"
  "atsUsage:${TARGET_UID}:lifetime"
  "emailByUid:${TARGET_UID}"
)

deleted=0
for key in "${keys[@]}"; do
  if delete_kv_key "$key" 2>/dev/null; then
    echo -e "  ${GREEN}✓ Deleted: $key${NC}"
    deleted=$((deleted + 1))
  fi
done

# Search for resume keys
echo -e "  ${BLUE}Searching for resume keys...${NC}"
resume_deleted=0
cursor=""
max_iterations=100
iteration=0

while [ $iteration -lt $max_iterations ]; do
  iteration=$((iteration + 1))
  
  url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys"
  params=""
  if [ -n "$cursor" ]; then
    params="?cursor=${cursor}"
  fi
  
  response=$(curl -s -X GET "${url}${params}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")
  
  success=$(echo "$response" | jq -r '.success // false')
  if [ "$success" != "true" ]; then
    # Check for rate limiting
    error_code=$(echo "$response" | jq -r '.errors[0].code // ""')
    if [ "$error_code" = "10429" ]; then
      echo -e "  ${YELLOW}⚠ Rate limited, waiting 3 seconds...${NC}"
      sleep 3
      continue
    fi
    error_msg=$(echo "$response" | jq -r '.errors[0].message // "Unknown error"' 2>/dev/null || echo "Unknown error")
    echo -e "  ${RED}❌ Error listing keys: ${error_msg}${NC}"
    break
  fi
  
  keys=$(echo "$response" | jq -r ".result[]?.name // empty" | grep "^resume:.*${TARGET_UID}" || true)
  if [ -n "$keys" ]; then
    while IFS= read -r key; do
      if [ -n "$key" ]; then
        if delete_kv_key "$key" 2>/dev/null; then
          echo -e "  ${GREEN}✓ Deleted: $key${NC}"
          resume_deleted=$((resume_deleted + 1))
        fi
        sleep 0.5  # Rate limit protection
      fi
    done <<< "$keys"
  fi
  
  cursor=$(echo "$response" | jq -r '.result_info.cursor // empty' 2>/dev/null || echo "")
  if [ -z "$cursor" ] || [ "$cursor" = "null" ]; then
    break
  fi
  
  sleep 1  # Rate limit protection between pages
done

echo -e "  ${GREEN}✅ Deleted ${deleted} standard KV keys + ${resume_deleted} resume keys${NC}\n"

# Delete from D1 databases
delete_d1_user "$DEV_DB_NAME" "DEV"
delete_d1_user "$QA_DB_NAME" "QA"

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Complete! All data deleted for UID: ${TARGET_UID}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
