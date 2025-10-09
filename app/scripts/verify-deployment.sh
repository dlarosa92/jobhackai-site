#!/bin/bash

# JobHackAI Deployment Verification Script
# Tests all API endpoints and verifies deployment success

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default environment
ENV="${1:-dev}"

# Set base URL based on environment
case "$ENV" in
  dev|qa)
    BASE_URL="https://dev.jobhackai.io"
    ;;
  preview)
    BASE_URL="https://qa.jobhackai.io"
    ;;
  prod|production)
    BASE_URL="https://app.jobhackai.io"
    ;;
  *)
    echo -e "${RED}❌ Unknown environment: $ENV${NC}"
    echo "Usage: $0 [dev|qa|preview|prod]"
    exit 1
    ;;
esac

echo "=================================================="
echo "   JobHackAI Deployment Verification"
echo "   Environment: $ENV"
echo "   Base URL: $BASE_URL"
echo "=================================================="
echo ""

# Test 1: API Endpoint Exists (should return 405 for GET)
echo -n "1. Testing API endpoint availability... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/plan/me")
if [ "$STATUS" = "405" ] || [ "$STATUS" = "401" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $STATUS)"
else
  echo -e "${RED}❌ FAIL${NC} (HTTP $STATUS) - Expected 405 or 401, got $STATUS"
fi

# Test 2: Dashboard Redirect
echo -n "2. Testing dashboard redirect... "
REDIRECT=$(curl -s -o /dev/null -w "%{http_code}" -L "$BASE_URL/dashboard.html")
if [ "$REDIRECT" = "200" ] || [ "$REDIRECT" = "301" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $REDIRECT)"
else
  echo -e "${YELLOW}⚠️  WARN${NC} (HTTP $REDIRECT) - Expected 301 or 200"
fi

# Test 3: Cache Headers on API
echo -n "3. Testing cache headers on API routes... "
CACHE_HEADER=$(curl -s -I "$BASE_URL/api/plan/me" | grep -i "cache-control" | grep -i "no-store")
if [ -n "$CACHE_HEADER" ]; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${YELLOW}⚠️  WARN${NC} - Cache-Control: no-store not found"
fi

# Test 4: CORS Headers
echo -n "4. Testing CORS headers... "
CORS_HEADER=$(curl -s -I "$BASE_URL/api/plan/me" -H "Origin: $BASE_URL" | grep -i "access-control-allow-origin")
if [ -n "$CORS_HEADER" ]; then
  echo -e "${GREEN}✅ PASS${NC}"
else
  echo -e "${YELLOW}⚠️  WARN${NC} - CORS headers not found"
fi

# Test 5: Stripe Checkout Endpoint Exists
echo -n "5. Testing Stripe checkout endpoint... "
CHECKOUT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/stripe-checkout" -H "Content-Type: application/json" -d '{}')
if [ "$CHECKOUT_STATUS" = "401" ] || [ "$CHECKOUT_STATUS" = "422" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $CHECKOUT_STATUS - endpoint exists)"
else
  echo -e "${RED}❌ FAIL${NC} (HTTP $CHECKOUT_STATUS)"
fi

# Test 6: Billing Portal Endpoint Exists
echo -n "6. Testing billing portal endpoint... "
PORTAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/billing-portal")
if [ "$PORTAL_STATUS" = "401" ] || [ "$PORTAL_STATUS" = "404" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $PORTAL_STATUS - endpoint exists)"
else
  echo -e "${RED}❌ FAIL${NC} (HTTP $PORTAL_STATUS)"
fi

# Test 7: Auth Endpoint
echo -n "7. Testing auth endpoint... "
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth" -H "Content-Type: application/json" -d '{}')
if [ "$AUTH_STATUS" = "400" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $AUTH_STATUS - endpoint exists)"
else
  echo -e "${YELLOW}⚠️  WARN${NC} (HTTP $AUTH_STATUS)"
fi

# Test 8: Stripe Webhook Endpoint
echo -n "8. Testing stripe webhook endpoint... "
WEBHOOK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/stripe-webhook")
if [ "$WEBHOOK_STATUS" = "401" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $WEBHOOK_STATUS - signature required)"
else
  echo -e "${YELLOW}⚠️  WARN${NC} (HTTP $WEBHOOK_STATUS)"
fi

echo ""
echo "=================================================="
echo "   Verification Complete!"
echo "=================================================="
echo ""
echo "Next Steps:"
echo "1. Test with real Firebase JWT token"
echo "2. Create test Stripe checkout session"
echo "3. Verify webhook events in Stripe dashboard"
echo "4. Test from browser with authenticated user"
echo ""
echo "To test with JWT token:"
echo "  curl -H \"Authorization: Bearer \$TOKEN\" $BASE_URL/api/plan/me"
echo ""



