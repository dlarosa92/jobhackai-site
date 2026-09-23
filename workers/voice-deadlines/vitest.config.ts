import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(),'jobhackai-deadline-schema-'));
let migrations;
try {
  copyFileSync(new URL('../../app/db/schema.sql',import.meta.url),join(directory,'000_schema.sql'));
  for (const name of ['008_add_cookie_consents.sql','024_collected_payments.sql','025_checkout_attribution.sql','026_payment_campaign_links.sql','027_analytics_delivery.sql','028_account_deletion_recovery.sql','030_directory_requests.sql','031_directory_request_categories.sql']) {
    copyFileSync(new URL('../../app/db/migrations/'+name,import.meta.url),join(directory,name));
  }
  migrations = await readD1Migrations(directory);
} finally { rmSync(directory,{recursive:true,force:true}); }

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: {configPath:'./wrangler.jsonc',environment:'qa'}, remoteBindings:false,
    miniflare: {bindings:{VOICE_DEADLINES_ENABLED:'true',OPENAI_API_KEY:'sk_fixture_deadline_only',TEST_MIGRATIONS:migrations}}
  })],
  test: {include:['tests/**/*.test.ts'],fileParallelism:false}
});
