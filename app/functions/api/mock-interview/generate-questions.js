// Mock Interview Question Generation Endpoint
// Generates 10 role-aware interview questions using OpenAI
// Only available for Pro/Premium plans

import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { callOpenAI } from '../../_lib/openai-client.js';
import { errorResponse, successResponse, generateRequestId } from '../../_lib/error-handler.js';

function corsHeaders(origin) {
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

import { getUserPlan } from '../../_lib/db.js';

/**
 * Generate mock interview questions using OpenAI
 * Industry-trend aware, role-specific questions
 */
async function generateMockInterviewQuestions({ role, seniority, interviewStyle }, env) {
  const styleDescriptions = {
    mixed: 'a mix of behavioral, technical, and situational questions',
    behavioral: 'behavioral and situational questions using STAR method scenarios',
    technical: 'technical questions about skills, tools, architecture, and problem-solving',
    leadership: 'leadership, strategy, team management, and cross-functional alignment questions'
  };

  const styleDesc = styleDescriptions[interviewStyle] || styleDescriptions.mixed;

  const systemPrompt = `You are an expert interviewer creating realistic mock interview questions.
Tailor questions to the candidate's target role, seniority, and interview style.
Reflect current hiring manager priorities: impact, outcomes, metrics, reliability, security, quality, collaboration, and delivery.
For technical roles, also emphasize scale, performance, data/ML where relevant.
For leadership roles, emphasize strategy, team outcomes, and cross-functional alignment.
Keep questions concise and specific. Avoid trivia, brainteasers, or company-proprietary details.
Always output valid JSON.`;

  const userPrompt = `Generate 10 mock interview questions.

Inputs:
- Role: ${role}
- Seniority: ${seniority}
- Interview style: ${interviewStyle} (${styleDesc})

Constraints:
- Keep each question short, clear, and realistic for this role/seniority.
- Align with current hiring expectations (impact, outcomes, metrics, reliability/quality/security, collaboration; for technical roles: scale/performance/data/ML; for leadership: strategy, team outcomes, cross-functional alignment).
- Avoid generic repeats; vary themes (impact, delivery, quality, metrics, stakeholder management, risk/incident, scalability, ambiguity, prioritization).
- Make questions genuinely challenging and relevant for 2025 interviews.

Output JSON:
{
  "questions": [
    { "id": 1, "text": "..." },
    { "id": 2, "text": "..." },
    { "id": 3, "text": "..." },
    { "id": 4, "text": "..." },
    { "id": 5, "text": "..." },
    { "id": 6, "text": "..." },
    { "id": 7, "text": "..." },
    { "id": 8, "text": "..." },
    { "id": 9, "text": "..." },
    { "id": 10, "text": "..." }
  ]
}`;

  const responseFormat = {
    name: 'mock_interview_questions',
    schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              text: { type: 'string' }
            },
            required: ['id', 'text']
          }
        }
      },
      required: ['questions']
    }
  };

  const aiResponse = await callOpenAI({
    model: env.OPENAI_MODEL_MI || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    responseFormat,
    maxTokens: 1500,
    temperature: 0.7,
    systemPrompt,
    feature: 'mock_interview_questions'
  }, env);

  if (!aiResponse || !aiResponse.content) {
    throw new Error('AI response missing content');
  }

  const parsed = typeof aiResponse.content === 'string'
    ? JSON.parse(aiResponse.content)
    : aiResponse.content;

  return {
    questions: parsed.questions,
    tokenUsage: aiResponse.usage?.totalTokens || 0
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const requestId = generateRequestId();

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin, env, requestId);
  }

  try {
    // Verify authentication
    const token = getBearer(request);
    if (!token) {
      return errorResponse('Unauthorized', 401, origin, env, requestId);
    }

    const { uid, payload } = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);

    // Get user plan
    const plan = await getUserPlan(env, uid);
    
    // Dev environment detection
    const allowedDevOrigins = ['https://dev.jobhackai.io', 'http://localhost:3003', 'http://localhost:8788'];
    const isDevOrigin = origin && allowedDevOrigins.includes(origin);
    const isDevEnvironment = env.ENVIRONMENT === 'dev' && isDevOrigin;

    // Effective plan (dev gets pro for testing)
    let effectivePlan = plan;
    if (isDevEnvironment && plan === 'free') {
      effectivePlan = 'pro';
      console.log('[MI-QUESTIONS] Dev environment - upgrading free to pro for testing');
    }

    console.log('[MI-QUESTIONS] Plan check:', { requestId, uid, plan, effectivePlan, isDevEnvironment });

    // Mock Interview only available for Pro/Premium
    const allowedPlans = ['pro', 'premium'];
    if (!allowedPlans.includes(effectivePlan)) {
      return errorResponse(
        'Mock Interviews are available on Pro and Premium plans. Upgrade to unlock practice sessions.',
        403,
        origin,
        env,
        requestId,
        { upgradeRequired: true, requiredPlan: 'pro' }
      );
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return errorResponse('Invalid JSON in request body', 400, origin, env, requestId);
    }

    const { role, seniority, interviewStyle } = body;

    // Validate inputs
    if (!role || typeof role !== 'string' || role.trim().length === 0) {
      return errorResponse('Role is required', 400, origin, env, requestId);
    }

    if (!seniority || typeof seniority !== 'string') {
      return errorResponse('Seniority is required', 400, origin, env, requestId);
    }

    const validStyles = ['mixed', 'behavioral', 'technical', 'leadership'];
    const style = validStyles.includes(interviewStyle) ? interviewStyle : 'mixed';

    // Generate questions
    const result = await generateMockInterviewQuestions({
      role: role.trim(),
      seniority: seniority.trim(),
      interviewStyle: style
    }, env);

    console.log('[MI-QUESTIONS] Success:', {
      requestId,
      uid,
      role: role.trim(),
      seniority: seniority.trim(),
      style,
      questionCount: result.questions?.length || 0,
      tokenUsage: result.tokenUsage
    });

    return successResponse({
      questions: result.questions,
      role: role.trim(),
      seniority: seniority.trim(),
      interviewStyle: style,
      tokenUsage: result.tokenUsage
    }, 200, origin, env, requestId);

  } catch (error) {
    console.error('[MI-QUESTIONS] Error:', { requestId, error: error.message, stack: error.stack });
    return errorResponse(
      error.message || 'Failed to generate questions',
      500,
      origin,
      env,
      requestId
    );
  }
}

