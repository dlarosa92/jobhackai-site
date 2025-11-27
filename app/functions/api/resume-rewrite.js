// Resume Rewrite endpoint
// Pro/Premium only - AI-powered resume rewriting

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { generateResumeRewrite } from '../_lib/openai-client.js';
import { errorResponse, successResponse, generateRequestId } from '../_lib/error-handler.js';
import { sanitizeJobTitle, sanitizeResumeId, sanitizeSection } from '../_lib/input-sanitizer.js';

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
    Vary: 'Origin'
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
  const requestId = generateRequestId();

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  try {
    const token = getBearer(request);
    if (!token) {
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    const { uid } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const plan = await getUserPlan(uid, env);

    if (plan !== 'pro' && plan !== 'premium') {
      return errorResponse(
        'Resume Rewriting is available in Pro or Premium plans only.',
        403,
        origin,
        env,
        requestId,
        { upgradeRequired: true }
      );
    }

    if (env.JOBHACKAI_KV) {
      const now = Date.now();
      const hourlyKey = `rewriteThrottle:${uid}:hour`;
      const lastHourly = await env.JOBHACKAI_KV.get(hourlyKey);

      if (lastHourly) {
        const lastHourlyTime = parseInt(lastHourly, 10);
        const timeSinceLastHourly = now - lastHourlyTime;

        if (timeSinceLastHourly < 3600000) {
          const retryAfter = Math.ceil((3600000 - timeSinceLastHourly) / 1000);
          return json({
            success: false,
            error: 'Rate limit exceeded',
            message: 'Please wait before requesting another rewrite (~1 per hour).',
            retryAfter
          }, 429, origin, env);
        }
      }

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

    const body = await request.json();
    const { resumeId, section, jobTitle, atsIssues, roleSpecificFeedback } = body;

    // Sanitize and validate inputs
    const resumeIdValidation = sanitizeResumeId(resumeId);
    if (!resumeIdValidation.valid) {
      return errorResponse(resumeIdValidation.error || 'Invalid resume ID', 400, origin, env, requestId);
    }
    const sanitizedResumeId = resumeIdValidation.sanitized;

    const jobTitleValidation = sanitizeJobTitle(jobTitle, 200);
    if (!jobTitleValidation.valid || jobTitleValidation.sanitized.length === 0) {
      return errorResponse('Job title is required and must be valid (max 200 characters)', 400, origin, env, requestId);
    }
    const sanitizedJobTitle = jobTitleValidation.sanitized;

    const sectionValidation = sanitizeSection(section);
    if (!sectionValidation.valid) {
      return errorResponse(sectionValidation.error || 'Invalid section name', 400, origin, env, requestId);
    }
    const sanitizedSection = sectionValidation.sanitized;

    if (!env.JOBHACKAI_KV) {
      return errorResponse('Storage not available', 500, origin, env, requestId);
    }

    const resumeKey = `resume:${sanitizedResumeId}`;
    const resumeDataStr = await env.JOBHACKAI_KV.get(resumeKey);

    if (!resumeDataStr) {
      return errorResponse('Resume not found', 404, origin, env, requestId);
    }

    const resumeData = JSON.parse(resumeDataStr);

    if (resumeData.uid !== uid) {
      return errorResponse('Unauthorized', 403, origin, env, requestId);
    }

    // Resume text length is validated when stored, but double-check
    if (resumeData.text && resumeData.text.length > 80000) {
      return errorResponse('Resume text exceeds 80,000 character limit', 400, origin, env, requestId);
    }

    let rewrittenText = '';
    let originalText = '';
    let changeSummary = { atsFixes: [], roleFixes: [] };
    let tokenUsage = 0;
    const maxRetries = 3;
    let lastError = null;

    if (sanitizedSection) {
      const lines = resumeData.text.split('\n');
      const sectionLower = sanitizedSection.toLowerCase();
      let sectionStartIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(sectionLower)) {
          sectionStartIndex = i;
          break;
        }
      }

      if (sectionStartIndex >= 0) {
        const sectionLines = [];
        for (let i = sectionStartIndex; i < lines.length; i++) {
          const line = lines[i];
          if (
            i > sectionStartIndex &&
            /^(EXPERIENCE|EDUCATION|SKILLS|PROJECTS|AWARDS|CERTIFICATIONS|SUMMARY|OBJECTIVE|PROFILE)/i.test(line.trim())
          ) {
            break;
          }
          sectionLines.push(line);
        }
        originalText = sectionLines.join('\n').trim();
      } else {
        originalText = resumeData.text.substring(0, 500);
      }
    } else {
      originalText = resumeData.text;
    }

    // Validate optional parameters
    const validAtsIssues = (atsIssues && Array.isArray(atsIssues) && atsIssues.length > 0) ? atsIssues : null;
    const validRoleFeedback = (roleSpecificFeedback && 
                                roleSpecificFeedback.targetRoleUsed !== undefined &&
                                Array.isArray(roleSpecificFeedback.sections) &&
                                roleSpecificFeedback.sections.length > 0) ? roleSpecificFeedback : null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const aiResponse = await generateResumeRewrite(
          resumeData.text,
          sanitizedSection || null,
          sanitizedJobTitle,
          validAtsIssues,
          validRoleFeedback,
          env
        );

        // Capture token usage from OpenAI response
        if (aiResponse && aiResponse.usage) {
          tokenUsage = aiResponse.usage.totalTokens || 0;
        }

        if (!aiResponse || !aiResponse.content) {
          // Handle falsy content: treat as error and apply backoff
          lastError = new Error('AI response missing content');
          console.error(`[RESUME-REWRITE] AI response missing content (attempt ${attempt + 1}/${maxRetries})`);
          if (attempt < maxRetries - 1) {
            const waitTime = Math.pow(2, attempt + 1) * 1000;
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
          continue;
        }

        let parsed;

        if (typeof aiResponse.content === 'string') {
          try {
            parsed = JSON.parse(aiResponse.content);
          } catch (parseError) {
            rewrittenText = aiResponse.content.trim();
            if (rewrittenText) {
              break;
            }
            // Empty string after trim - treat as error
            lastError = new Error('AI returned empty content');
            if (attempt < maxRetries - 1) {
              const waitTime = Math.pow(2, attempt + 1) * 1000;
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }
            continue;
          }
        } else {
          parsed = aiResponse.content;
        }

        // Handle new response structure with rewrittenResume and changeSummary
        rewrittenText = parsed.rewrittenResume || parsed.rewritten || parsed.content || '';
        changeSummary = parsed.changeSummary || { atsFixes: [], roleFixes: [] };

        if (rewrittenText) {
          break;
        } else {
          // No rewritten text extracted - treat as error
          lastError = new Error('Failed to extract rewritten text from AI response');
          if (attempt < maxRetries - 1) {
            const waitTime = Math.pow(2, attempt + 1) * 1000;
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
      } catch (aiError) {
        lastError = aiError;
        console.error(`[RESUME-REWRITE] AI rewrite error (attempt ${attempt + 1}/${maxRetries}):`, aiError);

        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt + 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    if (!rewrittenText) {
      if (lastError && env.JOBHACKAI_KV) {
        try {
          const errorKey = `rewriteError:${uid}:${Date.now()}`;
          await env.JOBHACKAI_KV.put(errorKey, JSON.stringify({
            requestId,
            resumeId: sanitizedResumeId,
            section: sanitizedSection,
            jobTitle: sanitizedJobTitle,
            error: lastError.message,
            timestamp: Date.now()
          }), {
            expirationTtl: 604800
          });
        } catch (kvError) {
          console.warn('[RESUME-REWRITE] Failed to log error to KV:', kvError);
        }
      }

      return errorResponse(
        lastError || new Error('AI rewrite timed out. Please try again.'),
        500,
        origin,
        env,
        requestId,
        { retryable: true, endpoint: 'resume-rewrite' }
      );
    }

    if (env.JOBHACKAI_KV) {
      const hourlyKey = `rewriteThrottle:${uid}:hour`;
      await env.JOBHACKAI_KV.put(hourlyKey, String(Date.now()), {
        expirationTtl: 3600
      });

      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `rewriteDaily:${uid}:${today}`;
      const currentCount = await env.JOBHACKAI_KV.get(dailyKey);
      const newCount = currentCount ? parseInt(currentCount, 10) + 1 : 1;
      await env.JOBHACKAI_KV.put(dailyKey, String(newCount), {
        expirationTtl: 86400
      });
    }

    console.log('[RESUME-REWRITE] Success', { requestId, uid, resumeId: sanitizedResumeId, tokenUsage });

    return successResponse({
      tokenUsage: tokenUsage,
      original: originalText,
      rewritten: rewrittenText,
      rewrittenResume: rewrittenText, // Alias for backwards compatibility
      changeSummary: changeSummary,
      section: sanitizedSection || 'full'
    }, 200, origin, env, requestId);
  } catch (error) {
    console.error('[RESUME-REWRITE] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error,
      500,
      origin,
      env,
      requestId,
      { endpoint: 'resume-rewrite' }
    );
  }
}

