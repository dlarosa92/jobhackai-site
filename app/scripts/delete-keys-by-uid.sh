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

# KV Namespace ID
KV_NAMESPACE_ID="5237372648c34aa6880f91e1a0c9708a"

# Cloudflare credentials
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}"

# UIDs extracted from the emailByUid keys we found
UIDS=(
  "0U0Tn9mss2esR2pB8yG9W1mmHdB3"
  "6BKQxodeowaupEZXvqCyTSerQ3A3"
  "6i8gB9RbOwecbaulI7VaKTNywFI3"
  "HhrmE5PnMaPJBiunGXaEsDaO0ND3"
  "IxbjZ1IBOUgmMmeMJBgPPm6tPxB3"
  "KhtIY7DDnbeot355L5JkGRC6kxl1"
  "LA6XzS1JjFNLEp9EUZYXi3VsAL03"
  "NQH924TETwQIAoqM2vQVrbgkRGC2"
  "Wex4WcfIv9XT4UDcSx2H4sFl1ie2"
  "Xzn6tr8oyucQDq8emFwaseAR9C42"
  "aygENOJqrZaF6c6znxV4EHu1QqT2"
  "dMMn9INOB4cmlp6KUjHoVKh6W9z1"
  "feNputBXLodLePZLVSwGhNILrlq1"
  "hyNeo61pH4asR3qZbOFE0sRbgKg2"
  "jB3Epui6hlPmkx8WXkbknuT7CB53"
  "pne2K9E9pHbUEw1tw4Wx8Xhq2CT2"
  "8gI4FhK1EbP7e4vyuBo6sAqSNmw2"
  "bUxocN5IkahkdEnwWlPAl8NTYWm2"
)

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

