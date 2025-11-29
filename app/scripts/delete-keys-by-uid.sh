#!/usr/bin/env bash
set -euo pipefail

# Script to delete all KV keys for specific UIDs
# Usage: ./delete-keys-by-uid.sh <uid1> <uid2> ...

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# KV Namespace ID (can be overridden via environment variable)
: "${KV_NAMESPACE_ID:?KV_NAMESPACE_ID environment variable required}"

# Cloudflare credentials
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}"

# Check for command-line arguments
if [ $# -eq 0 ]; then
  echo -e "${RED}❌ Error: No UIDs provided${NC}"
  echo "Usage: $0 <uid1> <uid2> ..."
  echo "Example: $0 abc123 def456 ghi789"
  exit 1
fi

# UIDs from command-line arguments
UIDS=("$@")

# Key patterns to delete for each UID
KEY_PATTERNS=(
  "planByUid:%UID%"
  "cusByUid:%UID%"
  "trialEndByUid:%UID%"
  "cancelAtByUid:%UID%"
  "periodEndByUid:%UID%"
  "scheduledPlanByUid:%UID%"
  "scheduledAtByUid:%UID%"
  "planTsByUid:%UID%"
  "trialUsedByUid:%UID%"
  "usage:%UID%"
  "user:%UID%"
  "session:%UID%"
  "creditsByUid:%UID%"
  "atsUsage:%UID%"
  "feedbackUsage:%UID%"
  "rewriteUsage:%UID%"
  "mockInterviewUsage:%UID%"
  "throttle:%UID%"
  "user:%UID%:lastResume"
)

echo -e "${BLUE}🗑️  Deleting all keys for ${#UIDS[@]} UIDs${NC}\n"

# Function to delete a key
delete_key() {
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

TOTAL_DELETED=0
TOTAL_FAILED=0

for uid in "${UIDS[@]}"; do
  echo -e "${BLUE}Processing UID: ${uid}${NC}"
  DELETED=0
  FAILED=0
  
  for pattern in "${KEY_PATTERNS[@]}"; do
    key="${pattern//%UID%/$uid}"
    if delete_key "$key" 2>/dev/null; then
      ((DELETED++))
      echo -e "  ${GREEN}✅ Deleted: $key${NC}"
    else
      ((FAILED++))
      # Don't show errors for keys that don't exist
    fi
  done
  
  # Also delete resume keys for this UID
  echo -e "${BLUE}  Checking for resume keys...${NC}"
  # List all keys and filter for resume keys with this UID
  cursor=""
  while true; do
    url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys"
    params=""
    if [ -n "$cursor" ]; then
      params="?cursor=${cursor}"
    fi
    
    response=$(curl -s -X GET "${url}${params}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json")
    
    keys=$(echo "$response" | jq -r ".result[]?.name // empty" | grep "^resume:${uid}:" || true)
    if [ -n "$keys" ]; then
      while IFS= read -r key; do
        if [ -n "$key" ]; then
          if delete_key "$key" 2>/dev/null; then
            ((DELETED++))
            echo -e "  ${GREEN}✅ Deleted: $key${NC}"
          fi
        fi
      done <<< "$keys"
    fi
    
    cursor=$(echo "$response" | jq -r '.result_info.cursor // empty')
    if [ -z "$cursor" ] || [ "$cursor" = "null" ]; then
      break
    fi
  done
  
  echo -e "  ${GREEN}Deleted ${DELETED} keys for UID ${uid}${NC}\n"
  TOTAL_DELETED=$((TOTAL_DELETED + DELETED))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
done

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Total deleted: ${TOTAL_DELETED} keys${NC}"
if [ $TOTAL_FAILED -gt 0 ]; then
  echo -e "${RED}❌ Total failed: ${TOTAL_FAILED} keys${NC}"
fi
echo -e "${GREEN}════════════════════════════════════════${NC}"

