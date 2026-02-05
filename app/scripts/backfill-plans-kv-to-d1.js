#!/usr/bin/env node
/**
 * Backfill Script: Copy existing plans from KV to D1
 * 
 * This script reads all plan data from KV storage and writes it to D1
 * for users that don't have a plan set in D1 yet.
 * 
 * Usage:
 *   node backfill-plans-kv-to-d1.js
 * 
 * Requires:
 *   - CLOUDFLARE_API_TOKEN
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - KV_NAMESPACE_ID_DEV (or auto-detect)
 *   - Access to D1 database via wrangler
 */

import { updateUserPlan } from '../functions/_lib/db.js';

// This script would need to:
// 1. List all KV keys matching "planByUid:*"
// 2. Extract UID from each key
// 3. Read plan value from KV
// 4. Read related KV keys (trialEnd, cancelAt, etc.)
// 5. Write to D1 using updateUserPlan
// 6. Log progress

// Note: This is a placeholder - actual implementation would require
// Cloudflare API access to list KV keys, which isn't available via wrangler
// Would need to use Cloudflare API directly or maintain a list of UIDs

console.log('Backfill script placeholder - manual migration recommended');
console.log('To backfill:');
console.log('1. Export KV keys via Cloudflare Dashboard');
console.log('2. For each planByUid:${uid} key:');
console.log('   - Read plan value');
console.log('   - Read related keys (trialEndByUid, cancelAtByUid, etc.)');
console.log('   - Call updateUserPlan(env, uid, { plan, ... })');
console.log('   - Or use wrangler d1 execute to UPDATE users SET plan = ? WHERE auth_id = ?');

