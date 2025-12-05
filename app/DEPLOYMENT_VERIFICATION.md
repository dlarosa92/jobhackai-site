# Deployment Verification Guide: Role-Specific Feedback Fix

## 🎯 Overview

This guide ensures the Role-Specific Feedback fix is ready for Cloudflare Pages deployment to the dev environment.

## ✅ Pre-Deployment Checklist

### 1. Run Verification Script

```bash
cd app
bash scripts/verify-deployment.sh
```

**Expected Output:**
- ✅ All critical checks passed
- ✅ 17+ checks passed
- ⚠️  0-1 warnings (console.log statements are acceptable)

### 2. Verify Files Are Committed

```bash
git status
```

Ensure these files are committed:
- `app/functions/_lib/feedback-validator.js` (NEW)
- `app/functions/_lib/__tests__/feedback-validator.test.mjs` (NEW)
- `app/functions/api/resume-feedback.js` (MODIFIED)
- `app/functions/_lib/openai-client.js` (MODIFIED)
- `app/scripts/verify-deployment.sh` (NEW)

### 3. Environment Variables

Set these in **Cloudflare Pages Dashboard** → **Settings** → **Environment Variables**:

#### Required for Dev Environment:
```
OPENAI_API_KEY=sk-...                    # Your OpenAI API key
OPENAI_MAX_TOKENS_ATS=3500               # Optional (defaults to 3500)
JOBHACKAI_KV=<your-kv-namespace-id>      # For caching feedback results
```

#### Optional (for monitoring):
```
ENVIRONMENT=dev                          # Environment identifier
```

## 🚀 Deployment Steps

### Step 1: Verify Branch
```bash
git branch
# Should be on: fix/role-specific-feedback-validation
```

### Step 2: Run Verification
```bash
cd app
bash scripts/verify-deployment.sh
```

### Step 3: Deploy to Dev
```bash
# Option 1: Via Cloudflare Dashboard
# - Go to Pages → Your Project → Deployments
# - Click "Create deployment" → Select branch: fix/role-specific-feedback-validation

# Option 2: Via Wrangler CLI
cd app
npm run deploy:dev  # or your dev deployment command
```

### Step 4: Verify Deployment

1. **Check Function Availability**
   ```bash
   curl https://dev.jobhackai.io/api/resume-feedback \
     -X POST \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <test-token>"
   ```
   Should return 401 (unauthorized) or 400 (bad request), not 404.

2. **Test with Actual Resume**
   - Upload a resume (txt, docx, or pdf)
   - Add a job title
   - Verify Role-Specific Feedback appears

3. **Monitor Logs**
   - Check Cloudflare Dashboard → Workers & Pages → Logs
   - Look for validation errors or warnings
   - Search for: `[RESUME-FEEDBACK] Invalid AI response structure`

## 🔍 What the Verification Script Checks

### File Structure ✅
- All required files exist in correct locations
- Cloudflare Pages function structure is correct
- `_lib` directory exists

### Code Quality ✅
- All imports are correct
- Validation functions are exported
- Validation logic is implemented
- Token limit is updated (3500)

### Testing ✅
- Unit tests pass (11/11 tests)
- Syntax validation passes
- No critical errors

### Deployment Readiness ✅
- No problematic relative paths
- Environment variables documented
- Common issues checked

## 📊 Expected Results After Deployment

### Success Indicators:
1. ✅ Role-Specific Feedback appears for all file types (txt, docx, pdf)
2. ✅ No validation errors in logs
3. ✅ Cache validation working (incomplete results not cached)
4. ✅ Token usage within limits (check OpenAI dashboard)

### Failure Indicators:
1. ❌ 404 errors on `/api/resume-feedback` → Function not deployed
2. ❌ Validation errors in logs → Check OpenAI response format
3. ❌ Missing role-specific feedback → Check validation logic
4. ❌ Truncation errors → Increase token limit further

## 🐛 Troubleshooting

### Issue: Functions return 404
**Solution:** Verify functions are in `app/functions/` (not root `/functions/`)

### Issue: Import errors
**Solution:** Check import paths use relative paths from `functions/` directory

### Issue: Validation always fails
**Solution:** 
1. Check OpenAI API key is set
2. Check token limit is sufficient (3500)
3. Review logs for actual OpenAI response structure

### Issue: Tests fail
**Solution:** Run tests manually:
```bash
cd app/functions/_lib/__tests__
node feedback-validator.test.mjs
```

## 📝 Post-Deployment Monitoring

### Week 1: Daily Checks
- Monitor validation failure rates
- Check token usage
- Review error logs
- Verify cache hit rates

### Week 2-4: Weekly Checks
- Review validation patterns
- Optimize token limits if needed
- Check user feedback

## 🎉 Success Criteria

- ✅ All verification checks pass
- ✅ Role-Specific Feedback appears 100% of the time
- ✅ No validation errors in production logs
- ✅ Cache working correctly
- ✅ Token usage within budget

---

**Last Updated:** $(date)
**Branch:** fix/role-specific-feedback-validation
**PR:** #180

