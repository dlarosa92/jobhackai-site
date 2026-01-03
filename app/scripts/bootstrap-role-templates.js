/**
 * Bootstrap Script: Migrate existing role templates from code to D1
 * 
 * Usage:
 *   ADMIN_API_KEY=your-key node app/scripts/bootstrap-role-templates.js
 * 
 * This script reads ROLE_SKILL_TEMPLATES from role-skills.js and
 * inserts them into D1 as 'active' templates.
 */

import { ROLE_SKILL_TEMPLATES } from '../functions/_lib/role-skills.js';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'https://dev.jobhackai.io';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY) {
  console.error('Error: ADMIN_API_KEY environment variable required');
  console.error('Usage: ADMIN_API_KEY=your-key node app/scripts/bootstrap-role-templates.js');
  process.exit(1);
}

async function bootstrapTemplates() {
  console.log(`[BOOTSTRAP] Starting template migration to ${ADMIN_API_URL}...`);
  console.log(`[BOOTSTRAP] Found ${Object.keys(ROLE_SKILL_TEMPLATES).length} templates in code`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const [roleFamily, template] of Object.entries(ROLE_SKILL_TEMPLATES)) {
    try {
      const response = await fetch(`${ADMIN_API_URL}/api/admin/role-templates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ADMIN_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role_family: roleFamily,
          must_have: template.must_have || [],
          nice_to_have: template.nice_to_have || [],
          tools: template.tools || [],
          status: 'active', // Bootstrap as active
          created_by: 'bootstrap-script'
        })
      });
      
      if (response.ok) {
        successCount++;
        console.log(`✅ Migrated ${roleFamily}`);
      } else {
        errorCount++;
        const errorText = await response.text();
        console.error(`❌ Failed to migrate ${roleFamily}: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      errorCount++;
      console.error(`❌ Error migrating ${roleFamily}:`, error.message);
    }
  }
  
  console.log(`\n[BOOTSTRAP] Complete: ${successCount} succeeded, ${errorCount} failed`);
  
  if (errorCount > 0) {
    process.exit(1);
  }
}

bootstrapTemplates().catch(error => {
  console.error('[BOOTSTRAP] Fatal error:', error);
  process.exit(1);
});


