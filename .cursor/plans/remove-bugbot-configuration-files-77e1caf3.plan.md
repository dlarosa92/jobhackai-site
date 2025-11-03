<!-- 77e1caf3-09d8-4dae-948e-9fd3c29ba396 9a4bc121-94a6-4bcf-8b16-d7addad32010 -->
# Remove Bugbot Configuration Files

## Files to Delete

### Core Bugbot Files (Configuration & Script)

1. **`scripts/bugbot-check.js`** - Main bugbot validation script that performs QA checks
2. **`.bugbot.md`** - Bugbot configuration file with rules and checks

### Bugbot YAML Workflow Files (Not Found Locally)

May exist on GitHub or in branches:

- `.cursor/auto_bugbot_sync.yml` - Potential Cursor automation config
- `.cursor/bugbot.yml` - Potential Cursor bugbot config
- `.cursor/bugbot-auto.yml` - Potential Cursor auto-bugbot config
- `.github/workflows/bugbot.yml` - Potential GitHub Actions workflow
- `.cursor/auto-bugbot-run.yaml` - Potential Cursor automation runner

### Documentation References (Informational Only)

These files mention bugbot but don't contain active configuration:

- `AUTOMATION_SETUP.md` - References bugbot checks in automation workflow
- `DEPLOYMENT_COMPLETE.md` - Contains passing mention of bugbot checks
- `PR_SUMMARY.md` - Contains passing mention of bugbot checks  
- `SECURITY_FIXES_COMPLETE.md` - Contains passing mentions of bugbot checks

## Implementation

### Step 1: Delete Core Bugbot Files

- `scripts/bugbot-check.js` - The executable validation script
- `.bugbot.md` - The configuration/rules file

### Step 2: Attempt to Delete YAML Workflow Files

Even though not found locally, attempt to delete in case they exist but are hidden:

- `.cursor/auto_bugbot_sync.yml`
- `.cursor/bugbot.yml`
- `.cursor/bugbot-auto.yml`
- `.github/workflows/bugbot.yml`
- `.cursor/auto-bugbot-run.yaml`

### Step 3: Verify GitHub Integration

After deletion, check GitHub repository for:

- Actions/Workflows tab for any bugbot workflows
- Settings → Secrets for bugbot-related secrets
- Pull requests to ensure bugbot no longer interferes

### Step 4: Optional Documentation Cleanup

If desired, remove bugbot references from documentation files (informational only).

### Step 5: Deploy to dev.jobhackai.io

After all bugbot files are deleted:

1. Commit the changes to the dev0 branch
2. Build the application: `cd app && npm run build`
3. Deploy to dev environment: `cd app && npm run deploy:qa` (deploys to dev.jobhackai.io via dev0 branch)

## Notes

- `.github/` directory doesn't exist locally but may exist on GitHub
- No references found in `package.json` files
- Git hooks (if they exist) are in `.git/hooks/` which is gitignored
- If YAML files don't exist locally but bugbot still interferes, they may be configured directly in GitHub repository settings
- Deployment is done from `/app` directory using `npm run deploy:qa` which deploys to dev.jobhackai.io via the dev0 branch