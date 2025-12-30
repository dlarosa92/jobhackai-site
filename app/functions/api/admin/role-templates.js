// Admin API: CRUD operations for role templates
// GET /api/admin/role-templates?status=active
// POST /api/admin/role-templates (create/update)
// PATCH /api/admin/role-templates (approve/deprecate)

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
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const { method } = request;
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }
  
  // Auth check
  const authHeader = request.headers.get('Authorization');
  const expectedAuth = `Bearer ${env.ADMIN_API_KEY}`;
  if (!env.ADMIN_API_KEY || authHeader !== expectedAuth) {
    return json({ error: 'Unauthorized' }, 401, origin, env);
  }
  
  const db = getDb(env);
  if (!db) {
    return json({ error: 'Database unavailable' }, 500, origin, env);
  }
  
  if (method === 'GET') {
    // List templates by status
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'active';
    
    try {
      const rows = await db.prepare(
        'SELECT role_family, must_have_json, nice_to_have_json, tools_json, status, version, created_at, updated_at FROM role_templates WHERE status = ? ORDER BY role_family'
      ).bind(status).all();
      
      return json({
        success: true,
        templates: (rows.results || []).map(r => ({
          role_family: r.role_family,
          must_have: JSON.parse(r.must_have_json),
          nice_to_have: JSON.parse(r.nice_to_have_json),
          tools: JSON.parse(r.tools_json),
          status: r.status,
          version: r.version,
          created_at: r.created_at,
          updated_at: r.updated_at
        }))
      }, 200, origin, env);
    } catch (error) {
      console.error('[ROLE-TEMPLATES] GET error:', error);
      return json({ error: 'Failed to fetch templates', message: error.message }, 500, origin, env);
    }
  }
  
  if (method === 'POST') {
    // Create/update template
    try {
      const { role_family, must_have, nice_to_have, tools, status = 'pending_review', created_by } = await request.json();
      
      // Validate structure
      if (!role_family || !Array.isArray(must_have) || !Array.isArray(nice_to_have) || !Array.isArray(tools)) {
        return json({ error: 'Invalid template structure' }, 400, origin, env);
      }
      // Validate status - only allow known states to avoid invisible templates
      const ALLOWED_POST_STATUS = ['pending_review', 'active', 'deprecated'];
      if (!ALLOWED_POST_STATUS.includes(status)) {
        return json({ error: 'Invalid status value', allowed: ALLOWED_POST_STATUS }, 400, origin, env);
      }
      
      await db.prepare(
        `INSERT INTO role_templates (role_family, must_have_json, nice_to_have_json, tools_json, status, created_by, version)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(role_family) DO UPDATE SET
           must_have_json = ?,
           nice_to_have_json = ?,
           tools_json = ?,
           status = ?,
           version = version + 1,
           updated_at = datetime('now')`
      ).bind(
        role_family,
        JSON.stringify(must_have),
        JSON.stringify(nice_to_have),
        JSON.stringify(tools),
        status,
        created_by || 'admin',
        // ON CONFLICT values
        JSON.stringify(must_have),
        JSON.stringify(nice_to_have),
        JSON.stringify(tools),
        status
      ).run();
      
      return json({ success: true }, 200, origin, env);
    } catch (error) {
      console.error('[ROLE-TEMPLATES] POST error:', error);
      return json({ error: 'Failed to save template', message: error.message }, 500, origin, env);
    }
  }
  
  if (method === 'PATCH') {
    // Approve/deprecate
    try {
      const { role_family, status, approved_by } = await request.json();
      
      if (!role_family || !status) {
        return json({ error: 'role_family and status required' }, 400, origin, env);
      }
      
      if (!['active', 'deprecated'].includes(status)) {
        return json({ error: 'status must be "active" or "deprecated"' }, 400, origin, env);
      }
      
      const result = await db.prepare(
        'UPDATE role_templates SET status = ?, approved_by = ?, approved_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE role_family = ?'
      ).bind(status, approved_by || 'admin', role_family).run();
      
      // Verify that a row was actually updated
      const changes = result?.meta?.changes ?? 0;
      if (changes === 0) {
        return json({ 
          error: 'Template not found', 
          message: `No template found with role_family: ${role_family}` 
        }, 404, origin, env);
      }
      
      return json({ success: true }, 200, origin, env);
    } catch (error) {
      console.error('[ROLE-TEMPLATES] PATCH error:', error);
      return json({ error: 'Failed to update template', message: error.message }, 500, origin, env);
    }
  }
  
  return json({ error: 'Method not allowed' }, 405, origin, env);
}

