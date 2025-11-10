// Resume Rewrite endpoint
// Pro/Premium only - AI-powered resume rewriting

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { generateResumeRewrite } from '../_lib/openai-client.js';

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
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, env)
    }
  });
}

async function getUserPlan(uid, env) {
  if (!env.JOBHACKAI_KV) {
    return 'free';
  }
  
  const plan = await env.JOBHACKAI_KV.get(`planByUid:${uid}`);
  return plan || 'free';
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405, origin, env);
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return json({ success: false, error: 'Unauthorized' }, 401, origin, env);
    }

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const plan = await getUserPlan(uid, env);

    // Check plan access (Pro/Premium only)
    if (plan !== 'pro' && plan !== 'premium') {
      return json({
        success: false,
        error: 'Feature locked',
        message: 'Resume Rewriting is available in Pro or Premium plans only.',
        upgradeRequired: true
      }, 403, origin, env);
    }

    // Throttle check (Pro/Premium: ~1/hr, 5/day)
    if (env.JOBHACKAI_KV) {
      const now = Date.now();
      
      // Hourly throttle
      const hourlyKey = `rewriteThrottle:${uid}:hour`;
      const lastHourly = await env.JOBHACKAI_KV.get(hourlyKey);
      
      if (lastHourly) {
        const lastHourlyTime = parseInt(lastHourly, 10);
        const timeSinceLastHourly = now - lastHourlyTime;
        
        if (timeSinceLastHourly < 3600000) { // 1 hour
          const retryAfter = Math.ceil((3600000 - timeSinceLastHourly) / 1000);
          return json({
            success: false,
            error: 'Rate limit exceeded',
            message: 'Please wait before requesting another rewrite (~1 per hour).',
            retryAfter
          }, 429, origin, env);
        }
      }

      // Daily limit (5/day)
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `rewriteDaily:${uid}:${today}`;
      const dailyCount = await env.JOBHACKAI_KV.get(dailyKey);
      
      if (dailyCount && parseInt(dailyCount, 10) >= 5) {
        return json({
          success: false,
          error: 'Daily limit reached',
          message: 'You have reached the daily limit (5 rewrites/day).',
          upgradeRequired: false
        }, 429, origin, env);
      }
    }

    // Parse request body
    const body = await request.json();
    const { resumeId, section, jobTitle } = body;

    if (!resumeId) {
      return json({ success: false, error: 'resumeId required' }, 400, origin, env);
    }

    // Retrieve resume from KV
    if (!env.JOBHACKAI_KV) {
      return json({ success: false, error: 'Storage not available' }, 500, origin, env);
    }

    const resumeKey = `resume:${resumeId}`;
    const resumeDataStr = await env.JOBHACKAI_KV.get(resumeKey);
    
    if (!resumeDataStr) {
      return json({ success: false, error: 'Resume not found' }, 404, origin, env);
    }

    const resumeData = JSON.parse(resumeDataStr);
    
    // Verify resume belongs to user
    if (resumeData.uid !== uid) {
      return json({ success: false, error: 'Unauthorized' }, 403, origin, env);
    }

    // Cost guardrails
    if (resumeData.text.length > 80000) {
      return json({ 
        success: false, 
        error: 'Resume text exceeds 80,000 character limit' 
      }, 400, origin, env);
    }

    // Generate rewrite using AI with exponential backoff retry
    let rewrittenText = '';
    let originalText = '';
    const maxRetries = 3;
    let lastError = null;
    
    originalText = section 
      ? resumeData.text.split('\n').find(line => line.toLowerCase().includes(section.toLowerCase())) || resumeData.text.substring(0, 500)
      : resumeData.text;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const aiResponse = await generateResumeRewrite(
          resumeData.text,
          section,
          jobTitle || 'Software Engineer',
          env
        );
        
        // Parse structured output or handle plain text fallback
        if (aiResponse.content) {
          let parsed;
          
          // Try to parse as JSON (structured output), but handle plain text gracefully
          if (typeof aiResponse.content === 'string') {
            try {
              parsed = JSON.parse(aiResponse.content);
            } catch (parseError) {
              // If JSON parsing fails, treat as plain text (fallback for non-structured responses)
              rewrittenText = aiResponse.content.trim();
              if (rewrittenText) {
                break; // Success, exit retry loop
              }
              continue; // Empty text, try again
            }
          } else {
            parsed = aiResponse.content;
          }
          
          // Extract rewritten text from structured output
          rewrittenText = parsed.rewritten || parsed.content || '';
          
          if (rewrittenText) {
            break; // Success, exit retry loop
          }
        }
      } catch (aiError) {
        lastError = aiError;
        console.error(`[RESUME-REWRITE] AI rewrite error (attempt ${attempt + 1}/${maxRetries}):`, aiError);
        
        // Exponential backoff: wait 2s, 4s, 8s (longer for rewrite since it's more expensive)
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt + 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // If all retries failed, return error
    if (!rewrittenText) {
      // Log failed response to KV for diagnostics (best effort)
      if (lastError && env.JOBHACKAI_KV) {
        try {
          const errorKey = `rewriteError:${uid}:${Date.now()}`;
          await env.JOBHACKAI_KV.put(errorKey, JSON.stringify({
            resumeId,
            section,
            jobTitle,
            error: lastError.message,
            timestamp: Date.now()
          }), {
            expirationTtl: 604800 // 7 days
          });
        } catch (kvError) {
          console.warn('[RESUME-REWRITE] Failed to log error to KV:', kvError);
        }
      }
      
      return json({
        success: false,
        error: 'Failed to generate rewrite',
        message: lastError?.message || 'AI rewrite timed out. Please try again.',
        retryable: true
      }, 500, origin, env);
    }

    // Update throttles
    if (env.JOBHACKAI_KV) {
      const hourlyKey = `rewriteThrottle:${uid}:hour`;
      await env.JOBHACKAI_KV.put(hourlyKey, String(Date.now()), {
        expirationTtl: 3600 // 1 hour
      });

      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `rewriteDaily:${uid}:${today}`;
      const currentCount = await env.JOBHACKAI_KV.get(dailyKey);
      const newCount = currentCount ? parseInt(currentCount, 10) + 1 : 1;
      await env.JOBHACKAI_KV.put(dailyKey, String(newCount), {
        expirationTtl: 86400 // 24 hours
      });
    }

    return json({
      success: true,
      original: originalText,
      rewritten: rewrittenText,
      section: section || 'full'
    }, 200, origin, env);

  } catch (error) {
    console.error('[RESUME-REWRITE] Error:', error);
    return json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    }, 500, origin, env);
  }
}

