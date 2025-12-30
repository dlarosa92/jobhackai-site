// Admin API: Generate role template using OpenAI
// POST /api/admin/generate-role-template
// Requires ADMIN_API_KEY authentication

import { generateRoleTemplate } from '../../_lib/openai-template-generator.js';
import { getDb } from '../../_lib/db.js';

function corsHeaders(origin, env) {
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status = 200, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, env)
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  
  // Auth check
  const authHeader = request.headers.get('Authorization');
  const expectedAuth = `Bearer ${env.ADMIN_API_KEY}`;
  if (!env.ADMIN_API_KEY || authHeader !== expectedAuth) {
    return json({ error: 'Unauthorized' }, 401, origin, env);
  }
  
  try {
    const { roleLabel } = await request.json();
    if (!roleLabel || typeof roleLabel !== 'string') {
      return json({ error: 'roleLabel required (string)' }, 400, origin, env);
    }
    
    // Generate template
    const template = await generateRoleTemplate(env, roleLabel);
    
    // Save to D1 as pending_review
    const db = getDb(env);
    if (db) {
      await db.prepare(
        `INSERT INTO role_templates (role_family, must_have_json, nice_to_have_json, tools_json, status, created_by, version)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(role_family) DO UPDATE SET
           must_have_json = ?,
           nice_to_have_json = ?,
           tools_json = ?,
           status = 'pending_review',
           version = version + 1,
           updated_at = datetime('now')`
      ).bind(
        template.role_family,
        JSON.stringify(template.must_have),
        JSON.stringify(template.nice_to_have),
        JSON.stringify(template.tools),
        'pending_review',
        'system',
        // ON CONFLICT values
        JSON.stringify(template.must_have),
        JSON.stringify(template.nice_to_have),
        JSON.stringify(template.tools)
      ).run();
    }
    
    return json({ 
      success: true, 
      template,
      message: `Template generated and saved as pending_review for role_family: ${template.role_family}`
    }, 200, origin, env);
  } catch (error) {
    console.error('[GENERATE-TEMPLATE] Error:', error);
    return json({ 
      error: 'Generation failed', 
      message: error.message 
    }, 500, origin, env);
  }
}

