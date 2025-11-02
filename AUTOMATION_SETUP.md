# 🤖 Auto-Deploy Automation Setup

## Overview

A Git post-commit hook has been configured to automatically:
1. Push your changes to the remote branch
2. Build the application
3. Deploy to the appropriate environment
4. Run Bugbot checks

## How It Works

The hook runs **automatically after every commit** when you're on one of these branches:
- **`dev0`** → Deploys to QA environment
- **`develop`** → Deploys to QA environment  
- **`main`** → Deploys to PRODUCTION environment

When you're on any other branch (feature branches, etc.), it will skip the auto-deploy.

## What Happens When You Commit

When you commit on `dev0`, `develop`, or `main`:

```
🚀 Auto-deploy on branch: dev0
Branch: dev0 → Deploying to QA
Pushing to origin/dev0...
Building and deploying...
Running Bugbot checks...
✅ Auto-deploy complete!
```

## Your Workflow

### Normal Development on dev0

```bash
# Make your changes
# ... edit files ...

# Commit (hook runs automatically!)
git add .
git commit -m "Add new feature"

# The hook will:
# ✅ Push to origin/dev0
# ✅ Build the app
# ✅ Deploy to QA
# ✅ Run bugbot checks
```

### Ready to Push to Develop

```bash
# Switch to develop branch
git checkout develop

# Merge your changes
git merge dev0

# Commit (hook runs automatically!)
git add .
git commit -m "Merge dev0 → develop"

# The hook will:
# ✅ Push to origin/develop
# ✅ Build the app
# ✅ Deploy to QA
# ✅ Run bugbot checks
```

### Deploying to Production

```bash
# Switch to main branch
git checkout main

# Merge your changes
git merge develop

# Commit (hook runs automatically!)
git add .
git commit -m "Release v1.0.0"

# The hook will:
# ✅ Push to origin/main
# ✅ Build the app
# ✅ Deploy to PRODUCTION ⚠️
# ✅ Run bugbot checks
```

## Disabling Auto-Deploy

If you need to commit without deploying, the **easiest way** is to add `[skip deploy]` to your commit message:

```bash
git commit -m "Update docs [skip deploy]"
```

Other options:

1. **Temporarily rename the hook**:
   ```bash
   mv .git/hooks/post-commit .git/hooks/post-commit.disabled
   git commit -m "My commit"
   mv .git/hooks/post-commit.disabled .git/hooks/post-commit
   ```

2. **Use --no-verify** (Note: This skips ALL hooks):
   ```bash
   git commit --no-verify -m "My commit"
   ```

## Troubleshooting

### Hook Not Running

Check if the hook is executable:
```bash
ls -la .git/hooks/post-commit
# Should show: -rwxr-xr-x
```

If not, make it executable:
```bash
chmod +x .git/hooks/post-commit
```

### Push Fails

If push fails (e.g., no remote changes), the hook will skip deployment. This is normal if you've already pushed.

### Deployment Fails

If deployment fails, the hook will stop and show an error message. Check:
- Cloudflare credentials are configured
- Network connection is working
- Wrangler is installed: `npm install -g wrangler`

### Bugbot Fails

Bugbot checks are informational. If they fail, review the output and fix the issues.

## Next Steps

**To test the hook right now**, make a small change and commit:

```bash
# Make a small change
echo "Test change" >> test.txt

# Commit (hook will run automatically)
git add test.txt
git commit -m "Test auto-deploy hook"

# Delete the test file
rm test.txt
git add test.txt
git commit -m "Remove test file"
```

---

**Created**: November 1, 2025  
**Location**: `.git/hooks/post-commit`

