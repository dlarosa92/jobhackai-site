#!/usr/bin/env bash
set -eo pipefail

# Script to purge test accounts from D1 and KV storage
# Usage: ./purge-test-accounts.sh
#   Prompts for email/UID pairs interactively
#   Database IDs can be set via environment variables (QA_DB_ID, KV_NAMESPACE_ID) or prompted

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Arrays to store test accounts (populated interactively)
TEST_UIDS=()
TEST_EMAILS=()

# Collect test accounts interactively
echo -e "${BLUE}🧹 Test Account Purge Script${NC}\n"
echo -e "${YELLOW}Enter test accounts to purge (email and Firebase UID pairs)${NC}"
echo -e "${YELLOW}Press Enter with empty email to finish adding accounts${NC}\n"

while true; do
  read -p "Email: " email
  if [ -z "$email" ]; then
    break
  fi
  
  read -p "Firebase UID: " uid
  if [ -z "$uid" ]; then
    echo -e "${RED}❌ UID is required. Skipping this account.${NC}"
    continue
  fi
  
  TEST_EMAILS+=("$email")
  TEST_UIDS+=("$uid")
  echo -e "${GREEN}✅ Added: ${email} (${uid})${NC}\n"
done

if [ ${#TEST_UIDS[@]} -eq 0 ]; then
  echo -e "${RED}❌ No test accounts provided. Exiting.${NC}"
  exit 1
fi

# Database IDs - use env vars or prompt
if [ -z "${QA_DB_ID:-}" ]; then
  read -p "QA Database ID: " QA_DB_ID
  if [ -z "$QA_DB_ID" ]; then
    echo -e "${RED}❌ QA_DB_ID is required${NC}"
    exit 1
  fi
fi

if [ -z "${KV_NAMESPACE_ID:-}" ]; then
  read -p "KV Namespace ID: " KV_NAMESPACE_ID
  if [ -z "$KV_NAMESPACE_ID" ]; then
    echo -e "${RED}❌ KV_NAMESPACE_ID is required${NC}"
    exit 1
  fi
fi

# Cloudflare credentials
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo -e "${RED}❌ CLOUDFLARE_API_TOKEN environment variable required${NC}"
  echo -e "${YELLOW}   Create at: https://dash.cloudflare.com/profile/api-tokens${NC}"
  exit 1
fi

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo -e "${YELLOW}Getting account ID from wrangler...${NC}"
  CLOUDFLARE_ACCOUNT_ID=$(wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1 || echo "")
  if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo -e "${RED}❌ Could not get account ID. Please set CLOUDFLARE_ACCOUNT_ID or run 'wrangler login'${NC}"
    exit 1
  fi
  echo -e "${GREEN}✅ Using account ID: ${CLOUDFLARE_ACCOUNT_ID}${NC}"
fi

# Try to auto-detect DEV DB ID
get_d1_db_id() {
  local db_name=$1
  wrangler d1 list 2>/dev/null | grep -i "$db_name" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1
}

echo -e "${YELLOW}Auto-detecting DEV database ID...${NC}"
DEV_DB_ID=$(get_d1_db_id "jobhackai-dev-db")
if [ -z "$DEV_DB_ID" ]; then
  echo -e "${YELLOW}⚠️  Could not auto-detect DEV DB. Will use provided IDs only.${NC}"
  echo -e "${YELLOW}   You can set DEV_DB_ID environment variable if needed.${NC}"
else
  echo -e "${GREEN}✅ Found DEV DB ID: ${DEV_DB_ID}${NC}"
fi

echo -e "${GREEN}✅ QA DB ID: ${QA_DB_ID}${NC}"
echo ""

# Function to delete D1 user by auth_id
delete_d1_user_by_auth_id() {
  local db_id=$1
  local auth_id=$2
  local db_name=$3
  
  echo -e "${BLUE}  Deleting D1 records for auth_id: ${auth_id} in ${db_name}...${NC}"
  
  # First check if user exists
  local check_result=$(wrangler d1 execute "$db_id" \
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
    echo -e "    ${YELLOW}⚠️  No user found with auth_id ${auth_id} in ${db_name}${NC}"
    return 1
  fi
  
  # Delete user (cascade will delete related records)
  local delete_result=$(wrangler d1 execute "$db_id" \
    --command="DELETE FROM users WHERE auth_id = '${auth_id}';" \
    --json 2>/dev/null || echo "")
  
  if echo "$delete_result" | jq -e '.success' >/dev/null 2>&1; then
    local rows_deleted=$(echo "$delete_result" | jq -r '.meta.rows_written // 0' 2>/dev/null || echo "0")
    echo -e "    ${GREEN}✅ Deleted user and related records from ${db_name} (${rows_deleted} rows)${NC}"
    
    # Also clean up any additional tables that might not cascade
    # linkedin_runs, cover_letter_history, feature_daily_usage, cookie_consents
    local user_id=$(echo "$check_result" | jq -r '.results[0].id // empty' 2>/dev/null || echo "")
    if [ -n "$user_id" ] && [ "$user_id" != "null" ]; then
      # Delete from linkedin_runs
      wrangler d1 execute "$db_id" \
        --command="DELETE FROM linkedin_runs WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      # Delete from cover_letter_history
      wrangler d1 execute "$db_id" \
        --command="DELETE FROM cover_letter_history WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      # Delete from feature_daily_usage
      wrangler d1 execute "$db_id" \
        --command="DELETE FROM feature_daily_usage WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      # Delete from cookie_consents
      wrangler d1 execute "$db_id" \
        --command="DELETE FROM cookie_consents WHERE user_id = ${user_id};" \
        --json >/dev/null 2>&1 || true
      
      echo -e "    ${GREEN}✅ Cleaned up additional tables${NC}"
    fi
    
    return 0
  else
    echo -e "    ${RED}❌ Error deleting from ${db_name}${NC}"
    echo "$delete_result" | jq . 2>/dev/null || echo "$delete_result"
    return 1
  fi
}

# Function to delete KV keys for a UID
delete_kv_keys_for_uid() {
  local uid=$1
  
  echo -e "${BLUE}  Deleting KV keys for UID ${uid}...${NC}"
  
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
      "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encoded_key}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" 2>/dev/null || echo '{"success":false}')
    
    local success=$(echo "$response" | jq -r '.success // false')
    if [ "$success" = "true" ]; then
      ((deleted++))
      echo -e "    ${GREEN}✅ Deleted: $key${NC}"
    fi
  done
  
  # Also check for resume keys
  local cursor=""
  local resume_deleted=0
  while true; do
    local url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys"
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
            "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encoded_key}" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" 2>/dev/null || echo '{"success":false}')
          
          if echo "$del_response" | jq -r '.success // false' | grep -q "true"; then
            ((resume_deleted++))
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
echo -e "${YELLOW}This will delete all D1 and KV data for:${NC}"
for i in "${!TEST_UIDS[@]}"; do
  echo -e "  - ${TEST_EMAILS[$i]} (${TEST_UIDS[$i]})"
done
echo ""
echo -e "${YELLOW}Environments:${NC}"
echo -e "  - DEV: ${DEV_DB_ID:-NOT FOUND}"
echo -e "  - QA: ${QA_DB_ID}"
echo -e "  - KV: ${KV_NAMESPACE_ID}"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Cancelled.${NC}"
  exit 0
fi

TOTAL_D1_DELETED=0
TOTAL_KV_DELETED=0

for i in "${!TEST_UIDS[@]}"; do
  uid="${TEST_UIDS[$i]}"
  email="${TEST_EMAILS[$i]}"
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}Processing: ${email} (${uid})${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  
  # Delete from D1 databases
  echo -e "${YELLOW}Deleting D1 records...${NC}"
  if [ -n "$DEV_DB_ID" ]; then
    if delete_d1_user_by_auth_id "$DEV_DB_ID" "$uid" "DEV"; then
      ((TOTAL_D1_DELETED++))
    fi
  fi
  
  if delete_d1_user_by_auth_id "$QA_DB_ID" "$uid" "QA"; then
    ((TOTAL_D1_DELETED++))
  fi
  
  # Delete KV keys
  echo -e "${YELLOW}Deleting KV keys...${NC}"
  if delete_kv_keys_for_uid "$uid"; then
    ((TOTAL_KV_DELETED++))
  fi
  
  echo ""
done

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Purge Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}D1 records deleted: ${TOTAL_D1_DELETED}${NC}"
echo -e "${GREEN}KV key sets deleted: ${TOTAL_KV_DELETED}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
