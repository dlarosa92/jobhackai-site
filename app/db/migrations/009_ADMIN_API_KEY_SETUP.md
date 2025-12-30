# ADMIN_API_KEY Setup

## Generated Keys
✅ **ADMIN_API_KEY has been set for each environment with unique keys**

Each environment has its own unique key configured via Wrangler CLI and stored securely in Cloudflare Pages secrets. This enables independent key rotation and environment isolation.

**Keys (for archival):**
- **DEV**: `c8b5c4747b40d5dca0310b1ecc8eb31ca1f6e3f345875bac5805d29aa281368a`
- **QA**: `10fcca29e85c930d2f8a4fdc7f21b91cc85922a8c8a6c672b5e8dd15d04ff2d5`
- **PROD**: `9c90caae013e8994badf99fc0f32e59b0be1b3e165c59354945b0935d5843ce4`

## Usage

When calling admin endpoints, include the key in the Authorization header:

```bash
curl https://dev.jobhackai.io/api/admin/role-templates \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

## Admin Endpoints

- `POST /api/admin/generate-role-template` - Generate new templates
- `GET /api/admin/role-templates?status=pending_review` - List templates
- `POST /api/admin/role-templates` - Create/update templates
- `PATCH /api/admin/role-templates` - Approve/deprecate templates
- `GET /api/admin/detect-gaps` - Find roles with low keyword scores

## Security Notes

- ✅ Keys are stored as Cloudflare Pages secrets (encrypted)
- ✅ Keys are NOT committed to git
- ✅ **Unique keys per environment** (DEV/QA/PROD) for security isolation
- ✅ Enables independent key rotation per environment
- ⚠️ Keep keys secure - don't share publicly
- ⚠️ Rotate keys periodically if compromised
- ⚠️ If one environment key is compromised, others remain secure

## Verification

To verify the key is set:
```bash
# Check if secret exists (won't show value)
wrangler pages secret list --project-name=jobhackai-app-dev
```

## Regenerating Keys

If you need to regenerate (recommended: unique keys per environment):
1. Generate new keys for each environment: `openssl rand -hex 32` (run 3 times)
2. Set unique key for each environment:
   ```bash
   # DEV
   echo "DEV_KEY_HERE" | wrangler pages secret put ADMIN_API_KEY --project-name=jobhackai-app-dev
   
   # QA
   echo "QA_KEY_HERE" | wrangler pages secret put ADMIN_API_KEY --project-name=jobhackai-app-qa
   
   # PROD
   echo "PROD_KEY_HERE" | wrangler pages secret put ADMIN_API_KEY --project-name=jobhackai-app-prod
   ```

**Security Best Practice**: Use different keys for each environment to enable independent rotation and prevent cross-environment access if one key is compromised.

