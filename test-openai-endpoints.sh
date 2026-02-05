#!/bin/bash

# OpenAI API Validation Tests for DEV Environment
# Tests the ROI-optimized OpenAI integration endpoints

DEV_URL="https://dev.jobhackai.io"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== OpenAI API Validation Tests ===${NC}\n"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Warning: jq not installed. Install with: brew install jq${NC}\n"
fi

# Test 1: Test OpenAI Endpoint (No Auth Required)
echo -e "${YELLOW}Test 1: Test OpenAI Integration Endpoint${NC}"
echo "Endpoint: GET $DEV_URL/api/test-openai"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$DEV_URL/api/test-openai")
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Test passed (HTTP $HTTP_STATUS)${NC}"
    echo "Response:"
    if command -v jq &> /dev/null; then
        echo "$BODY" | jq '.'
    else
        echo "$BODY"
    fi
    
    # Check for expected fields
    if echo "$BODY" | grep -q "success.*true"; then
        echo -e "${GREEN}✓ Response contains success: true${NC}"
    fi
    if echo "$BODY" | grep -q "model"; then
        echo -e "${GREEN}✓ Response contains model field${NC}"
    fi
    if echo "$BODY" | grep -q "usage"; then
        echo -e "${GREEN}✓ Response contains usage field${NC}"
    fi
else
    echo -e "${RED}✗ Test failed (HTTP $HTTP_STATUS)${NC}"
    echo "Response: $BODY"
fi

echo -e "\n${BLUE}=== Test Instructions for Authenticated Endpoints ===${NC}\n"

echo -e "${YELLOW}To test resume-feedback and resume-rewrite endpoints:${NC}\n"

echo "1. Get a Firebase JWT token:"
echo "   - Login to https://dev.jobhackai.io"
echo "   - Open browser console"
echo "   - Run: window.FirebaseAuthManager.getCurrentUser().getIdToken()"
echo "   - Copy the token"
echo ""

echo "2. Upload a resume to get resumeId:"
echo -e "${BLUE}   curl -X POST $DEV_URL/api/resume-upload \\${NC}"
echo -e "${BLUE}     -H 'Authorization: Bearer YOUR_TOKEN' \\${NC}"
echo -e "${BLUE}     -F 'file=@resume.pdf'${NC}"
echo ""

echo "3. Test resume-feedback endpoint:"
echo -e "${BLUE}   curl -X POST $DEV_URL/api/resume-feedback \\${NC}"
echo -e "${BLUE}     -H 'Content-Type: application/json' \\${NC}"
echo -e "${BLUE}     -H 'Authorization: Bearer YOUR_TOKEN' \\${NC}"
echo -e "${BLUE}     -d '{\"resumeId\": \"RESUME_ID\", \"jobTitle\": \"Data Engineer\"}'${NC}"
echo ""
echo "   Expected response structure:"
echo "   {"
echo "     \"success\": true,"
echo "     \"atsRubric\": [...],"
echo "     \"roleSpecificFeedback\": [...]"
echo "   }"
echo ""

echo "4. Test resume-rewrite endpoint (Pro/Premium only):"
echo -e "${BLUE}   curl -X POST $DEV_URL/api/resume-rewrite \\${NC}"
echo -e "${BLUE}     -H 'Content-Type: application/json' \\${NC}"
echo -e "${BLUE}     -H 'Authorization: Bearer YOUR_TOKEN' \\${NC}"
echo -e "${BLUE}     -d '{\"resumeId\": \"RESUME_ID\", \"section\": \"Experience\", \"jobTitle\": \"Data Engineer\"}'${NC}"
echo ""
echo "   Expected response structure:"
echo "   {"
echo "     \"success\": true,"
echo "     \"original\": \"...\","
echo "     \"rewritten\": \"...\","
echo "     \"changes\": [...]"
echo "   }"
echo ""

echo -e "${YELLOW}Note:${NC} The actual endpoints use resumeId (from upload), not resumeText directly."
echo "This is because resumes are stored in KV after upload for security and caching."

