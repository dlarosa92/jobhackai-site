#!/usr/bin/env bash
set -euo pipefail

# Script to clear KV and D1 data for specific test email addresses
# Usage: ./cleanup-test-users.sh

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test email addresses
TEST_EMAILS=(
  "test.user@example.com"
  "test.user2@example.com"
  "test.user3@example.com"
)

# Cloudflare credentials
# Try to get account ID from wrangler if not set
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo -e "${YELLOW}Getting account ID from wrangler...${NC}"
  CLOUDFLARE_ACCOUNT_ID=$(wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1 || echo "")
  if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo -e "${RED}❌ Could not get account ID. Please set CLOUDFLARE_ACCOUNT_ID or run 'wrangler login'${NC}"
    exit 1
  fi
  echo -e "${GREEN}✅ Using account ID: ${CLOUDFLARE_ACCOUNT_ID}${NC}"
fi

# API token is required for KV operations via API
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo -e "${YELLOW}⚠️  CLOUDFLARE_API_TOKEN not set. Will use wrangler for D1 operations only.${NC}"
  echo -e "${YELLOW}   For KV cleanup, please set CLOUDFLARE_API_TOKEN or run the script with it.${NC}"
  echo -e "${YELLOW}   You can create an API token at: https://dash.cloudflare.com/profile/api-tokens${NC}"
  SKIP_KV=true
else
  SKIP_KV=false
fi

# Function to get KV namespace ID by name pattern
get_kv_namespace_id() {
  local pattern=$1
  local response=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")
  
  local namespace_id=$(echo "$response" | jq -r ".result[] | select(.title | test(\"${pattern}\"; \"i\")) | .id" | head -1)
  echo "$namespace_id"
}

# Get KV namespace IDs (try to auto-detect or use env vars)
if [ "$SKIP_KV" = "false" ]; then
  if [ -z "${KV_NAMESPACE_ID_DEV:-}" ]; then
    echo -e "${YELLOW}Auto-detecting DEV KV namespace...${NC}"
    KV_NAMESPACE_ID_DEV=$(get_kv_namespace_id "dev")
    if [ -z "$KV_NAMESPACE_ID_DEV" ] || [ "$KV_NAMESPACE_ID_DEV" = "null" ]; then
      echo -e "${RED}❌ Could not find DEV KV namespace. Please set KV_NAMESPACE_ID_DEV${NC}"
      exit 1
    fi
    echo -e "${GREEN}✅ Found DEV KV namespace: ${KV_NAMESPACE_ID_DEV}${NC}"
  fi

  if [ -z "${KV_NAMESPACE_ID_QA:-}" ]; then
    echo -e "${YELLOW}Auto-detecting QA KV namespace...${NC}"
    KV_NAMESPACE_ID_QA=$(get_kv_namespace_id "qa")
    if [ -z "$KV_NAMESPACE_ID_QA" ] || [ "$KV_NAMESPACE_ID_QA" = "null" ]; then
      echo -e "${RED}❌ Could not find QA KV namespace. Please set KV_NAMESPACE_ID_QA${NC}"
      exit 1
    fi
    echo -e "${GREEN}✅ Found QA KV namespace: ${KV_NAMESPACE_ID_QA}${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Skipping KV cleanup (no API token)${NC}"
fi

# D1 Database IDs (get from wrangler d1 list)
get_d1_db_id() {
  local db_name=$1
  # Extract UUID from wrangler output (UUID is in first column, skip header lines)
  wrangler d1 list 2>/dev/null | grep -i "$db_name" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1
}

# Get D1 database IDs
echo -e "${YELLOW}Getting D1 database IDs...${NC}"
DEV_DB_ID=$(get_d1_db_id "jobhackai-dev-db")
QA_DB_ID=$(get_d1_db_id "jobhackai-qa-db")

if [ -z "$DEV_DB_ID" ]; then
  echo -e "${RED}❌ Could not find jobhackai-dev-db${NC}"
  exit 1
fi
if [ -z "$QA_DB_ID" ]; then
  echo -e "${RED}❌ Could not find jobhackai-qa-db${NC}"
  exit 1
fi

echo -e "${GREEN}✅ DEV DB ID: ${DEV_DB_ID}${NC}"
echo -e "${GREEN}✅ QA DB ID: ${QA_DB_ID}${NC}\n"

# Store database IDs for later use
# (DEV_DB_ID and QA_DB_ID are used directly in functions)

echo -e "${BLUE}🧹 Test User Data Cleanup Script${NC}\n"
echo -e "${YELLOW}This will delete all KV and D1 data for:${NC}"
for email in "${TEST_EMAILS[@]}"; do
  echo -e "  - ${email}"
done
echo ""

# Function to get UIDs from D1 database by email
get_uids_from_d1() {
  local db_id=$1
  local email=$2
  local uids=()
  
  # Echo to stderr so it doesn't get captured in output
  echo -e "${BLUE}  Querying D1 database ${db_id} for email: ${email}${NC}" >&2
  
  # Query D1 for users with this email using database ID
  local result=$(wrangler d1 execute "$db_id" \
    --command="SELECT auth_id FROM users WHERE email = '${email}';" \
    --json 2>/dev/null || echo "")
  
  if [ -n "$result" ] && echo "$result" | jq -e '.success' >/dev/null 2>&1; then
    # Parse JSON output - wrangler returns results in .results array
    local auth_ids=$(echo "$result" | jq -r '.results[]? | .auth_id // empty' 2>/dev/null || echo "")
    if [ -n "$auth_ids" ]; then
      while IFS= read -r uid; do
        if [ -n "$uid" ] && [ "$uid" != "null" ] && [ ${#uid} -ge 20 ]; then
          uids+=("$uid")
        fi
      done <<< "$auth_ids"
    fi
  else
    # Fallback: try without --json flag
    local text_result=$(wrangler d1 execute "$db_id" \
      --command="SELECT auth_id FROM users WHERE email = '${email}';" 2>/dev/null || echo "")
    
    if [ -n "$text_result" ]; then
      # Extract auth_ids from text output (look for Firebase UID pattern)
      while IFS= read -r line; do
        # Firebase UIDs are typically 28 characters, alphanumeric
        if echo "$line" | grep -qE '^[a-zA-Z0-9]{20,50}$'; then
          local uid=$(echo "$line" | grep -oE '^[a-zA-Z0-9]{20,50}$' | head -1)
          if [ -n "$uid" ]; then
            uids+=("$uid")
          fi
        fi
      done <<< "$text_result"
    fi
  fi
  
  if [ ${#uids[@]} -gt 0 ]; then
    printf '%s\n' "${uids[@]}"
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
      ((deleted++))
      echo -e "    ${GREEN}✅ Deleted: $key${NC}"
    fi
  done
  
  # Also check for resume keys
  local cursor=""
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
            ((deleted++))
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
  
  echo -e "    ${GREEN}Deleted ${deleted} KV keys for ${env_name}${NC}"
  return $deleted
}

# Function to delete D1 records for a user by email
delete_d1_user_by_email() {
  local db_id=$1
  local email=$2
  local db_name=$3  # For display purposes
  
  echo -e "${BLUE}  Deleting D1 records for email: ${email} in ${db_name}...${NC}"
  
  # First check if user exists
  local check_result=$(wrangler d1 execute "$db_id" \
    --command="SELECT id FROM users WHERE email = '${email}';" \
    --json 2>/dev/null || echo "")
  
  local user_exists=false
  if echo "$check_result" | jq -e '.success' >/dev/null 2>&1; then
    local user_count=$(echo "$check_result" | jq -r '.results | length' 2>/dev/null || echo "0")
    if [ "$user_count" -gt 0 ]; then
      user_exists=true
    fi
  fi
  
  if [ "$user_exists" = "false" ]; then
    echo -e "    ${YELLOW}⚠️  No user found with email ${email} in ${db_name}${NC}"
    return 1
  fi
  
  # Delete user (cascade will delete related records: resume_sessions, feedback_sessions, usage_events, interview_question_sets)
  local delete_result=$(wrangler d1 execute "$db_id" \
    --command="DELETE FROM users WHERE email = '${email}';" \
    --json 2>/dev/null || echo "")
  
  if echo "$delete_result" | jq -e '.success' >/dev/null 2>&1; then
    local rows_deleted=$(echo "$delete_result" | jq -r '.meta.rows_written // 0' 2>/dev/null || echo "0")
    echo -e "    ${GREEN}✅ Deleted user and related records from ${db_name} (${rows_deleted} rows)${NC}"
    return 0
  else
    echo -e "    ${RED}❌ Error deleting from ${db_name}${NC}"
    echo "$delete_result" | jq . 2>/dev/null || echo "$delete_result"
    return 1
  fi
}

# Main cleanup process
TOTAL_KV_DELETED=0
TOTAL_D1_DELETED=0

for email in "${TEST_EMAILS[@]}"; do
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}Processing: ${email}${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
  
  # Get UIDs from D1 databases
  echo -e "${YELLOW}Getting UIDs from D1 databases...${NC}"
  DEV_UIDS=($(get_uids_from_d1 "$DEV_DB_ID" "$email" || true))
  QA_UIDS=($(get_uids_from_d1 "$QA_DB_ID" "$email" || true))
  
  # Combine and deduplicate UIDs
  ALL_UIDS=()
  [ ${#DEV_UIDS[@]} -gt 0 ] && ALL_UIDS+=("${DEV_UIDS[@]}")
  [ ${#QA_UIDS[@]} -gt 0 ] && ALL_UIDS+=("${QA_UIDS[@]}")
  
  UNIQUE_UIDS=()
  if [ ${#ALL_UIDS[@]} -gt 0 ]; then
    UNIQUE_UIDS=($(printf '%s\n' "${ALL_UIDS[@]}" | sort -u))
  fi
  
  if [ ${#UNIQUE_UIDS[@]} -eq 0 ]; then
    echo -e "${YELLOW}  ⚠️  No UIDs found in D1 for ${email}${NC}"
    echo -e "${YELLOW}  Will still attempt to delete D1 records by email${NC}\n"
  else
    echo -e "${GREEN}  Found ${#UNIQUE_UIDS[@]} unique UID(s):${NC}"
    for uid in "${UNIQUE_UIDS[@]}"; do
      echo -e "    - ${uid}"
    done
    echo ""
  fi
  
  # Delete KV keys for each UID
  if [ "$SKIP_KV" = "false" ] && [ ${#UNIQUE_UIDS[@]} -gt 0 ]; then
    echo -e "${YELLOW}Deleting KV keys...${NC}"
    for uid in "${UNIQUE_UIDS[@]}"; do
      delete_kv_keys_for_uid "$KV_NAMESPACE_ID_DEV" "$uid" "DEV"
      delete_kv_keys_for_uid "$KV_NAMESPACE_ID_QA" "$uid" "QA"
    done
  elif [ "$SKIP_KV" = "true" ] && [ ${#UNIQUE_UIDS[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Skipping KV deletion (no API token). UIDs found:${NC}"
    for uid in "${UNIQUE_UIDS[@]}"; do
      echo -e "    - ${uid}"
    done
    echo -e "${YELLOW}   You can manually delete KV keys using the delete-keys-by-uid.sh script${NC}"
  fi
  
  # Delete D1 records
  echo -e "${YELLOW}Deleting D1 records...${NC}"
  if delete_d1_user_by_email "$DEV_DB_ID" "$email" "jobhackai-dev-db"; then
    ((TOTAL_D1_DELETED++))
  fi
  if delete_d1_user_by_email "$QA_DB_ID" "$email" "jobhackai-qa-db"; then
    ((TOTAL_D1_DELETED++))
  fi
  
  echo ""
done

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Cleanup Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}D1 records deleted: ${TOTAL_D1_DELETED}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
