#!/bin/bash

# OpenAI API Validation Tests for DEV Environment
# Tests the ROI-optimized OpenAI integration

DEV_URL="https://dev.jobhackai.io"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== OpenAI API Validation Tests ===${NC}\n"

# Note: These endpoints require authentication and resumeId
# For direct testing, you'll need:
# 1. A valid Firebase JWT token
# 2. A resumeId from /api/resume-upload

echo -e "${YELLOW}Test 1: Test OpenAI Endpoint (No Auth Required)${NC}"
echo "Testing: GET $DEV_URL/api/test-openai"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$DEV_URL/api/test-openai")
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Test passed${NC}"
    echo "Response:"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Test failed (HTTP $HTTP_STATUS)${NC}"
    echo "Response: $BODY"
fi

echo -e "\n${YELLOW}=== Test Instructions ===${NC}"
echo "To test resume-feedback and resume-rewrite endpoints, you need:"
echo ""
echo "1. Get a Firebase JWT token (from browser console after login):"
echo "   window.FirebaseAuthManager.getCurrentUser().getIdToken()"
echo ""
echo "2. Upload a resume to get resumeId:"
echo "   curl -X POST $DEV_URL/api/resume-upload \\"
echo "     -H 'Authorization: Bearer YOUR_TOKEN' \\"
echo "     -F 'file=@resume.pdf'"
echo ""
echo "3. Test resume-feedback:"
echo "   curl -X POST $DEV_URL/api/resume-feedback \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer YOUR_TOKEN' \\"
echo "     -d '{\"resumeId\": \"RESUME_ID\", \"jobTitle\": \"Data Engineer\"}'"
echo ""
echo "4. Test resume-rewrite:"
echo "   curl -X POST $DEV_URL/api/resume-rewrite \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer YOUR_TOKEN' \\"
echo "     -d '{\"resumeId\": \"RESUME_ID\", \"section\": \"Experience\", \"jobTitle\": \"Data Engineer\"}'"
echo ""

