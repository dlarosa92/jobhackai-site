#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FAILURES=0

error() {
  echo "::error::$1"
  FAILURES=1
}

search_pattern() {
  local pattern="$1"
  local file="$2"

  if [[ "${FORCE_GREP:-0}" != "1" ]] && command -v rg >/dev/null 2>&1; then
    rg -q --regexp "$pattern" "$file"
    return
  fi

  grep -Eq "$pattern" "$file"
}

require_match() {
  local file="$1"
  local pattern="$2"
  local message="$3"

  if [[ ! -f "$file" ]]; then
    error "$message (missing file: $file)"
    return
  fi

  if ! search_pattern "$pattern" "$file"; then
    error "$message ($file)"
  fi
}

echo "Running navigation/auth guardrails..."

# Guardrail: root dashboard page must remain strongly protected.
require_match "dashboard.html" "<script[^>]*js/static-auth-guard\\.js" \
  "dashboard.html must load static auth guard"
require_match "dashboard.html" "firebase-auth\\.js" \
  "dashboard.html must bootstrap Firebase auth before navigation features"

# Guardrail: keep dev/QA self-contained for nav home/logo destinations.
require_match "js/navigation.js" \
  "VISITOR_HOME_HREF[[:space:]]*=[[:space:]]*IS_DEV_OR_QA_HOST[[:space:]]*\\?[[:space:]]*'index\\.html'[[:space:]]*:[[:space:]]*'https://jobhackai\\.io/'" \
  "js/navigation.js must keep dev/QA Home links self-contained"
require_match "js/navigation.js" \
  "VISITOR_LOGO_HREF[[:space:]]*=[[:space:]]*IS_DEV_OR_QA_HOST[[:space:]]*\\?[[:space:]]*'/'[[:space:]]*:[[:space:]]*'https://jobhackai\\.io/'" \
  "js/navigation.js must keep dev/QA logo links self-contained"
require_match "js/logo-link-env.js" \
  "return[[:space:]]+isDevOrQaHost[[:space:]]*\\?[[:space:]]*'/'[[:space:]]*:[[:space:]]*'https://jobhackai\\.io/'" \
  "js/logo-link-env.js must keep dev/QA logo links self-contained"

require_match "marketing/js/navigation.js" \
  "VISITOR_HOME_HREF[[:space:]]*=[[:space:]]*IS_DEV_OR_QA_HOST[[:space:]]*\\?[[:space:]]*'index\\.html'[[:space:]]*:[[:space:]]*'https://jobhackai\\.io/'" \
  "marketing/js/navigation.js must keep dev/QA Home links self-contained"
require_match "marketing/js/navigation.js" \
  "VISITOR_LOGO_HREF[[:space:]]*=[[:space:]]*IS_DEV_OR_QA_HOST[[:space:]]*\\?[[:space:]]*'/'[[:space:]]*:[[:space:]]*'https://jobhackai\\.io/'" \
  "marketing/js/navigation.js must keep dev/QA logo links self-contained"
require_match "marketing/js/logo-link-env.js" \
  "return[[:space:]]+isDevOrQaHost[[:space:]]*\\?[[:space:]]*'/'[[:space:]]*:[[:space:]]*'https://jobhackai\\.io/'" \
  "marketing/js/logo-link-env.js must keep dev/QA logo links self-contained"

# Guardrail: prevent re-introducing the legacy dashboard copy.
if [[ -f "app/public/dashboard.html" ]]; then
  error "Legacy file app/public/dashboard.html must not be present"
fi

if [[ "$FAILURES" -ne 0 ]]; then
  echo "Navigation/auth guardrails failed."
  exit 1
fi

echo "Navigation/auth guardrails passed."
