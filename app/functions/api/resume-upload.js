// Resume upload endpoint
// Handles file upload, text extraction, and storage

import { getBearer, verifyFirebaseIdToken } from '../_lib/firebase-auth.js';
import { extractResumeText } from '../_lib/resume-extractor.js';

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

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return json({ success: false, error: 'No file provided' }, 400, origin, env);
    }

    // Validate file
    const fileName = file.name || 'resume';
    const fileSize = file.size;

    if (fileSize > 2 * 1024 * 1024) {
      return json({ 
        success: false, 
        error: 'File exceeds 2MB limit. Please compress or use a smaller file.' 
      }, 400, origin, env);
    }

    // Extract text
    let extractionResult;
    try {
      const arrayBuffer = await file.arrayBuffer();
      extractionResult = await extractResumeText(arrayBuffer, fileName);
    } catch (extractError) {
      // Return HTTP 200 with success: false for extraction failures (graceful error)
      // This allows frontend to handle errors without treating them as HTTP errors
      return json({ 
        success: false,
        message: extractError.message || 'Resume text could not be extracted. Please upload a text-based PDF or DOCX file.',
        resumeText: null,
        error: 'extraction_failed'
      }, 200, origin, env);
    }

    // Store resume in KV
    const timestamp = Date.now();
    const resumeId = `${uid}:${timestamp}`;
    const resumeKey = `resume:${resumeId}`;
    
    const resumeData = {
      uid,
      resumeId,
      text: extractionResult.text,
      fileName,
      fileSize,
      wordCount: extractionResult.wordCount,
      fileType: extractionResult.fileType,
      isMultiColumn: extractionResult.isMultiColumn,
      ocrUsed: extractionResult.ocrUsed,
      uploadedAt: timestamp,
      textPreview: extractionResult.text.length > 200 
        ? extractionResult.text.substring(0, 200) + '...'
        : extractionResult.text
    };

    // Store in KV (no expiration for now - can be cleaned up later)
    if (env.JOBHACKAI_KV) {
      await env.JOBHACKAI_KV.put(resumeKey, JSON.stringify(resumeData));
    }

    // Return success
    // Note: resumeText is NOT returned to avoid exposing PII to XSS attacks
    // The resume text is securely stored in KV and can be fetched using resumeId when needed
    return json({
      success: true,
      resumeId,
      textPreview: resumeData.textPreview,
      wordCount: extractionResult.wordCount,
      fileType: extractionResult.fileType,
      isMultiColumn: extractionResult.isMultiColumn,
      ocrUsed: extractionResult.ocrUsed
    }, 200, origin, env);

  } catch (error) {
    console.error('[RESUME-UPLOAD] Error:', error);
    return json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    }, 500, origin, env);
  }
}

