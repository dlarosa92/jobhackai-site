# ADMIN_API_KEY Setup

## Generated Key
✅ **ADMIN_API_KEY has been set for all environments (DEV, QA, PROD)**

The key has been configured via Wrangler CLI and is stored securely in Cloudflare Pages secrets.

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

- ✅ Key is stored as a Cloudflare Pages secret (encrypted)
- ✅ Key is NOT committed to git
- ✅ Same key used across DEV/QA/PROD for consistency
- ⚠️ Keep the key secure - don't share publicly
- ⚠️ Rotate periodically if compromised

## Verification

To verify the key is set:
```bash
# Check if secret exists (won't show value)
wrangler pages secret list --project-name=jobhackai-app-dev
```

## Regenerating Key

If you need to regenerate:
1. Generate new key: `openssl rand -hex 32`
2. Set for each environment:
   ```bash
   wrangler pages secret put ADMIN_API_KEY --project-name=jobhackai-app-dev
   wrangler pages secret put ADMIN_API_KEY --project-name=jobhackai-app-qa
   wrangler pages secret put ADMIN_API_KEY --project-name=jobhackai-app-prod
   ```

