<!-- 6390efcb-7639-4d3f-8e7f-087cccba87f8 dacd677d-627e-4a7b-99c7-69c3beb9d91e -->
# Redeploy Original _redirects Configuration

## Goal

Deploy the current state of `app/public/_redirects` (which you've reverted to the original SPA configuration) to dev.jobhackai.io from the dev0 branch.

## Current _redirects State

The file now contains the original configuration:
```
# Handle client-side routing for Next.js static export
/dashboard/   /dashboard/index.html    200
/dashboard-simple/   /dashboard-simple/index.html    200

# Fallback for all other routes
/*    /index.html   200
```

This is the pre-loop-fix configuration with the SPA fallback.

## Deployment Steps

1. Build the app from `/app` directory:
   ```bash
   cd /Users/dlarosa92/Desktop/JobHackAI/jobhackai-site/app
   npm run build
   ```

2. Deploy to dev0 branch (which serves dev.jobhackai.io):
   ```bash
   npm run deploy:qa
   ```

This will restore the site to its working state before we attempted the redirect loop fix.

### To-dos

- [ ] Fix app/public/_redirects: add multi-page route→file mappings, remove SPA fallback
- [ ] js/firebase-auth.js: Add promise-based waitForAuthReady + reset cache in onAuthStateChanged
- [ ] js/navigation.js: Add logout-intent flag, ONLY remove LS keys (no writes)
- [ ] js/login-page.js: Add safeRedirect(), check logout-intent, replace 6 redirects
- [ ] Update js/static-auth-guard.js + apply to 13 protected pages
- [ ] js/self-healing.js: Demote localStorage modal to console.warn
- [ ] Update all JS location.* calls to use routes (/login, /dashboard)
- [ ] Verify all 7 tasks completed, run validation toolkit
- [ ] Run npm run build in /app directory
- [ ] Deploy to dev.jobhackai.io using npm run deploy:qa
- [ ] Run all 5 test scenarios with console validation
- [ ] Commit changes and push to dev0 branch