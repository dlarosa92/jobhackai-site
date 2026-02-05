#!/bin/bash
# Monitor Cloudflare Pages Functions logs in real-time
# Usage: ./scripts/monitor-functions-logs.sh

echo "🔍 Monitoring Cloudflare Pages Functions logs..."
echo "Press Ctrl+C to stop"
echo ""

# Use wrangler to tail logs (requires wrangler Pages deployment)
cd app
npx wrangler pages deployment tail --project-name=jobhackai-site

