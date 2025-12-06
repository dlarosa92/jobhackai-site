#!/bin/bash
# Deployment script for Render.com
# This script validates the service and provides deployment instructions

set -e

echo "🚀 PDF Parse Service - Render Deployment Helper"
echo "================================================"
echo ""

echo "📋 Pre-deployment Checklist:"
echo ""

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found"
    exit 1
fi
echo "✅ package.json found"

# Check if server.js exists
if [ ! -f "src/server.js" ]; then
    echo "❌ src/server.js not found"
    exit 1
fi
echo "✅ src/server.js found"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules not found, installing dependencies..."
    npm install
fi
echo "✅ Dependencies installed"

# API key (hardcoded for deployment)
API_KEY="5cc49831bff5be4d819f0da46ac2b85bc027534ae7d7155acb7fe2fc4feb91cd"

echo ""
echo "================================================"
echo "📝 Manual Deployment Steps for Render.com:"
echo "================================================"
echo ""
echo "1. Go to https://render.com and sign in"
echo "2. Click 'New +' → 'Web Service'"
echo "3. Connect repository: jobhackai-site"
echo "4. Configure:"
echo "   - Name: pdf-parse-service"
echo "   - Root Directory: pdf-parse-service"
echo "   - Environment: Node"
echo "   - Build Command: npm install"
echo "   - Start Command: npm start"
echo "   - Plan: Free (or Starter)"
echo ""
echo "5. Set Environment Variables:"
echo "   PORT=3000"
echo "   API_KEY=$API_KEY"
echo "   MAX_FILE_SIZE=2097152"
echo "   TIMEOUT_MS=30000"
echo ""
echo "6. Click 'Create Web Service'"
echo "7. Wait for deployment (2-3 minutes)"
echo "8. Copy the service URL (e.g., https://pdf-parse-service-xxxx.onrender.com)"
echo ""
echo "================================================"
echo "✅ After deployment, run:"
echo "   ./set-cloudflare-env.sh <SERVICE_URL>"
echo "================================================"
