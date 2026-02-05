// Shared error handler utility
// Provides consistent error response format and logging

/**
 * Generate a standardized error response
 * @param {string} error - Error message or Error object
 * @param {number} statusCode - HTTP status code
 * @param {string} origin - Request origin for CORS
 * @param {Object} env - Cloudflare environment
 * @param {string} requestId - Optional request ID for tracing
 * @param {Object} additionalData - Additional error context
 * @returns {Response} Standardized error response
 */
export function errorResponse(error, statusCode, origin, env, requestId = null, additionalData = {}) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  // Log error with context
  const logContext = {
    requestId,
    statusCode,
    error: errorMessage,
    ...additionalData,
    timestamp: new Date().toISOString()
  };
  
  if (statusCode >= 500) {
    console.error('[ERROR-HANDLER] Server error:', logContext);
    if (errorStack) {
      console.error('[ERROR-HANDLER] Stack trace:', errorStack);
    }
  } else {
    console.warn('[ERROR-HANDLER] Client error:', logContext);
  }
  
  // Build response data
  const responseData = {
    success: false,
    error: errorMessage,
    ...(requestId && { requestId }),
    // Expose select additional fields for clients (e.g., upgradeRequired, needsFeedback)
    ...(['upgradeRequired', 'needsFeedback', 'retryable'].reduce((acc, key) => {
      if (Object.prototype.hasOwnProperty.call(additionalData, key)) {
        acc[key] = additionalData[key];
      }
      return acc;
    }, {})),
    ...(env.ENVIRONMENT === 'dev' && { stack: errorStack, context: additionalData })
  };
  
  // CORS headers
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return new Response(JSON.stringify(responseData), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    }
  });
}

/**
 * Generate a success response with consistent format
 * @param {Object} data - Response data
 * @param {number} statusCode - HTTP status code (default 200)
 * @param {string} origin - Request origin for CORS
 * @param {Object} env - Cloudflare environment
 * @param {string} requestId - Optional request ID for tracing
 * @returns {Response} Standardized success response
 */
export function successResponse(data, statusCode = 200, origin, env, requestId = null) {
  const responseData = {
    success: true,
    ...data,
    ...(requestId && { requestId })
  };
  
  // CORS headers
  const allowedOrigins = [
    'https://dev.jobhackai.io',
    'https://qa.jobhackai.io',
    'https://app.jobhackai.io',
    'http://localhost:3003',
    'http://localhost:8788'
  ];
  
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return new Response(JSON.stringify(responseData), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    }
  });
}

/**
 * Generate a request ID for tracing
 * @returns {string} Unique request ID
 */
export function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

