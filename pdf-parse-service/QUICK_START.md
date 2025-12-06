# Quick Start - PDF Parse Service Deployment

## 🔑 API Key
```
5cc49831bff5be4d819f0da46ac2b85bc027534ae7d7155acb7fe2fc4feb91cd
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
   API_KEY=5cc49831bff5be4d819f0da46ac2b85bc027534ae7d7155acb7fe2fc4feb91cd
   MAX_FILE_SIZE=2097152
   TIMEOUT_MS=30000
   ```

5. **Deploy** → Copy service URL

## ⚙️ Configure Cloudflare

```bash
cd pdf-parse-service
./set-cloudflare-env.sh https://your-service-url.onrender.com
```

Or manually via Dashboard:
- Pages → jobhackai-app-dev → Settings → Environment Variables
- Add `PDF_PARSE_SERVICE_URL` and `PDF_PARSE_API_KEY` (same key as above)

## ✅ Test

```bash
curl https://your-service-url.onrender.com/health
```

Expected: `{"status":"ok","service":"pdf-parse-service"}`

## 📚 Full Details

See `DEPLOYMENT_STEPS.md` for complete instructions.




