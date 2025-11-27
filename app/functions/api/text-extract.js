// Text extraction endpoint with OCR fallback
// Handles PDF/DOCX/TXT extraction and OCR for scanned documents

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

    // Extract text with OCR fallback
    let extractionResult;
    try {
      const arrayBuffer = await file.arrayBuffer();
      extractionResult = await extractResumeText(arrayBuffer, fileName);
    } catch (extractError) {
      // Return appropriate HTTP status code for extraction failures
      // 400 for client errors (unsupported format, file too large, etc.)
      // 500 for server errors (extraction processing failures)
      const isClientError = extractError.message?.includes('Unsupported') || 
                           extractError.message?.includes('exceeds') ||
                           extractError.message?.includes('limit') ||
                           extractError.message?.includes('Unreadable');
      const statusCode = isClientError ? 400 : 500;
      
      return json({ 
        success: false,
        message: extractError.message || 'Resume text could not be extracted. Please upload a text-based PDF or DOCX file.',
        error: 'extraction_failed',
        warnings: extractError.message?.includes('OCR') ? ['OCR processing may take up to 20 seconds'] : []
      }, statusCode, origin, env);
    }

    // Return clean JSON response
    return json({
      success: true,
      text: extractionResult.text,
      readable: extractionResult.text.length > 100,
      wordCount: extractionResult.wordCount,
      fileType: extractionResult.fileType,
      isMultiColumn: extractionResult.isMultiColumn,
      ocrUsed: extractionResult.ocrUsed,
      warnings: extractionResult.ocrUsed ? ['This document was processed using OCR. Please verify accuracy.'] : []
    }, 200, origin, env);

  } catch (error) {
    console.error('[TEXT-EXTRACT] Error:', error);
    return json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    }, 500, origin, env);
  }
}

