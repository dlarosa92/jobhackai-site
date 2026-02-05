# Cloudflare API Token Setup for User Deletion

This guide explains how to create a Cloudflare API token with the correct permissions to delete user data from D1 databases and KV namespaces.

## Required Permissions

Your API token needs the following permissions:

1. **Account → Cloudflare D1 → Edit**
   - Allows reading and writing to D1 databases
   - Required to delete user records from D1

2. **Account → Cloudflare Workers → Edit** (or **Account → Workers KV Storage → Edit**)
   - Allows reading and writing to KV namespaces
   - Required to delete KV keys

## Step-by-Step Instructions

### 1. Go to Cloudflare API Tokens Page

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click on your profile icon (top right)
3. Select **"My Profile"**
4. Click on **"API Tokens"** in the left sidebar
5. Or go directly to: https://dash.cloudflare.com/profile/api-tokens

### 2. Create a Custom Token

1. Click **"Create Token"** button
2. Click **"Create Custom Token"** (or use "Edit Cloudflare Workers" template as a starting point)

### 3. Configure Token Permissions

#### Account Resources
- Select **"Include"** for "Account"
- Choose your account (the one containing your D1 databases and KV namespaces)

#### Permissions

Add the following permissions:

1. **Cloudflare D1 → Edit**
   - Account → Cloudflare D1 → Edit
   - This allows full access to D1 databases

2. **Workers KV Storage → Edit** (or **Cloudflare Workers → Edit**)
   - Account → Workers KV Storage → Edit
   - OR
   - Account → Cloudflare Workers → Edit (broader permission that includes KV)
   - This allows reading and writing to KV namespaces

#### Account Resources (Specific Resources - Optional)

If you want to restrict the token to specific resources:

- **D1 Databases**: 
  - Include: `jobhackai-dev-db`, `jobhackai-qa-db`
- **KV Namespaces**:
  - Include: `jobhackai-kv-dev-qa-shared` (namespace ID: `5237372648c34aa6880f91e1a0c9708a`)

**Note**: For simplicity, you can grant account-level permissions. The token will work for all databases and KV namespaces in your account.

### 4. Set Token Restrictions (Optional but Recommended)

- **TTL**: Set an expiration date if this is a temporary token
- **IP Address Filtering**: Restrict to specific IPs if needed
- **Client IP Address Condition**: Leave empty for flexibility

### 5. Create and Copy Token

1. Click **"Continue to summary"**
2. Review your permissions
3. Click **"Create Token"**
4. **IMPORTANT**: Copy the token immediately - you won't be able to see it again!
5. Store it securely (use a password manager, environment variable, etc.)

## Using the Token

### Option 1: Environment Variable (Recommended)

```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
export CLOUDFLARE_ACCOUNT_ID="fabf4409ef32f8c64354a1a099bef2a2"
```

### Option 2: Inline with Script

```bash
CLOUDFLARE_API_TOKEN="your-token-here" \
CLOUDFLARE_ACCOUNT_ID="fabf4409ef32f8c64354a1a099bef2a2" \
./delete-user-by-name.sh REPLACE_WITH_USER_ID test.user@example.com
```

## Verifying Token Permissions

### Test D1 Access

```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
npx wrangler d1 execute jobhackai-dev-db \
  --command "SELECT 1;" \
  --remote \
  --json
```

If successful, you'll see:
```json
{
  "success": true,
  "results": [...]
}
```

If you get an authentication error, the token doesn't have D1 permissions.

### Test KV Access

```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
export CLOUDFLARE_ACCOUNT_ID="fabf4409ef32f8c64354a1a099bef2a2"
export KV_NAMESPACE_ID="5237372648c34aa6880f91e1a0c9708a"

curl -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?limit=1" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json"
```

If successful, you'll see:
```json
{
  "success": true,
  "result": [...]
}
```

## Troubleshooting

### Error: "Authentication error [code: 10000]"

**Cause**: The API token doesn't have the required permissions.

**Solution**: 
1. Go back to API Tokens page
2. Edit your token
3. Add the missing permissions:
   - Cloudflare D1 → Edit
   - Workers KV Storage → Edit

### Error: "Rate limited. Please wait..."

**Cause**: Too many API requests in a short time.

**Solution**: 
- The script includes rate limiting protection
- Wait a few minutes and try again
- Consider using a higher-tier Cloudflare plan for higher rate limits

### Error: "Database not found" or "Namespace not found"

**Cause**: Wrong database name or namespace ID.

**Solution**: 
- Verify database names in `wrangler.toml`
- Verify KV namespace ID in Cloudflare Dashboard → Workers & Pages → KV

## Security Best Practices

1. **Never commit tokens to git** - Use environment variables or secret management
2. **Use minimal permissions** - Only grant what's needed
3. **Set expiration dates** - For temporary tokens
4. **Rotate tokens regularly** - Especially if shared or exposed
5. **Use IP restrictions** - If accessing from fixed locations
6. **Monitor token usage** - Check Cloudflare logs for suspicious activity

## Alternative: Using Wrangler Login

If you prefer not to use API tokens, you can use OAuth:

```bash
npx wrangler login
```

This will open a browser and authenticate via OAuth. After login, wrangler commands will work without an API token, but you'll need to be logged in to the same account.
