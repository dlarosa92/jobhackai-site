#!/usr/bin/env bash
set -euo pipefail

: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID required}"
: "${CF_PAGES_PROJECT_QA:?CF_PAGES_PROJECT_QA required}"

PROJECT="$CF_PAGES_PROJECT_QA"
ACC="--account-id ${CF_ACCOUNT_ID}"

wrangler whoami >/dev/null || { echo "Run: wrangler login"; exit 1; }

put_secret () {
  local name="$1" val="$2"
  [ -z "${val:-}" ] && return 0
  echo "→ Setting ${name} …"
  printf "%s" "$val" | wrangler pages secret put "$name" --project-name "$PROJECT" $ACC
}

del_secret () {
  local name="$1"
  echo "→ Deleting (if exists) ${name} …"
  wrangler pages secret delete "$name" --project-name "$PROJECT" $ACC >/dev/null 2>&1 || true
}

# ---------- set the correct NEXT_PUBLIC_* vars ----------
put_secret "NEXT_PUBLIC_API_BASE_URL" "${NEXT_PUBLIC_API_BASE_URL_QA}"
put_secret "NEXT_PUBLIC_FIREBASE_API_KEY" "${NEXT_PUBLIC_FIREBASE_API_KEY}"
put_secret "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" "${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}"
put_secret "NEXT_PUBLIC_FIREBASE_PROJECT_ID" "${NEXT_PUBLIC_FIREBASE_PROJECT_ID}"
[ -n "${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-}" ] && put_secret "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET" "${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}"
[ -n "${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:-}" ] && put_secret "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID" "${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}"
[ -n "${NEXT_PUBLIC_FIREBASE_APP_ID:-}" ] && put_secret "NEXT_PUBLIC_FIREBASE_APP_ID" "${NEXT_PUBLIC_FIREBASE_APP_ID}"
[ -n "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" ] && put_secret "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}"

# ---------- remove legacy/non-prefixed + misplaced secret ----------
del_secret "FIREBASE_API_KEY"
del_secret "FIREBASE_AUTH_DOMAIN"
del_secret "FIREBASE_PROJECT_ID"
del_secret "STRIPE_SECRET_KEY"   # belongs in Workers, not Pages

echo "== Current QA secrets =="
wrangler pages secret list --project-name "$PROJECT" $ACC || true
