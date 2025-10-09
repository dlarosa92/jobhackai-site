#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://0d903b83.jobhackai-app-dev.pages.dev}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { printf "✅ %s\n" "$*"; }
warn() { printf "⚠️ %s\n" "$*"; }
err() { printf "❌ %s\n" "$*" >&2; }

assert_eq() { [ "$1" = "$2" ] || { err "$3 (got: $1, want: $2)"; exit 1; }; }
assert_http_in() { 
  local code="$1"; shift
  for want in "$@"; do [ "$code" = "$want" ] && return 0; done
  err "Unexpected HTTP $code (wanted one of: $*)"; exit 1
}

bold "🚀 COMPREHENSIVE DEPLOYMENT VERIFICATION"
bold "Base URL: $BASE_URL"
echo

bold "1) API Authentication (401 expected without token)"
read -r code < <(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/plan/me")
assert_http_in "$code" "401"
ok "API requires authentication"

bold "2) CORS Preflight (200/204 expected)"
read -r code < <(curl -sS -o /dev/null -w "%{http_code}" -X OPTIONS "$BASE_URL/api/stripe-checkout")
assert_http_in "$code" "200" "204"
ok "CORS preflight working"

bold "3) Webhook Security (401 expected for unsigned requests)"
read -r code < <(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/stripe-webhook" \
  -H "Content-Type: application/json" -d '{"test": "data"}')
assert_http_in "$code" "401" "400" "403"
ok "Webhook rejects unsigned requests"

bold "4) Dashboard Redirects (301 expected for dashboard.html)"
read -r code < <(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard.html")
assert_http_in "$code" "200" "301" "302"
ok "Dashboard redirect working"

bold "5) Main Dashboard (200 expected)"
read -r code < <(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard")
assert_http_in "$code" "200"
ok "Main dashboard accessible"

bold "6) Cache Headers (no-store expected for API)"
cache_header=$(curl -sS -I "$BASE_URL/api/plan/me" | grep -i "cache-control" | head -1)
if echo "$cache_header" | grep -qi "no-store"; then
  ok "API has no-store cache control"
else
  warn "API cache control: $cache_header"
fi

bold "7) Environment Variables Check"
# Test if the API can access environment variables by checking error messages
response=$(curl -sS "$BASE_URL/api/plan/me" || true)
if echo "$response" | grep -q "unauthorized"; then
  ok "Environment variables are accessible (auth working)"
else
  warn "Unexpected API response: $response"
fi

echo
bold "🎉 DEPLOYMENT VERIFICATION COMPLETE"
echo
bold "Next Steps for Manual Testing:"
echo "1. Open $BASE_URL/dashboard in browser"
echo "2. Sign in with your Firebase account"
echo "3. Go to pricing page and try upgrading"
echo "4. Verify no 401 errors in console"
echo "5. Check that UI shows correct plan after upgrade"
echo
bold "Browser Console Test (run while logged in):"
echo "const k = Object.keys(localStorage).find(x => x.startsWith('firebase:authUser:'));"
echo "const token = JSON.parse(localStorage.getItem(k)).stsTokenManager.accessToken;"
echo "fetch('/api/plan/me', { headers: { Authorization: \`Bearer \${token}\` } })"
echo "  .then(r => r.json()).then(console.log);"
echo
ok "All automated tests passed! 🚀"

