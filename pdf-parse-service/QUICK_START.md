# Quick Start - PDF Parse Service Deployment

## 🔑 API Key

**⚠️ SECURITY**: Never commit API keys to the repository. Generate and store securely.

**Generate an API Key**:
```bash
openssl rand -hex 32
```

**Store securely** (environment variable or secrets manager):
```bash
export PDF_PARSE_API_KEY='your-generated-api-key-here'
```

## 🚀 Deploy to Render (5 minutes)

1. **Go to Render**: https://render.com → Sign in with GitHub

2. **Create Service**: "New +" → "Web Service" → Connect `jobhackai-site` repo

3. **Configure**:
   - Name: `pdf-parse-service`
   - Root Directory: `pdf-parse-service`
   - Environment: `Node`
   - Build: `npm install`
   - Start: `npm start`
   - Plan: Free

4. **Environment Variables**:
   ```
   PORT=3000
   API_KEY=<your-generated-api-key>
   MAX_FILE_SIZE=2097152
   TIMEOUT_MS=30000
   ```
   **⚠️**: Use the API key from your secure storage (secrets manager, environment variable, etc.)

5. **Deploy** → Copy service URL

## ⚙️ Configure Cloudflare

```bash
cd pdf-parse-service
./set-cloudflare-env.sh https://your-service-url.onrender.com
```

Or manually via Dashboard:
- Pages → jobhackai-app-dev → Settings → Environment Variables
- Add `PDF_PARSE_SERVICE_URL` and `PDF_PARSE_API_KEY` (use the same API key as your service)

## ✅ Test

```bash
curl https://your-service-url.onrender.com/health
```

Expected: `{"status":"ok","service":"pdf-parse-service"}`

## 📚 Full Details

See `DEPLOYMENT_STEPS.md` for complete instructions.




