/**
 * POST /api/feedback
 * Accepts { message, page } and emails it to feedback@jobhackai.io via Resend.
 */
import { sendEmail } from '../_lib/email.js';
import { handleFeedbackRequest } from '../_lib/feedback-handler.js';

const ALLOWED_ORIGINS = [
  'https://jobhackai.io',
  'https://www.jobhackai.io',
  'https://dev.jobhackai.io',
  'https://qa.jobhackai.io',
  'https://app.jobhackai.io',
  'http://localhost:3003',
  'http://localhost:8788'
];

export async function onRequest(context) {
  try {
    return await handleFeedbackRequest(context, sendEmail);
  } catch (err) {
    console.error('[FEEDBACK] Unhandled error in feedback handler:', err);
    const origin = context.request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[4];
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      }
    );
  }
}
