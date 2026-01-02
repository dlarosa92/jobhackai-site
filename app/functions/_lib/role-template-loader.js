/**
 * Role Template Loader
 * D1-first template loading with code fallback
 * 
 * Design: D1 is source of truth, but code provides bootstrap/fallback
 */

import { getDb } from './db.js';
import { ROLE_SKILL_TEMPLATES } from './role-skills.js'; // Bootstrap fallback

/**
 * Load role template from D1, fallback to code
 * @param {Object} env - Cloudflare environment
 * @param {string} roleFamily - e.g., "mobile_developer", "data_engineer"
 * @returns {Promise<Object>} Template { must_have, nice_to_have, tools }
 */
export async function loadRoleTemplate(env, roleFamily) {
  const db = getDb(env);
  
  // Try D1 first
  if (db) {
    try {
      const row = await db.prepare(
        'SELECT must_have_json, nice_to_have_json, tools_json FROM role_templates WHERE role_family = ? AND status = ?'
      ).bind(roleFamily, 'active').first();
      
      if (row) {
        return {
          must_have: JSON.parse(row.must_have_json),
          nice_to_have: JSON.parse(row.nice_to_have_json),
          tools: JSON.parse(row.tools_json)
        };
      }
    } catch (error) {
      console.warn(`[TEMPLATE-LOADER] D1 error for ${roleFamily}, using fallback:`, error.message);
    }
  }
  
  // Fallback to code
  return ROLE_SKILL_TEMPLATES[roleFamily] || ROLE_SKILL_TEMPLATES.generic_professional;
}

/**
 * Load all active templates (for admin queries)
 * @param {Object} env - Cloudflare environment
 * @returns {Promise<Object>} Map of role_family -> template
 */
export async function loadAllActiveTemplates(env) {
  const db = getDb(env);
  if (!db) return {};
  
  try {
    const rows = await db.prepare(
      'SELECT role_family, must_have_json, nice_to_have_json, tools_json FROM role_templates WHERE status = ?'
    ).bind('active').all();
    
    const templates = {};
    for (const row of rows.results || []) {
      templates[row.role_family] = {
        must_have: JSON.parse(row.must_have_json),
        nice_to_have: JSON.parse(row.nice_to_have_json),
        tools: JSON.parse(row.tools_json)
      };
    }
    return templates;
  } catch (error) {
    console.error('[TEMPLATE-LOADER] Error loading all templates:', error);
    return {};
  }
}


