#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required (Pages:Edit)}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}"
: "${CF_PAGES_PROJECT_QA:?CF_PAGES_PROJECT_QA required}"

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${CF_PAGES_PROJECT_QA}"
auth_hdr=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

upsert_var () {
  local name="$1" value="$2"
  [ -z "${value:-}" ] && return 0
  echo "→ Set variable ${name}"
  curl -fsS -X PUT "${API}/variables/${name}" "${auth_hdr[@]}" \
    --data "{\"value\":\"${value}\",\"type\":\"plain_text\"}" >/dev/null
}

upsert_secret () {
  local name="$1" value="$2"
  [ -z "${value:-}" ] && return 0
  echo "→ Set secret ${name}"
  curl -fsS -X PUT "${API}/secrets/${name}" "${auth_hdr[@]}" \
    --data "{\"value\":\"${value}\"}" >/dev/null
}

delete_var () {
  local name="$1"
  echo "→ Delete variable ${name} (if exists)"
  curl -fsS -X DELETE "${API}/variables/${name}" "${auth_hdr[@]}" >/dev/null || true
}

delete_secret () {
  local name="$1"
  echo "→ Delete secret ${name} (if exists)"
  curl -fsS -X DELETE "${API}/secrets/${name}" "${auth_hdr[@]}" >/dev/null || true
}

echo "== Upserting QA NEXT_PUBLIC_* variables =="
upsert_var "NEXT_PUBLIC_API_BASE_URL" "${NEXT_PUBLIC_API_BASE_URL_QA}"
upsert_var "NEXT_PUBLIC_FIREBASE_API_KEY" "${NEXT_PUBLIC_FIREBASE_API_KEY}"
upsert_var "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" "${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}"
upsert_var "NEXT_PUBLIC_FIREBASE_PROJECT_ID" "${NEXT_PUBLIC_FIREBASE_PROJECT_ID}"
[ -n "${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-}" ] && upsert_var "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET" "${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}"
[ -n "${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:-}" ] && upsert_var "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID" "${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}"
[ -n "${NEXT_PUBLIC_FIREBASE_APP_ID:-}" ] && upsert_var "NEXT_PUBLIC_FIREBASE_APP_ID" "${NEXT_PUBLIC_FIREBASE_APP_ID}"
[ -n "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" ] && upsert_var "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}"

echo "== Removing legacy/non-prefixed vars (secrets preserved unless explicitly requested) =="
delete_var "FIREBASE_API_KEY"
delete_var "FIREBASE_AUTH_DOMAIN"
delete_var "FIREBASE_PROJECT_ID"
# Preserve STRIPE_SECRET_KEY on Pages for now; set DELETE_STRIPE_FROM_PAGES=1 to remove
if [ "${DELETE_STRIPE_FROM_PAGES:-0}" = "1" ]; then
  delete_var "STRIPE_SECRET_KEY"
  delete_secret "STRIPE_SECRET_KEY"
fi
delete_secret "FIREBASE_API_KEY"
delete_secret "FIREBASE_AUTH_DOMAIN"
delete_secret "FIREBASE_PROJECT_ID"

echo "== Upserting Pages secrets for QA (optional) =="
[ -n "${STRIPE_SECRET_KEY:-}" ] && upsert_secret "STRIPE_SECRET_KEY" "${STRIPE_SECRET_KEY}"
[ -n "${FRONTEND_URL:-}" ] && upsert_secret "FRONTEND_URL" "${FRONTEND_URL}"

echo "== Current variables =="
curl -fsS "${API}/variables" "${auth_hdr[@]}" | sed 's/{"success":true,"errors":\[\],"messages":\[\],"result":/Result: /'
echo
echo "Done."
