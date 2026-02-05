#!/bin/bash

# Deployment Verification Script for Role-Specific Feedback Fix
# Verifies all files, imports, and tests before Cloudflare Pages deployment

set -u  # Exit on undefined vars only (don't exit on command failures)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Function to print status
print_status() {
    local exit_code=$1
    local message=$2
    if [ "$exit_code" -eq 0 ]; then
        echo -e "${GREEN}✅ $message${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}❌ $message${NC}"
        FAILED=$((FAILED + 1))
    fi
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    WARNINGS=$((WARNINGS + 1))
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Deployment Verification: Role-Specific Feedback Fix${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$APP_DIR")"

cd "$APP_DIR"

echo -e "${BLUE}📁 Checking file structure...${NC}"
echo ""

# 1. Check required files exist
print_info "Checking required files..."

REQUIRED_FILES=(
    "functions/_lib/feedback-validator.js"
    "functions/api/resume-feedback.js"
    "functions/_lib/openai-client.js"
    "functions/_lib/__tests__/feedback-validator.test.mjs"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        print_status 0 "File exists: $file"
    else
        print_status 1 "File missing: $file"
        # Don't exit on first missing file, continue checking
    fi
done

echo ""

# 2. Check Cloudflare Pages function structure
print_info "Verifying Cloudflare Pages function structure..."

# Functions should be in app/functions/ (not root /functions/)
if [ -d "functions" ]; then
    # Check if we're in app/ directory (functions should be here)
    if [ -f "package.json" ] || [ -f "next.config.js" ]; then
        print_status 0 "Functions directory in correct location (app/functions/)"
    else
        print_warning "Functions directory exists but may not be in app/ directory"
    fi
else
    print_status 1 "Functions directory missing"
fi

# Check _lib directory exists
if [ -d "functions/_lib" ]; then
    print_status 0 "_lib directory exists"
else
    print_status 1 "_lib directory missing"
fi

echo ""

# 3. Verify imports
print_info "Checking import statements..."

# Check feedback-validator.js exports
if grep -q "export function validateAIFeedback" "functions/_lib/feedback-validator.js"; then
    print_status 0 "validateAIFeedback exported"
else
    print_status 1 "validateAIFeedback not exported"
fi

if grep -q "export function validateFeedbackResult" "functions/_lib/feedback-validator.js"; then
    print_status 0 "validateFeedbackResult exported"
else
    print_status 1 "validateFeedbackResult not exported"
fi

# Check resume-feedback.js imports
if grep -q "import.*validateAIFeedback.*validateFeedbackResult.*from.*feedback-validator" "functions/api/resume-feedback.js"; then
    print_status 0 "resume-feedback.js imports validator functions"
else
    print_status 1 "resume-feedback.js missing validator imports"
fi

echo ""

# 4. Check validation logic implementation
print_info "Verifying validation logic implementation..."

# Check that validation is called in retry loop
if grep -q "validateAIFeedback(aiFeedback" "functions/api/resume-feedback.js"; then
    print_status 0 "Validation called in retry loop"
else
    print_status 1 "Validation not called in retry loop"
fi

# Check that aiFeedback is set to null on validation failure
if grep -q "aiFeedback = null" "functions/api/resume-feedback.js"; then
    print_status 0 "aiFeedback reset to null on validation failure"
else
    print_warning "aiFeedback may not be reset on validation failure"
fi

# Check cache validation
if grep -q "validateFeedbackResult(result)" "functions/api/resume-feedback.js"; then
    print_status 0 "Cache validation implemented"
else
    print_status 1 "Cache validation missing"
fi

echo ""

# 5. Check token limit update
print_info "Checking token limit configuration..."

if grep -q ": 3500" "functions/_lib/openai-client.js"; then
    print_status 0 "Token limit set to 3500"
elif grep -q "OPENAI_MAX_TOKENS_ATS" "functions/_lib/openai-client.js"; then
    print_status 0 "Token limit uses environment variable (configurable)"
else
    print_warning "Token limit may not be updated"
fi

echo ""

# 6. Run unit tests
print_info "Running unit tests..."

if [ -f "functions/_lib/__tests__/feedback-validator.test.mjs" ]; then
    cd functions/_lib/__tests__
    if node feedback-validator.test.mjs > /tmp/test-output.log 2>&1; then
        print_status 0 "All unit tests passed"
        echo ""
        echo "Test results:"
        tail -5 /tmp/test-output.log | sed 's/^/  /'
    else
        print_status 1 "Unit tests failed"
        echo ""
        echo "Test output:"
        cat /tmp/test-output.log | sed 's/^/  /'
    fi
    cd "$APP_DIR"
else
    print_warning "Test file not found, skipping tests"
fi

echo ""

# 7. Check for syntax errors (basic check)
print_info "Checking for syntax errors..."

# Check JavaScript syntax using node --check
if node --check functions/_lib/feedback-validator.js 2>/dev/null; then
    print_status 0 "feedback-validator.js syntax valid"
else
    print_status 1 "feedback-validator.js has syntax errors"
fi

if node --check functions/api/resume-feedback.js 2>/dev/null; then
    print_status 0 "resume-feedback.js syntax valid"
else
    print_status 1 "resume-feedback.js has syntax errors"
fi

echo ""

# 8. Verify required environment variables are documented
print_info "Checking environment variable documentation..."

ENV_VARS=(
    "OPENAI_API_KEY"
    "OPENAI_MAX_TOKENS_ATS"
    "JOBHACKAI_KV"
)

echo "Required environment variables for Cloudflare Pages:"
for var in "${ENV_VARS[@]}"; do
    echo "  - $var"
done

echo ""

# 9. Check for common issues
print_info "Checking for common deployment issues..."

# Check for hardcoded paths
if grep -r "require.*\.\.\/\.\.\/" functions/ 2>/dev/null | grep -v node_modules | grep -v ".test."; then
    print_warning "Found potential relative path issues"
else
    print_status 0 "No problematic relative paths found"
fi

# Check for console.log in production code (warnings only)
CONSOLE_LOGS=$(grep -r "console\.log" functions/api/resume-feedback.js functions/_lib/feedback-validator.js 2>/dev/null | wc -l)
if [ "$CONSOLE_LOGS" -gt 0 ]; then
    print_warning "Found $CONSOLE_LOGS console.log statements (consider using console.error for errors)"
else
    print_status 0 "No console.log statements found"
fi

echo ""

# 10. Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Verification Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNINGS${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All critical checks passed! Ready for deployment.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Set environment variables in Cloudflare Pages dashboard"
    echo "  2. Deploy to dev environment first"
    echo "  3. Test with actual resume uploads (txt, docx, pdf)"
    echo "  4. Monitor logs for validation failures"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please fix issues before deploying.${NC}"
    echo ""
    exit 1
fi
