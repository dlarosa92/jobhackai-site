<!-- 6d535700-c46c-425f-9316-0f1d47a0e432 f4f4fba7-275d-43b9-a0f6-38a8f7d43b8c -->
# Replace dev0 with develop commit 6b50e48 and deploy to dev.jobhackai.io

## Current State

- **develop**: Commit `6b50e48` (Merge dev0 to develop - Auth flow fixes and UX improvements) - THIS IS THE GOOD STATE
- **dev0 (local)**: Commit `fcacec1` (local has newer commits)
- **dev0 (remote/Cloudflare)**: Commit `4809e9c` (currently deployed to dev.jobhackai.io)
- **Target**: Replace dev0 with develop's state at `6b50e48`
- **Deployment**: Deploy to `dev.jobhackai.io` from dev0 branch

## Strategy

1. Create backup of current dev0 before replacing
2. Reset dev0 to match develop at commit 6b50e48
3. Force push dev0 to replace remote
4. Build and deploy from dev0 to dev.jobhackai.io

## Implementation Steps

### 1. Create backup branch

- Create `backup/dev0-before-develop-replace-2025-11-05` from current dev0
- Preserves current dev0 state in case rollback needed

### 2. Reset dev0 to match develop

- Checkout dev0 branch
- Reset to commit 6b50e48 (hard reset to match develop exactly)
- Force push to origin/dev0 to replace remote branch

### 3. Deploy to dev.jobhackai.io

- Ensure on dev0 branch (should now be at 6b50e48)
- Build the application: `cd app && npm run build`
- Deploy using: `npm run deploy:qa` (deploys --branch dev0 to dev.jobhackai.io)

## Files Affected

- No code changes, only git branch manipulation
- Deployment will use state from commit 6b50e48 (the known good state)

## Risk Mitigation

- Backup branch created before any changes
- Using hard reset to ensure clean state (no merge conflicts)
- Deploying from dev0 which is configured for dev.jobhackai.io

## Verification

After deployment, verify:

- dev.jobhackai.io shows commit 6b50e48
- Subscription details work correctly
- Account settings page loads properly
- No regressions from the known good state

### To-dos

- [ ] Fix document.body.classList error in account-setting.html by moving script to DOMContentLoaded or end of body
- [ ] Improve static-auth-guard.js to wait for Firebase auth initialization before redirecting on account-setting page
- [ ] Verify Account link in navigation.js correctly navigates to account-setting.html without interceptors
- [ ] Refactor account-setting.html initialization to consolidate auth checks and add proper error handling
- [ ] Verify and preserve Stripe plan display integration in renderBillingSection function
- [ ] Test complete navigation flow: Dashboard → Account link → Account Settings page loads correctly