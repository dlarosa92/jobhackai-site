/**
 * POST /api/feedback
 * Accepts { message, page } and emails it to feedback@jobhackai.io via Resend.
 */
import { sendEmail } from '../_lib/email.js';
import { handleFeedbackRequest } from '../_lib/feedback-handler.js';

export async function onRequest(context) {
  return await handleFeedbackRequest(context, sendEmail);
}
