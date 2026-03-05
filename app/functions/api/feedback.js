/**
 * POST /api/feedback
 * Accepts { message, page } and emails it to feedback@jobhackai.io via Resend.
 */
import { sendEmail } from '../_lib/email.js';
import { handleFeedbackRequest } from '../_lib/feedback-handler.js';

export async function onRequest(context) {
  try {
    return await handleFeedbackRequest(context, sendEmail);
  } catch (err) {
    console.error('[FEEDBACK] Unhandled error in feedback handler:', err);
    const origin = context.request.headers.get('Origin') || '';
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || 'https://app.jobhackai.io',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      }
    );
  }
}
