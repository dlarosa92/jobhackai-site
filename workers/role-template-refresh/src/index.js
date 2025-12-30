/**
 * Role Template Refresh Worker
 * Scheduled monthly to detect gaps and generate templates
 * 
 * Runs: Monthly (1st of month at 02:00 UTC)
 * Actions:
 * 1. Detect roles with low keyword scores (gaps)
 * 2. Generate templates for those roles
 * 3. Log pending count for human review
 */

export default {
  async scheduled(event, env, ctx) {
    const startTime = Date.now();
    console.log('[TEMPLATE-REFRESH] Starting monthly template refresh...');
    
    try {
      // Step 1: Detect gaps
      const gapsResponse = await fetch(`${env.ADMIN_API_URL || 'https://dev.jobhackai.io'}/api/admin/detect-gaps`, {
        headers: {
          'Authorization': `Bearer ${env.ADMIN_API_KEY}`
        }
      });
      
      if (!gapsResponse.ok) {
        throw new Error(`Gap detection failed: ${gapsResponse.status}`);
      }
      
      const gapsData = await gapsResponse.json();
      const gaps = gapsData.gaps || [];
      
      console.log(`[TEMPLATE-REFRESH] Found ${gaps.length} role gaps`);
      
      if (gaps.length === 0) {
        console.log('[TEMPLATE-REFRESH] No gaps detected, refresh complete');
        return;
      }
      
      // Step 2: Generate templates for each gap
      let generatedCount = 0;
      let errorCount = 0;
      
      for (const gap of gaps) {
        try {
          // Convert role_family (e.g., "data_engineer") to human-readable label (e.g., "Data Engineer")
          // The normalizer expects spaces, not underscores
          const roleLabel = gap.role_family
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
          
          const generateResponse = await fetch(`${env.ADMIN_API_URL || 'https://dev.jobhackai.io'}/api/admin/generate-role-template`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.ADMIN_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              roleLabel // Converted to human-readable format (e.g., "Data Engineer")
            })
          });
          
          if (generateResponse.ok) {
            generatedCount++;
            console.log(`[TEMPLATE-REFRESH] Generated template for ${gap.role_family}`);
          } else {
            errorCount++;
            const errorText = await generateResponse.text();
            console.error(`[TEMPLATE-REFRESH] Failed to generate template for ${gap.role_family}: ${errorText}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`[TEMPLATE-REFRESH] Error generating template for ${gap.role_family}:`, error.message);
        }
      }
      
      // Step 3: Get pending count
      const pendingResponse = await fetch(`${env.ADMIN_API_URL || 'https://dev.jobhackai.io'}/api/admin/role-templates?status=pending_review`, {
        headers: {
          'Authorization': `Bearer ${env.ADMIN_API_KEY}`
        }
      });
      
      let pendingCount = 0;
      if (pendingResponse.ok) {
        const pendingData = await pendingResponse.json();
        pendingCount = pendingData.templates?.length || 0;
      }
      
      const duration = Date.now() - startTime;
      console.log(`[TEMPLATE-REFRESH] Refresh complete: ${generatedCount} generated, ${errorCount} errors, ${pendingCount} pending review (${duration}ms)`);
      
    } catch (error) {
      console.error('[TEMPLATE-REFRESH] Fatal error:', error);
      throw error; // Re-throw to trigger Cloudflare alerting
    }
  }
};

