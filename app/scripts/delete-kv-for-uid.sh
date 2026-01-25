#!/usr/bin/env bash
# One-time: Delete KV keys for a UID from jobhackai-kv-dev-qa-shared.
# Usage: ./delete-kv-for-uid.sh <UID>
# Auth: wrangler login or CLOUDFLARE_API_TOKEN.

set -euo pipefail

TARGET_UID="${1:?Usage: $0 <UID>}"
KV_ID="5237372648c34aa6880f91e1a0c9708a"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

echo "Deleting KV keys for UID=$TARGET_UID (namespace $KV_ID)..."

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
for k in "${keys[@]}"; do
  if npx wrangler kv key delete "$k" --namespace-id="$KV_ID" --remote 2>/dev/null; then
    echo "  Deleted: $k"
    deleted=$((deleted + 1))
  fi
done

echo "  Searching for resume:* keys containing UID..."
resume_deleted=0
list=$(npx wrangler kv key list --namespace-id="$KV_ID" --remote 2>/dev/null) || true
if [ -n "$list" ]; then
  for key in $(echo "$list" | jq -r '.[].name // empty' 2>/dev/null); do
    [ -z "$key" ] && continue
    if [[ "$key" == resume:* ]] && [[ "$key" == *"${TARGET_UID}"* ]]; then
      if npx wrangler kv key delete "$key" --namespace-id="$KV_ID" --remote 2>/dev/null; then
        echo "  Deleted: $key"
        resume_deleted=$((resume_deleted + 1))
      fi
    fi
  done
fi

total=$((deleted + resume_deleted))
echo "Done. Deleted $total KV keys ($deleted standard + $resume_deleted resume)."
