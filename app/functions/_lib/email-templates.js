/**
 * Branded email templates for JobHackAI
 * All templates share a consistent wrapper with minimal, clean design.
 */

function emailWrapper(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JobHackAI</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;">
              <span style="font-size:18px;font-weight:700;color:#1F2937;letter-spacing:0.5px;">JOBHACKAI</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">&copy; 2025 JobHackAI LLC &middot; <a href="mailto:privacy@jobhackai.io" style="color:#9ca3af;text-decoration:underline;">privacy@jobhackai.io</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function actionButton(text, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background-color:#1976D2;border-radius:6px;">
        <a href="${url}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * Welcome email sent on first account creation
 */
export function welcomeEmail(userName) {
  const name = userName || 'there';
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Welcome to JobHackAI, ${name}!</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      You now have access to AI-powered tools to level up your job search: resume scoring and feedback, interview question prep, LinkedIn profile optimization, and cover letter generation.
    </p>
    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">
      Head to your dashboard to get started.
    </p>
    ${actionButton('Get Started', 'https://app.jobhackai.io')}
  `;
  return { subject: 'Welcome to JobHackAI', html: emailWrapper(body) };
}

/**
 * Confirmation email after account deletion
 */
export function accountDeletedEmail(userEmail) {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Your account has been deleted</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      Your JobHackAI account and all associated data have been permanently removed. This includes your personal information, tool history, and any active subscription.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      If this was a mistake, you can create a new account at any time. Note that previous data cannot be recovered.
    </p>
    <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
      Questions? Contact us at <a href="mailto:privacy@jobhackai.io" style="color:#1976D2;text-decoration:underline;">privacy@jobhackai.io</a>.
    </p>
  `;
  return { subject: 'Your JobHackAI account has been deleted', html: emailWrapper(body) };
}

/**
 * Email when data export is ready for download
 */
export function dataExportReadyEmail(userName, downloadUrl) {
  const name = userName || 'there';
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Your data export is ready</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      Hi ${name}, your requested data export is ready to download. Click the button below to download your data.
    </p>
    ${actionButton('Download My Data', downloadUrl)}
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;">
      This link expires in 24 hours. If you did not request this export, please contact us immediately.
    </p>
  `;
  return { subject: 'Your data export is ready', html: emailWrapper(body) };
}

/**
 * Warning email sent 30 days before inactive account deletion
 */
export function inactivityWarningEmail(userName) {
  const name = userName || 'there';
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Your account will be deleted in 30 days</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      Hi ${name}, we noticed you haven't used JobHackAI in over 24 months. Per our data retention policy, inactive accounts are automatically deleted after this period.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      If you'd like to keep your account, simply log in within the next 30 days and your account will remain active.
    </p>
    ${actionButton('Log In to Keep My Account', 'https://app.jobhackai.io/login.html')}
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;">
      <a href="https://app.jobhackai.io/privacy.html" style="color:#9ca3af;text-decoration:underline;">View our privacy policy</a>
    </p>
  `;
  return { subject: 'Your JobHackAI account will be deleted in 30 days', html: emailWrapper(body) };
}

/**
 * Confirmation email when a subscription is cancelled
 */
export function subscriptionCancelledEmail(userName, planName, accessEndDate) {
  const name = userName || 'there';
  const formattedDate = accessEndDate
    ? new Date(accessEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'the end of your current billing period';
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1F2937;">Your subscription has been cancelled</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      Hi ${name}, your ${planName || ''} subscription has been cancelled. You'll continue to have access to your plan features until <strong>${formattedDate}</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      After that, your account will revert to the free tier. Your tool history is automatically deleted after 90 days per our data retention policy, and inactive accounts are removed after 24 months.
    </p>
    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">
      Changed your mind? You can resubscribe at any time.
    </p>
    ${actionButton('Resubscribe', 'https://app.jobhackai.io/pricing-a.html')}
  `;
  return { subject: 'Your JobHackAI subscription has been cancelled', html: emailWrapper(body) };
}
