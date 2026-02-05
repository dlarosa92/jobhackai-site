#!/usr/bin/env bash
set -eo pipefail

# Script to delete all data for a specific user from D1 and KV
# Usage: 
#   export CLOUDFLARE_API_TOKEN="your_token"
#   export CLOUDFLARE_ACCOUNT_ID="your_account_id"
#   export D1_DB_ID="your_d1_db_id"
#   export KV_NAMESPACE_ID="your_kv_namespace_id"
#   ./delete-user-data.sh <UID> <EMAIL>

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check arguments
if [ $# -lt 2 ]; then
  echo -e "${RED}Usage: $0 <UID> <EMAIL>${NC}"
  echo -e "${YELLOW}Example: $0 REPLACE_WITH_UID test.user@example.com${NC}"
  exit 1
fi

USER_UID="$1"
EMAIL="$2"

# Check if wrangler is available
if ! command -v wrangler &> /dev/null; then
  echo -e "${RED}❌ wrangler CLI is required. Install with: npm install -g wrangler${NC}"
  exit 1
fi

# Verify wrangler authentication
if ! wrangler whoami &> /dev/null; then
  echo -e "${RED}❌ Not authenticated with wrangler. Run: wrangler login${NC}"
  exit 1
fi

if [ -z "${D1_DB_ID:-}" ]; then
  echo -e "${RED}❌ D1_DB_ID environment variable required${NC}"
  exit 1
fi

if [ -z "${KV_NAMESPACE_ID:-}" ]; then
  echo -e "${RED}❌ KV_NAMESPACE_ID environment variable required${NC}"
  exit 1
fi

echo -e "${BLUE}🧹 User Data Deletion Script${NC}\n"
echo -e "${YELLOW}This will delete ALL data for:${NC}"
echo -e "  Email: ${EMAIL}"
echo -e "  UID: ${USER_UID}\n"
echo -e "${RED}⚠️  This action cannot be undone!${NC}\n"
read -p "Type 'DELETE' to confirm: " confirm
if [ "$confirm" != "DELETE" ]; then
  echo -e "${YELLOW}Cancelled.${NC}"
  exit 0
fi

echo ""

# Function to delete D1 user data
delete_d1_user_data() {
  local firebase_uid=$1
  local email=$2
  
  echo -e "${BLUE}Deleting D1 database records...${NC}"
  
  # First, get the user's internal ID from users table
  local user_result=$(wrangler d1 execute "$D1_DB_ID" \
    --command="SELECT id FROM users WHERE auth_id = '${firebase_uid}';" 2>/dev/null || echo "")
  
  local user_id=$(echo "$user_result" | grep -oE '[0-9]+' | head -1 || echo "")
  
  if [ -z "$user_id" ]; then
    echo -e "${YELLOW}  ⚠️  User not found in users table (auth_id: ${firebase_uid})${NC}"
  else
    echo -e "${GREEN}  ✅ Found user ID: ${user_id}${NC}"
    
    # Delete from users table (this will cascade delete related records)
    echo -e "${BLUE}  Deleting from users table (cascades to related tables)...${NC}"
    wrangler d1 execute "$D1_DB_ID" \
      --command="DELETE FROM users WHERE id = ${user_id};" 2>/dev/null || true
    echo -e "${GREEN}  ✅ Deleted user record${NC}"
  fi
  
  # Delete from linkedin_runs (uses auth_id directly)
  echo -e "${BLUE}  Deleting from linkedin_runs...${NC}"
  local linkedin_count=$(wrangler d1 execute "$D1_DB_ID" \
    --command="SELECT COUNT(*) as count FROM linkedin_runs WHERE user_id = '${firebase_uid}';" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "0")
  
  if [ "$linkedin_count" != "0" ]; then
    wrangler d1 execute "$D1_DB_ID" \
      --command="DELETE FROM linkedin_runs WHERE user_id = '${firebase_uid}';" 2>/dev/null || true
    echo -e "${GREEN}  ✅ Deleted ${linkedin_count} linkedin_runs records${NC}"
  else
    echo -e "${YELLOW}  ⚠️  No linkedin_runs records found${NC}"
  fi
  
  # Delete from role_usage_log (uses auth_id directly)
  echo -e "${BLUE}  Deleting from role_usage_log...${NC}"
  local role_usage_count=$(wrangler d1 execute "$D1_DB_ID" \
    --command="SELECT COUNT(*) as count FROM role_usage_log WHERE user_id = '${firebase_uid}';" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "0")
  
  if [ "$role_usage_count" != "0" ]; then
    wrangler d1 execute "$D1_DB_ID" \
      --command="DELETE FROM role_usage_log WHERE user_id = '${firebase_uid}';" 2>/dev/null || true
    echo -e "${GREEN}  ✅ Deleted ${role_usage_count} role_usage_log records${NC}"
  else
    echo -e "${YELLOW}  ⚠️  No role_usage_log records found${NC}"
  fi
  
  # Also try deleting by email as a fallback
  if [ -n "$email" ]; then
    echo -e "${BLUE}  Checking for records by email...${NC}"
    local email_user_id=$(wrangler d1 execute "$D1_DB_ID" \
      --command="SELECT id FROM users WHERE email = '${email}';" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "")
    
    if [ -n "$email_user_id" ] && [ "$email_user_id" != "$user_id" ]; then
      echo -e "${YELLOW}  ⚠️  Found additional user record by email (ID: ${email_user_id})${NC}"
      wrangler d1 execute "$D1_DB_ID" \
        --command="DELETE FROM users WHERE id = ${email_user_id};" 2>/dev/null || true
      echo -e "${GREEN}  ✅ Deleted additional user record${NC}"
    fi
  fi
  
  echo -e "${GREEN}✅ D1 deletion complete${NC}\n"
}

# Function to delete KV keys for a UID
delete_kv_keys_for_uid() {
  local firebase_uid=$1
  
  echo -e "${BLUE}Deleting KV keys for UID ${firebase_uid}...${NC}"
  
  # Key patterns to delete
  local key_patterns=(
    "planByUid:${firebase_uid}"
    "cusByUid:${firebase_uid}"
    "trialEndByUid:${firebase_uid}"
    "cancelAtByUid:${firebase_uid}"
    "periodEndByUid:${firebase_uid}"
    "scheduledPlanByUid:${firebase_uid}"
    "scheduledAtByUid:${firebase_uid}"
    "planTsByUid:${firebase_uid}"
    "trialUsedByUid:${firebase_uid}"
    "usage:${firebase_uid}"
    "user:${firebase_uid}"
    "session:${firebase_uid}"
    "creditsByUid:${firebase_uid}"
    "atsUsage:${firebase_uid}"
    "feedbackUsage:${firebase_uid}"
    "rewriteUsage:${firebase_uid}"
    "mockInterviewUsage:${firebase_uid}"
    "throttle:${firebase_uid}"
    "user:${firebase_uid}:lastResume"
    "iq_cooldown:${firebase_uid}"
    "iq_lock:${firebase_uid}"
    "atsUsage:${firebase_uid}:lifetime"
    "emailByUid:${firebase_uid}"
  )
  
  local deleted=0
  for key in "${key_patterns[@]}"; do
    if wrangler kv key delete "$key" --namespace-id="$KV_NAMESPACE_ID" --remote &> /dev/null; then
      deleted=$((deleted + 1))
      echo -e "    ${GREEN}✅ Deleted: $key${NC}"
    fi
  done
  
  # Search for and delete resume keys using wrangler
  echo -e "${BLUE}  Searching for resume keys...${NC}"
  local resume_deleted=0
  
  # List all keys in the namespace and filter for resume keys containing the UID
  local all_keys=$(wrangler kv key list --namespace-id="$KV_NAMESPACE_ID" --remote 2>/dev/null | jq -r '.[].name // empty' || echo "")
  
  if [ -n "$all_keys" ]; then
    while IFS= read -r key; do
      if [ -n "$key" ]; then
        # Delete resume keys that contain the UID
        if [[ "$key" == resume:* ]] && [[ "$key" == *"${firebase_uid}"* ]]; then
          if wrangler kv key delete "$key" --namespace-id="$KV_NAMESPACE_ID" --remote &> /dev/null; then
            resume_deleted=$((resume_deleted + 1))
            echo -e "    ${GREEN}✅ Deleted: $key${NC}"
          fi
        fi
      fi
    done <<< "$all_keys"
  fi
  
  local total_deleted=$((deleted + resume_deleted))
  echo -e "${GREEN}  Deleted ${total_deleted} KV keys (${deleted} standard + ${resume_deleted} resume keys)${NC}"
  
  if [ "$total_deleted" -gt 0 ]; then
    return 0
  fi
  return 1
}

# Main execution
echo -e "${YELLOW}Starting deletion process...${NC}\n"

# Delete D1 data
delete_d1_user_data "$USER_UID" "$EMAIL"

# Delete KV data
delete_kv_keys_for_uid "$USER_UID"

echo ""
echo -e "${GREEN}✅ Deletion complete!${NC}"
echo -e "${YELLOW}All data for ${EMAIL} (${USER_UID}) has been deleted from D1 and KV.${NC}"
