#!/usr/bin/env bash
set -euo pipefail

# Config
PROJECT="jobhackai-app-dev"
ENDPOINT_URL="https://dev.jobhackai.io/api/stripe-webhook"

if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  echo "✖ STRIPE_SECRET_KEY env var not set (sk_test_...). Aborting." >&2
  exit 1
fi

echo "➡ Creating Stripe webhook endpoint (TEST) for: $ENDPOINT_URL"

# Find existing endpoint for same URL and disable it
EXISTING_JSON=$(curl -sS https://api.stripe.com/v1/webhook_endpoints -u "$STRIPE_SECRET_KEY:")
EXISTING_ID=$(node -e "const r=$EXISTING_JSON;const u='$ENDPOINT_URL';const m=(r.data||[]).find(e=>e.url===u);console.log(m?m.id:'')")
if [[ -n "$EXISTING_ID" ]]; then
  echo "ℹ Disabling existing endpoint: $EXISTING_ID"
  curl -sS -X POST "https://api.stripe.com/v1/webhook_endpoints/$EXISTING_ID" \
    -u "$STRIPE_SECRET_KEY:" \
    -d "disabled=true" >/dev/null
fi

# Create endpoint
CREATE_JSON=$(curl -sS https://api.stripe.com/v1/webhook_endpoints \
  -u "$STRIPE_SECRET_KEY:" \
  -d "url=$ENDPOINT_URL" \
  -d "description=JobHackAI DEV" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=customer.subscription.created" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=invoice.payment_succeeded" \
  -d "enabled_events[]=invoice.payment_failed")

NEW_ID=$(node -e "const j=$CREATE_JSON;if(j.error){console.error(j.error.message);process.exit(1)};console.log(j.id||'')")
WHSEC=$(node -e "const j=$CREATE_JSON;console.log(j.secret||'')")

if [[ -z "$NEW_ID" || -z "$WHSEC" ]]; then
  echo "✖ Failed creating webhook endpoint:" >&2
  echo "$CREATE_JSON" >&2
  exit 1
fi

echo "✔ Created endpoint: $NEW_ID"

echo "➡ Storing STRIPE_WEBHOOK_SECRET in Cloudflare Pages ($PROJECT)"
npx -y wrangler@latest pages secret put STRIPE_WEBHOOK_SECRET --project-name "$PROJECT" >/dev/null <<EOF
$WHSEC
EOF
echo "✔ Stored STRIPE_WEBHOOK_SECRET"

echo "✅ Done. Endpoint: $NEW_ID (url: $ENDPOINT_URL)"

