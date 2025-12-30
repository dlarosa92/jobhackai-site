// Admin API: Detect role gaps (low keyword scores)
// GET /api/admin/detect-gaps
// Returns roles with low avg keyword scores (<20) and usage >= 5

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  
  try {
    // Find roles with low average keyword scores (potential gaps)
    // Criteria: avg_score < 20 AND usage_count >= 5 (last 30 days)
    const rows = await db.prepare(`
      SELECT 
        role_family, 
        AVG(keyword_score) as avg_score, 
        COUNT(*) as usage_count,
        MIN(keyword_score) as min_score,
        MAX(keyword_score) as max_score
      FROM role_usage_log
      WHERE created_at > datetime('now', '-30 days')
      GROUP BY role_family
      HAVING avg_score < 20 AND usage_count >= 5
      ORDER BY usage_count DESC, avg_score ASC
    `).all();
    
    return json({ 
      success: true,
      gaps: (rows.results || []).map(r => ({
        role_family: r.role_family,
        avg_score: Math.round(r.avg_score * 100) / 100,
        usage_count: r.usage_count,
        min_score: r.min_score,
        max_score: r.max_score
      }))
    }, 200, origin, env);
  } catch (error) {
    console.error('[DETECT-GAPS] Error:', error);
    return json({ 
      error: 'Failed to detect gaps', 
      message: error.message 
    }, 500, origin, env);
  }
}

