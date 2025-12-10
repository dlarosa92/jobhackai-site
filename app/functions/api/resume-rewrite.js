// Resume Rewrite endpoint
// Pro/Premium only - AI-powered resume rewriting

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { generateResumeRewrite } from '../_lib/openai-client.js';
import { errorResponse, successResponse, generateRequestId } from '../_lib/error-handler.js';
import { sanitizeJobTitle, sanitizeResumeId, sanitizeSection } from '../_lib/input-sanitizer.js';
import { getOrCreateUserByAuthId, getResumeSessionByResumeId, isD1Available } from '../_lib/db.js';

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

function json(data, status = 200, origin, env, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, env),
      ...extraHeaders
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

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    const plan = await getUserPlan(uid, env);
    // Effective cooldown is 45s, but KV requires a minimum TTL of 60s.
    // We store the timestamp with a slightly longer TTL for safety, and enforce 45s in code.
    const cooldownSeconds = 45;
    const kvTtlSeconds = 75;

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
      const cooldownKey = `rewriteCooldown:${uid}`;
      const lastTs = await env.JOBHACKAI_KV.get(cooldownKey);

      if (lastTs) {
        const timeSinceLast = now - parseInt(lastTs, 10);

        if (timeSinceLast < cooldownSeconds * 1000) {
          const retryAfter = Math.ceil((cooldownSeconds * 1000 - timeSinceLast) / 1000);
          return json({
            success: false,
            error: 'Rate limit exceeded',
            message: `Please wait before requesting another rewrite (~${cooldownSeconds}s cooldown).`,
            retryAfter
          }, 429, origin, env, {
            'Retry-After': String(retryAfter)
          });
        }
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
      const cooldownKey = `rewriteCooldown:${uid}`;
      await env.JOBHACKAI_KV.put(cooldownKey, String(Date.now()), {
        expirationTtl: kvTtlSeconds
      });
    }

    console.log('[RESUME-REWRITE] Success', { requestId, uid, resumeId: sanitizedResumeId, tokenUsage });

    // Persist rewrite into latest feedback_session (Pro/Premium only, D1 best effort)
    if (isD1Available(env)) {
      try {
        const d1User = await getOrCreateUserByAuthId(env, uid, payload?.email || null);
        if (d1User && env.DB) {
          const resumeSession = await getResumeSessionByResumeId(env, d1User.id, sanitizedResumeId);
          if (resumeSession) {
            const latestFeedback = await env.DB.prepare(`
              SELECT id, feedback_json 
              FROM feedback_sessions 
              WHERE resume_session_id = ? 
              ORDER BY created_at DESC 
              LIMIT 1
            `).bind(resumeSession.id).first();

            if (latestFeedback) {
              let parsed = {};
              let parseFailed = false;
              try {
                parsed = latestFeedback.feedback_json ? JSON.parse(latestFeedback.feedback_json) : {};
              } catch (parseError) {
                parseFailed = true;
                console.warn('[RESUME-REWRITE] Failed to parse existing feedback_json; skipping rewrite update to avoid data loss', {
                  requestId,
                  error: parseError.message
                });
              }

              if (!parseFailed) {
                parsed.rewrittenResume = rewrittenText;
                parsed.rewriteChangeSummary = changeSummary;
                // Preserve originalResume if not already stored (for backwards compatibility)
                if (!parsed.originalResume && originalText) {
                  parsed.originalResume = originalText;
                }

                await env.DB.prepare(
                  `UPDATE feedback_sessions SET feedback_json = ? WHERE id = ?`
                ).bind(JSON.stringify(parsed), latestFeedback.id).run();

                console.log('[RESUME-REWRITE] Updated feedback_session with rewrite fields', {
                  requestId,
                  resumeSessionId: resumeSession.id,
                  feedbackSessionId: latestFeedback.id
                });
              }
            } else {
              console.log('[RESUME-REWRITE] No feedback_session found to attach rewrite (resume_session exists)', {
                requestId,
                resumeSessionId: resumeSession.id
              });
            }
          } else {
            console.log('[RESUME-REWRITE] No resume_session found to attach rewrite', {
              requestId,
              resumeId: sanitizedResumeId
            });
          }
        }
      } catch (d1Error) {
        console.warn('[RESUME-REWRITE] Failed to persist rewrite to D1 (non-blocking)', {
          requestId,
          error: d1Error.message
        });
      }
    }

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

