#!/bin/bash
# Set Cloudflare Worker environment variables for PDF Parse Service
# Usage: ./set-cloudflare-env.sh <SERVICE_URL>
# Example: ./set-cloudflare-env.sh https://pdf-parse-service-xxxx.onrender.com

set -e

if [ -z "$1" ]; then
    echo "❌ Error: Service URL required"
    echo "Usage: ./set-cloudflare-env.sh <SERVICE_URL>"
    echo "Example: ./set-cloudflare-env.sh https://pdf-parse-service-xxxx.onrender.com"
    exit 1
fi

SERVICE_URL=$1

# API key must be provided via environment variable for security
if [ -z "$PDF_PARSE_API_KEY" ]; then
    echo "❌ Error: PDF_PARSE_API_KEY environment variable is required"
    echo ""
    echo "Usage:"
    echo "  export PDF_PARSE_API_KEY='your-api-key-here'"
    echo "  ./set-cloudflare-env.sh <SERVICE_URL>"
    echo ""
    echo "The API key should be stored securely and not committed to the repository."
    exit 1
fi

API_KEY="$PDF_PARSE_API_KEY"

echo "🔐 Setting Cloudflare Worker environment variables..."
echo ""
echo "Service URL: $SERVICE_URL"
echo "API Key: ${API_KEY:0:8}... (hidden)"
echo ""

# Navigate to app directory
cd "$(dirname "$0")/../app" || exit 1

# Set environment variables for dev environment
echo "Setting PDF_PARSE_SERVICE_URL..."
echo "$SERVICE_URL" | wrangler pages secret put PDF_PARSE_SERVICE_URL --project-name=jobhackai-app-dev

echo ""
echo "Setting PDF_PARSE_API_KEY..."
echo "$API_KEY" | wrangler pages secret put PDF_PARSE_API_KEY --project-name=jobhackai-app-dev

echo ""
echo "✅ Environment variables set successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Verify variables in Cloudflare Dashboard:"
echo "   https://dash.cloudflare.com → Pages → jobhackai-app-dev → Settings → Environment Variables"
echo ""
echo "2. Test the service:"
echo "   curl $SERVICE_URL/health"
echo ""

