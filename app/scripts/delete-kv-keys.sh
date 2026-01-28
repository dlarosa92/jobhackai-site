#!/usr/bin/env bash
set -eo pipefail

# Script to delete all KV keys for a specific user UID
# Usage: 
#   export KV_NAMESPACE_ID="your_kv_namespace_id"
#   ./delete-kv-keys.sh <UID>

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check arguments
if [ $# -lt 1 ]; then
  echo -e "${RED}Usage: $0 <UID>${NC}"
  echo -e "${YELLOW}Example: $0 KvObI7SJWiO9tcdvvnPOMeudFZC3${NC}"
  exit 1
fi

USER_UID="$1"

# Check if KV_NAMESPACE_ID is set
if [ -z "${KV_NAMESPACE_ID:-}" ]; then
  echo -e "${RED}❌ KV_NAMESPACE_ID environment variable required${NC}"
  exit 1
fi

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

echo -e "${BLUE}🧹 Deleting KV keys for UID: ${USER_UID}${NC}\n"

# Key patterns to delete
key_patterns=(
  "planByUid:${USER_UID}"
  "cusByUid:${USER_UID}"
  "trialEndByUid:${USER_UID}"
  "cancelAtByUid:${USER_UID}"
  "periodEndByUid:${USER_UID}"
  "scheduledPlanByUid:${USER_UID}"
  "scheduledAtByUid:${USER_UID}"
  "planTsByUid:${USER_UID}"
  "trialUsedByUid:${USER_UID}"
  "usage:${USER_UID}"
  "user:${USER_UID}"
  "session:${USER_UID}"
  "creditsByUid:${USER_UID}"
  "atsUsage:${USER_UID}"
  "feedbackUsage:${USER_UID}"
  "rewriteUsage:${USER_UID}"
  "mockInterviewUsage:${USER_UID}"
  "throttle:${USER_UID}"
  "user:${USER_UID}:lastResume"
  "iq_cooldown:${USER_UID}"
  "iq_lock:${USER_UID}"
  "atsUsage:${USER_UID}:lifetime"
  "emailByUid:${USER_UID}"
  "billingStatus:${USER_UID}"
)

deleted=0
for key in "${key_patterns[@]}"; do
  if wrangler kv key delete "$key" --namespace-id="$KV_NAMESPACE_ID" --remote 2>/dev/null; then
    deleted=$((deleted + 1))
    echo -e "    ${GREEN}✅ Deleted: $key${NC}"
  else
    echo -e "    ${YELLOW}⚠️  Not found: $key${NC}"
  fi
done

# Search for and delete any other keys containing the UID
echo -e "\n${BLUE}Searching for additional keys containing ${USER_UID}...${NC}"
resume_deleted=0

# List all keys and filter for those containing the UID
if command -v jq &> /dev/null; then
  all_keys=$(wrangler kv key list --namespace-id="$KV_NAMESPACE_ID" --remote 2>/dev/null | jq -r '.[].name // empty' || echo "")
  
  if [ -n "$all_keys" ]; then
    while IFS= read -r key; do
      if [ -n "$key" ] && [[ "$key" == *"${USER_UID}"* ]]; then
        # Skip if we already tried to delete it above
        skip=false
        for pattern in "${key_patterns[@]}"; do
          if [ "$key" == "$pattern" ]; then
            skip=true
            break
          fi
        done
        
        if [ "$skip" == false ]; then
          if wrangler kv key delete "$key" --namespace-id="$KV_NAMESPACE_ID" --remote 2>/dev/null; then
            resume_deleted=$((resume_deleted + 1))
            echo -e "    ${GREEN}✅ Deleted: $key${NC}"
          fi
        fi
      fi
    done <<< "$all_keys"
  fi
else
  echo -e "${YELLOW}⚠️  jq not available, skipping additional key search${NC}"
fi

total_deleted=$((deleted + resume_deleted))
echo -e "\n${GREEN}✅ Deletion complete!${NC}"
echo -e "${GREEN}Deleted ${total_deleted} KV keys (${deleted} standard + ${resume_deleted} additional keys)${NC}"
