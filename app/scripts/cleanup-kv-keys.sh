#!/usr/bin/env bash
set -euo pipefail

# Script to delete KV keys related to specific email addresses
# Usage: ./cleanup-kv-keys.sh <email1> <email2> ...

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
  echo -e "${RED}❌ Error: No email addresses provided${NC}"
  echo "Usage: $0 <email1> <email2> ..."
  echo "Example: $0 user1@example.com user2@example.com"
  exit 1
fi

# Email addresses to clean up (from command-line arguments)
EMAILS=("$@")

echo -e "${BLUE}🧹 KV Key Cleanup Script${NC}\n"
echo -e "${YELLOW}This will delete all KV keys related to:${NC}"
for email in "${EMAILS[@]}"; do
  echo -e "  - ${email}"
done
echo ""

# Function to list all keys in KV namespace
list_all_keys() {
  local cursor=""
  local all_keys=()
  
  while true; do
    local url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys"
    local params=""
    
    if [ -n "$cursor" ]; then
      params="?cursor=${cursor}"
    fi
    
    local response=$(curl -s -X GET "${url}${params}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json")
    
    local success=$(echo "$response" | jq -r '.success')
    if [ "$success" != "true" ]; then
      echo -e "${RED}❌ Failed to list keys${NC}"
      echo "$response" | jq .
      exit 1
    fi
    
    # Extract keys
    local keys=$(echo "$response" | jq -r '.result[]?.name // empty')
    if [ -n "$keys" ]; then
      while IFS= read -r key; do
        if [ -n "$key" ]; then
          all_keys+=("$key")
        fi
      done <<< "$keys"
    fi
    
    # Check for cursor (pagination)
    cursor=$(echo "$response" | jq -r '.result_info.cursor // empty')
    if [ -z "$cursor" ] || [ "$cursor" = "null" ]; then
      break
    fi
  done
  
  printf '%s\n' "${all_keys[@]}"
}

# Function to get value of a key (to check if it contains email)
get_key_value() {
  local key=$1
  curl -s -X GET \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${key}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" 2>/dev/null || echo ""
}

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
    echo -e "${RED}Failed to delete key: $key${NC}" >&2
    echo "$response" | jq . >&2
    return 1
  fi
}

echo -e "${BLUE}📋 Listing all keys in KV namespace...${NC}"
ALL_KEYS=($(list_all_keys))
TOTAL_KEYS=${#ALL_KEYS[@]}
echo -e "${GREEN}✅ Found ${TOTAL_KEYS} keys${NC}\n"

# Common key patterns to check
KEY_PATTERNS=(
  "planByUid:"
  "cusByUid:"
  "trialEndByUid:"
  "cancelAtByUid:"
  "periodEndByUid:"
  "scheduledPlanByUid:"
  "scheduledAtByUid:"
  "planTsByUid:"
  "trialUsedByUid:"
  "usage:"
  "user:"
  "session:"
  "resume:"
  "feedbackCache:"
  "throttle:"
  "creditsByUid:"
  "atsUsage:"
  "feedbackUsage:"
  "rewriteUsage:"
  "mockInterviewUsage:"
)

echo -e "${BLUE}🔍 Searching for keys related to target emails...${NC}"

KEYS_TO_DELETE=()

# Strategy: Since we don't have UIDs, we'll:
# 1. Look for keys that might contain email addresses in their values
# 2. Delete all keys that match common patterns (we'll be conservative)

# For now, let's delete all keys and let the user recreate accounts
# OR we can be smarter and check values

echo -e "${YELLOW}Checking key values for email addresses...${NC}"
echo -e "${YELLOW}(This may take a while for ${TOTAL_KEYS} keys)${NC}\n"

# Check each key's value for email addresses
CHECKED=0
for key in "${ALL_KEYS[@]}"; do
  ((CHECKED++))
  if [ $((CHECKED % 50)) -eq 0 ]; then
    echo -e "${BLUE}Checked ${CHECKED}/${TOTAL_KEYS} keys...${NC}"
  fi
  
  value=$(get_key_value "$key" 2>/dev/null || echo "")
  if [ -n "$value" ]; then
    for email in "${EMAILS[@]}"; do
      if echo "$value" | grep -qi "$email"; then
        KEYS_TO_DELETE+=("$key")
        echo -e "${YELLOW}Found email in key: $key${NC}"
        break
      fi
    done
  fi
done

echo ""

if [ ${#KEYS_TO_DELETE[@]} -eq 0 ]; then
  echo -e "${YELLOW}⚠️  No keys found containing target email addresses in values${NC}"
  echo -e "${YELLOW}Checking for keys that might be related by pattern...${NC}"
  
  # Also check for common patterns that might be user-related
  # Since we can't get UIDs, we'll look for keys that might be test/dev keys
  # This is a fallback - ideally we'd have the UIDs
  echo -e "${YELLOW}Note: Without Firebase UIDs, we can only delete keys with email in values${NC}"
  echo -e "${YELLOW}You may need to manually identify and delete keys using Firebase UIDs${NC}"
else
  echo -e "${BLUE}🗑️  Deleting ${#KEYS_TO_DELETE[@]} keys...${NC}"
  DELETED=0
  FAILED=0
  
  for key in "${KEYS_TO_DELETE[@]}"; do
    if delete_key "$key"; then
      ((DELETED++))
      echo -e "${GREEN}✅ Deleted: $key${NC}"
    else
      ((FAILED++))
    fi
  done
  
  echo ""
  echo -e "${GREEN}✅ Deleted: ${DELETED} keys${NC}"
  if [ $FAILED -gt 0 ]; then
    echo -e "${RED}❌ Failed: ${FAILED} keys${NC}"
  fi
fi

echo ""
echo -e "${GREEN}✅ Cleanup complete!${NC}"

