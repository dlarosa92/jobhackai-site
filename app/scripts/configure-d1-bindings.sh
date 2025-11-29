#!/usr/bin/env bash
set -euo pipefail

# Helper script to configure D1 bindings in Cloudflare Pages
# Since D1 bindings must be configured via Dashboard, this script provides
# the exact steps and database IDs needed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🔗 D1 Binding Configuration Helper${NC}\n"

# Get database IDs
echo -e "${YELLOW}Fetching database IDs...${NC}\n"

DEV_DB_ID=$(wrangler d1 list 2>/dev/null | grep "jobhackai-dev-db" | awk '{print $1}' | head -1)
QA_DB_ID=$(wrangler d1 list 2>/dev/null | grep "jobhackai-qa-db" | awk '{print $1}' | head -1)
PROD_DB_ID=$(wrangler d1 list 2>/dev/null | grep "jobhackai-prod-db" | awk '{print $1}' | head -1)

if [ -z "$DEV_DB_ID" ] || [ -z "$QA_DB_ID" ] || [ -z "$PROD_DB_ID" ]; then
  echo -e "${YELLOW}⚠️  Some databases not found. Make sure you've run setup-d1.sh first.${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Found all databases${NC}\n"

# Display configuration instructions
cat << EOF
${BLUE}═══════════════════════════════════════════════════════════════${NC}
${BLUE}Configure D1 Bindings in Cloudflare Dashboard${NC}
${BLUE}═══════════════════════════════════════════════════════════════${NC}

${YELLOW}For each environment, follow these steps:${NC}

${GREEN}1. DEV Environment (jobhackai-app-dev)${NC}
   Database: jobhackai-dev-db
   Database ID: ${DEV_DB_ID}
   
   Steps:
   a) Go to: https://dash.cloudflare.com
   b) Navigate: Workers & Pages → jobhackai-app-dev
   c) Click: Settings → Functions
   d) Scroll to: D1 database bindings
   e) Click: Add binding
   f) Enter:
      - Variable name: ${GREEN}DB${NC}
      - D1 database: Select ${GREEN}jobhackai-dev-db${NC}
   g) Click: Save

${GREEN}2. QA Environment (jobhackai-app-qa)${NC}
   Database: jobhackai-qa-db
   Database ID: ${QA_DB_ID}
   
   Steps:
   a) Go to: https://dash.cloudflare.com
   b) Navigate: Workers & Pages → jobhackai-app-qa
   c) Click: Settings → Functions
   d) Scroll to: D1 database bindings
   e) Click: Add binding
   f) Enter:
      - Variable name: ${GREEN}DB${NC}
      - D1 database: Select ${GREEN}jobhackai-qa-db${NC}
   g) Click: Save

${GREEN}3. PROD Environment (jobhackai-app-prod)${NC}
   Database: jobhackai-prod-db
   Database ID: ${PROD_DB_ID}
   
   Steps:
   a) Go to: https://dash.cloudflare.com
   b) Navigate: Workers & Pages → jobhackai-app-prod
   c) Click: Settings → Functions
   d) Scroll to: D1 database bindings
   e) Click: Add binding
   f) Enter:
      - Variable name: ${GREEN}DB${NC}
      - D1 database: Select ${GREEN}jobhackai-prod-db${NC}
   g) Click: Save

${BLUE}═══════════════════════════════════════════════════════════════${NC}
${YELLOW}Quick Links:${NC}
${BLUE}═══════════════════════════════════════════════════════════════${NC}

DEV:  https://dash.cloudflare.com → Workers & Pages → jobhackai-app-dev → Settings → Functions
QA:   https://dash.cloudflare.com → Workers & Pages → jobhackai-app-qa → Settings → Functions  
PROD: https://dash.cloudflare.com → Workers & Pages → jobhackai-app-prod → Settings → Functions

EOF

