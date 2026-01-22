#!/usr/bin/env bash
set -eo pipefail

# Script to reset a specific test account by deleting all KV and D1 data
# Usage: ./reset-test-account.sh <API_TOKEN> [ACCOUNT_ID]
#   API_TOKEN: Cloudflare API token (required)
#   ACCOUNT_ID: Cloudflare account ID (optional - will try to auto-detect)

# Test account details
TEST_UID="CRe8mbQ94GRgTAOgo0Sz7LYYJtC3"
TEST_EMAIL="jobshackai@gmail.com"

# Database names (for wrangler commands)
DEV_DB_NAME="jobhackai-dev-db"
QA_DB_NAME="jobhackai-qa-db"

# Shared KV namespace (dev and QA share the same KV)
KV_NAMESPACE_ID="5237372648c34aa6880f91e1a0c9708a"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get credentials from command line arguments
if [ $# -lt 1 ]; then
  echo -e "${RED}❌ Usage: $0 <API_TOKEN> [ACCOUNT_ID]${NC}"
  echo -e "${YELLOW}   API_TOKEN: Cloudflare API token (required)${NC}"
  echo -e "${YELLOW}   ACCOUNT_ID: Cloudflare account ID (optional - will try to auto-detect)${NC}"
  exit 1
fi

CLOUDFLARE_API_TOKEN="$1"
CLOUDFLARE_ACCOUNT_ID="${2:-}"

# Auto-detect account ID if not provided
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo -e "${YELLOW}Getting account ID from wrangler...${NC}"
  CLOUDFLARE_ACCOUNT_ID=$(wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1 || echo "")
  if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo -e "${RED}❌ Could not get account ID. Please provide it as second argument or run 'wrangler login'${NC}"
    exit 1
  fi
  echo -e "${GREEN}✅ Using account ID: ${CLOUDFLARE_ACCOUNT_ID}${NC}"
fi

echo ""

# Function to delete D1 user by auth_id
delete_d1_user_by_auth_id() {
  local db_name=$1
  local auth_id=$2
  local env_name=$3
  
  echo -e "${BLUE}  Deleting D1 records for auth_id: ${auth_id} in ${env_name}...${NC}"
  
  # First check if user exists
  local check_result=$(wrangler d1 execute "$db_name" \
    --command="SELECT id, email FROM users WHERE auth_id = '${auth_id}';" \
    --json 2>/dev/null || echo "")
  
  local user_exists=false
  if echo "$check_result" | jq -e '.success' >/dev/null 2>&1; then
    local user_count=$(echo "$check_result" | jq -r '.results | length' 2>/dev/null || echo "0")
    if [ "$user_count" -gt 0 ]; then
      user_exists=true
      local email=$(echo "$check_result" | jq -r '.results[0].email // "unknown"' 2>/dev/null || echo "unknown")
      echo -e "    Found user: ${email}"
    fi
  fi
  
  if [ "$user_exists" = "false" ]; then
    echo -e "    ${YELLOW}⚠️  No user found with auth_id ${auth_id} in ${env_name}${NC}"
    return 1
  fi
  
  # Delete user (cascade will delete related records)
  local delete_result=$(wrangler d1 execute "$db_name" \
    --command="DELETE FROM users WHERE auth_id = '${auth_id}';" \
    --json 2>/dev/null || echo "")
  
  if echo "$delete_result" | jq -e '.success' >/dev/null 2>&1; then
    local rows_deleted=$(echo "$delete_result" | jq -r '.meta.rows_written // 0' 2>/dev/null || echo "0")
    echo -e "    ${GREEN}✅ Deleted user and related records from ${env_name} (${rows_deleted} rows)${NC}"
    
    # Also clean up any additional tables that might not cascade
    local user_id=$(echo "$check_result" | jq -r '.results[0].id // empty' 2>/dev/null || echo "")
    if [ -n "$user_id" ] && [ "$user_id" != "null" ]; then
      # Delete from linkedin_runs
      wrangler d1 execute "$db_name" \
        --command="DELETE FROM linkedin_runs WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      # Delete from cover_letter_history
      wrangler d1 execute "$db_name" \
        --command="DELETE FROM cover_letter_history WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      # Delete from feature_daily_usage
      wrangler d1 execute "$db_name" \
        --command="DELETE FROM feature_daily_usage WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      # Delete from cookie_consents
      wrangler d1 execute "$db_name" \
        --command="DELETE FROM cookie_consents WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      echo -e "    ${GREEN}✅ Cleaned up additional tables${NC}"
    fi
    
    return 0
  else
    echo -e "    ${RED}❌ Error deleting from ${env_name}${NC}"
    echo "$delete_result" | jq . 2>/dev/null || echo "$delete_result"
    return 1
  fi
}

# Function to delete KV keys for a UID
delete_kv_keys_for_uid() {
  local namespace_id=$1
  local uid=$2
  local env_name=$3
  
  echo -e "${BLUE}  Deleting KV keys for UID ${uid} in ${env_name}...${NC}"
  
  # Key patterns to delete
  local key_patterns=(
    "planByUid:${uid}"
    "cusByUid:${uid}"
    "trialEndByUid:${uid}"
    "cancelAtByUid:${uid}"
    "periodEndByUid:${uid}"
    "scheduledPlanByUid:${uid}"
    "scheduledAtByUid:${uid}"
    "planTsByUid:${uid}"
    "trialUsedByUid:${uid}"
    "usage:${uid}"
    "user:${uid}"
    "session:${uid}"
    "creditsByUid:${uid}"
    "atsUsage:${uid}"
    "feedbackUsage:${uid}"
    "rewriteUsage:${uid}"
    "mockInterviewUsage:${uid}"
    "throttle:${uid}"
    "user:${uid}:lastResume"
    "iq_cooldown:${uid}"
    "iq_lock:${uid}"
  )
  
  local deleted=0
  for key in "${key_patterns[@]}"; do
    local encoded_key=$(echo -n "$key" | jq -sRr @uri)
    local response=$(curl -s -X DELETE \
      "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${namespace_id}/values/${encoded_key}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" 2>/dev/null || echo '{"success":false}')
    
    local success=$(echo "$response" | jq -r '.success // false')
    if [ "$success" = "true" ]; then
      deleted=$((deleted + 1))
      echo -e "    ${GREEN}✅ Deleted: $key${NC}"
    fi
  done
  
  # Also check for resume keys
  local cursor=""
  local resume_deleted=0
  while true; do
    local url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${namespace_id}/keys"
    local params=""
    if [ -n "$cursor" ]; then
      params="?cursor=${cursor}"
    fi
    
    local response=$(curl -s -X GET "${url}${params}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json")
    
    local keys=$(echo "$response" | jq -r ".result[]?.name // empty" | grep "^resume:${uid}:" || true)
    if [ -n "$keys" ]; then
      while IFS= read -r key; do
        if [ -n "$key" ]; then
          local encoded_key=$(echo -n "$key" | jq -sRr @uri)
          local del_response=$(curl -s -X DELETE \
            "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${namespace_id}/values/${encoded_key}" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" 2>/dev/null || echo '{"success":false}')
          
          if echo "$del_response" | jq -r '.success // false' | grep -q "true"; then
            resume_deleted=$((resume_deleted + 1))
            echo -e "    ${GREEN}✅ Deleted: $key${NC}"
          fi
        fi
      done <<< "$keys"
    fi
    
    cursor=$(echo "$response" | jq -r '.result_info.cursor // empty')
    if [ -z "$cursor" ] || [ "$cursor" = "null" ]; then
      break
    fi
  done
  
  local total_deleted=$((deleted + resume_deleted))
  echo -e "    ${GREEN}Deleted ${total_deleted} KV keys (${deleted} standard + ${resume_deleted} resume keys)${NC}"
  if [ "$total_deleted" -gt 0 ]; then
    return 0
  fi
  return 1
}

# Main cleanup process
echo ""
echo -e "${YELLOW}════════════════════════════════════════${NC}"
echo -e "${YELLOW}🧹 Test Account Reset Script${NC}"
echo -e "${YELLOW}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}This will delete ALL data for:${NC}"
echo -e "  Email: ${TEST_EMAIL}"
echo -e "  UID: ${TEST_UID}"
echo ""
echo -e "${YELLOW}Environments:${NC}"
echo -e "  - DEV D1: ${DEV_DB_NAME}"
echo -e "  - QA D1: ${QA_DB_NAME}"
echo -e "  - KV (Shared): ${KV_NAMESPACE_ID}"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Cancelled.${NC}"
  exit 0
fi

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}Processing: ${TEST_EMAIL} (${TEST_UID})${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

# Delete from D1 databases
echo -e "${YELLOW}Deleting D1 records...${NC}"
D1_DEV_SUCCESS=false
D1_QA_SUCCESS=false

if delete_d1_user_by_auth_id "$DEV_DB_NAME" "$TEST_UID" "DEV"; then
  D1_DEV_SUCCESS=true
fi

if delete_d1_user_by_auth_id "$QA_DB_NAME" "$TEST_UID" "QA"; then
  D1_QA_SUCCESS=true
fi

# Delete KV keys (shared namespace for dev and QA)
echo ""
echo -e "${YELLOW}Deleting KV keys from shared namespace...${NC}"
KV_SUCCESS=false

if delete_kv_keys_for_uid "$KV_NAMESPACE_ID" "$TEST_UID" "DEV/QA Shared"; then
  KV_SUCCESS=true
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Reset Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}D1 DEV: $([ "$D1_DEV_SUCCESS" = "true" ] && echo "✅ Deleted" || echo "⚠️  Not found or error")${NC}"
echo -e "${GREEN}D1 QA: $([ "$D1_QA_SUCCESS" = "true" ] && echo "✅ Deleted" || echo "⚠️  Not found or error")${NC}"
echo -e "${GREEN}KV (Shared): $([ "$KV_SUCCESS" = "true" ] && echo "✅ Deleted" || echo "⚠️  Not found or error")${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Note: You still need to manually delete:${NC}"
echo -e "  - Firebase account (${TEST_EMAIL})"
echo -e "  - Stripe subscription for this account"
echo ""
