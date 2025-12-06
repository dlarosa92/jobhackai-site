# PDF Parse Service - Complete Deployment Steps

## 🔑 API Key Configuration

**⚠️ SECURITY IMPORTANT**: API keys must NEVER be committed to the repository.

**Generate an API Key** (if not already generated):
```bash
# Generate a secure random API key
openssl rand -hex 32
```

**Store the API Key Securely**:
- Use environment variables
- Use a secrets manager (e.g., Cloudflare Secrets, Render Secrets, etc.)
- Never hardcode in source files or commit to git

**⚠️ IMPORTANT**: Use the SAME key for both:
1. Parse service environment variable (`API_KEY`)
2. Cloudflare Worker environment variable (`PDF_PARSE_API_KEY`)

---

## Step 1: Deploy to Render.com

### Option A: Web Interface (Recommended)

1. **Go to Render Dashboard**
   - Visit: https://render.com
   - Sign in with GitHub

2. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Connect repository: `jobhackai-site`
   - Click "Connect"

3. **Configure Service**
   ```
   Name: pdf-parse-service
   Root Directory: pdf-parse-service
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   Plan: Free (or Starter $7/month)
   ```

4. **Set Environment Variables**
   Click "Environment" tab, then "Add Environment Variable" for each:
   ```
   PORT = 3000
   API_KEY = <your-generated-api-key>
   MAX_FILE_SIZE = 2097152
   TIMEOUT_MS = 30000
   ```
   
   **⚠️ Security**: Get your API key from a secure source (secrets manager, environment variable, etc.). Never commit API keys to the repository.

5. **Deploy**
   - Click "Create Web Service"
   - Wait 2-3 minutes for deployment
   - Copy the service URL (e.g., `https://pdf-parse-service-xxxx.onrender.com`)

### Option B: Use Helper Script

```bash
cd pdf-parse-service
./deploy-render.sh
```

This will validate the setup and provide step-by-step instructions.

---

## Step 2: Verify Service Deployment

Test the service health endpoint:

```bash
# Replace with your actual service URL
curl https://your-service-url.onrender.com/health
```

Expected response:
```json
{"status":"ok","service":"pdf-parse-service"}
```

---

## Step 3: Set Cloudflare Worker Environment Variables

### Option A: Using Helper Script (Easiest)

```bash
cd pdf-parse-service
./set-cloudflare-env.sh https://your-service-url.onrender.com
```

This will automatically set both `PDF_PARSE_SERVICE_URL` and `PDF_PARSE_API_KEY`.

### Option B: Using Wrangler CLI Manually

```bash
cd app

# Set service URL
echo "https://your-service-url.onrender.com" | \
  wrangler pages secret put PDF_PARSE_SERVICE_URL --project-name=jobhackai-app-dev

# Set API key (from environment variable)
if [ -z "$PDF_PARSE_API_KEY" ]; then
  echo "❌ Error: PDF_PARSE_API_KEY environment variable must be set"
  exit 1
fi
echo "$PDF_PARSE_API_KEY" | \
  wrangler pages secret put PDF_PARSE_API_KEY --project-name=jobhackai-app-dev
```

### Option C: Cloudflare Dashboard

1. Go to: https://dash.cloudflare.com
2. Navigate: **Pages** → **jobhackai-app-dev** → **Settings** → **Environment Variables**
3. Add for **Preview** environment:
   ```
   PDF_PARSE_SERVICE_URL = https://your-service-url.onrender.com
   PDF_PARSE_API_KEY = <your-generated-api-key>
   ```
   
   **⚠️ Security**: Get your API key from a secure source. Never commit API keys to the repository.

---

## Step 4: Test End-to-End

### Test Parse Service Directly

```bash
# Test with a sample PDF (replace <API_KEY> with your actual key)
curl -X POST https://your-service-url.onrender.com/parse-pdf \
  -H "Content-Type: application/pdf" \
  -H "X-API-Key: <API_KEY>" \
  --data-binary @../docs/Test\ Resumes/ATS-Test-Suite/resume-01-excellent-baseline.pdf
```

### Test via Worker (After Integration)

Once you integrate the Worker code (from `WORKER_INTEGRATION_EXAMPLE.md`), upload a PDF through the UI and verify it works.

---

## Step 5: Integration (Next PR)

After deployment is verified, the next step is to integrate the Worker code to use the parse service. See `docs/WORKER_INTEGRATION_EXAMPLE.md` for code changes.

---

## Troubleshooting

### Service Not Responding
- Check Render logs: Dashboard → Service → Logs
- Verify environment variables are set correctly
- Check service URL is accessible (try `/health` endpoint)

### 401 Unauthorized
- Verify API key matches exactly in both service and Worker
- Check `X-API-Key` header is being sent
- Ensure no extra spaces in API key

### Timeout Errors
- Increase `TIMEOUT_MS` in service environment variables
- Check service logs for parsing errors
- Verify PDF file is not corrupted

---

## Quick Reference

**⚠️ API Key Security**:
- Generate: `openssl rand -hex 32`
- Store securely (environment variables or secrets manager)
- Never commit to repository
- Use the same key for both service and Cloudflare

**Service Environment Variables**:
- `PORT=3000`
- `API_KEY=<your-generated-api-key>`
- `MAX_FILE_SIZE=2097152`
- `TIMEOUT_MS=30000`

**Cloudflare Environment Variables**:
- `PDF_PARSE_SERVICE_URL=<your-service-url>`
- `PDF_PARSE_API_KEY=<same-key-as-service>`




