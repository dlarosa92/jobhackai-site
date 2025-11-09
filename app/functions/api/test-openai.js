// OpenAI Integration Test Endpoint
// Verifies OPENAI_API_KEY and model configurations are working properly

import { callOpenAI } from '../_lib/openai-client.js';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(data, status = 200, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin, env)
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin, env) });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405, origin, env);
  }

  try {
    // Check if OpenAI API key is configured
    if (!env.OPENAI_API_KEY) {
      return json({
        success: false,
        error: 'OPENAI_API_KEY not configured',
        message: 'Please set OPENAI_API_KEY in Cloudflare Pages environment variables'
      }, 500, origin, env);
    }

    // Get model configuration from env vars
    const model = env.OPENAI_MODEL_ATS || 'gpt-4o-mini';
    const temperature = parseFloat(env.OPENAI_TEMPERATURE_SCORING || '0.2');
    const maxTokens = parseInt(env.OPENAI_MAX_TOKENS_ATS || '800', 10);

    // Test prompt for ATS scoring
    const testPrompt = `You are JobHackAI's ATS Scoring Engine in test mode.

Evaluate the following résumé text for ATS compliance using your standard rubric:
- Keyword Relevance (40 pts)
- Formatting Compliance (20 pts)
- Structure & Section Completeness (15 pts)
- Tone & Clarity (15 pts)
- Grammar & Spelling (10 pts)

Example résumé text:
"John Doe, Software Engineer with 8 years of experience in Python, AWS, and React. Built scalable microservices and led agile teams to deliver high-impact analytics platforms."

Return a short JSON object with this structure:
{
  "score": <integer 0-100>,
  "section_breakdown": {
    "Keyword Relevance": <integer 0-40>,
    "Formatting": <integer 0-20>,
    "Structure": <integer 0-15>,
    "Tone": <integer 0-15>,
    "Grammar": <integer 0-10>
  },
  "test_status": "success"
}`;

    // Call OpenAI using our client utility
    const response = await callOpenAI({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that returns JSON responses for ATS resume scoring.'
        },
        {
          role: 'user',
          content: testPrompt
        }
      ],
      maxTokens,
      temperature,
      feature: 'openai_test',
      userId: 'test-user'
    }, env);

    // Log success
    console.log('[TEST-OPENAI] ✅ Success', {
      model,
      temperature,
      maxTokens,
      usage: response.usage
    });

    // Parse JSON response if possible
    let parsedOutput = null;
    try {
      parsedOutput = JSON.parse(response.content);
    } catch (parseError) {
      // If not JSON, return raw content
      parsedOutput = { raw_output: response.content };
    }

    return json({
      success: true,
      message: 'OpenAI integration test successful',
      config: {
        model,
        temperature,
        maxTokens,
        apiKeyConfigured: !!env.OPENAI_API_KEY
      },
      response: parsedOutput,
      usage: response.usage,
      model: response.model,
      finishReason: response.finishReason
    }, 200, origin, env);

  } catch (error) {
    console.error('[TEST-OPENAI] ❌ Failure', error);
    
    // Provide helpful error messages
    let errorMessage = error.message || 'Unknown error';
    let errorCode = 500;
    
    if (errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('Invalid API key')) {
      errorCode = 401;
      errorMessage = 'OpenAI API key is invalid or not configured correctly. Check OPENAI_API_KEY in Cloudflare Pages secrets.';
    } else if (errorMessage.includes('429') || errorMessage.includes('Rate limit')) {
      errorCode = 429;
      errorMessage = 'OpenAI rate limit exceeded. Please try again later.';
    } else if (errorMessage.includes('not configured')) {
      errorCode = 500;
      errorMessage = 'OpenAI API key not found in environment variables.';
    }

    return json({
      success: false,
      error: 'OpenAI test failed',
      message: errorMessage,
      details: error.message,
      stack: error.stack
    }, errorCode, origin, env);
  }
}

