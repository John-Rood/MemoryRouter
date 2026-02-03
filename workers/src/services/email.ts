/**
 * Email Service
 * Uses Resend API to send transactional emails
 * 
 * Resend REST API (no npm package needed for Workers)
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */

import { welcomeEmailTemplate, welcomeEmailText } from '../emails/welcome';

interface ResendEmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  tags?: { name: string; value: string }[];
}

interface ResendResponse {
  id?: string;
  error?: { message: string; statusCode: number };
}

const RESEND_API_URL = 'https://api.resend.com/emails';
// Verified domain in Resend
const FROM_EMAIL = 'MemoryRouter <hello@memoryrouter.ai>';
const REPLY_TO = 'john@johnrood.com';

/**
 * Send email via Resend API
 * Fire-and-forget: logs errors but doesn't throw
 */
async function sendEmail(
  apiKey: string,
  payload: ResendEmailPayload
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json() as ResendResponse;

    if (!response.ok) {
      console.error('[Email] Resend API error:', data.error?.message || response.statusText);
      return { success: false, error: data.error?.message || 'Unknown error' };
    }

    console.log('[Email] Sent successfully:', data.id);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('[Email] Failed to send:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Send welcome email to new user
 * Called after first OAuth sign-in
 */
export async function sendWelcomeEmail(
  apiKey: string,
  email: string,
  name: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  console.log(`[Email] Sending welcome email to ${email}`);

  return sendEmail(apiKey, {
    from: FROM_EMAIL,
    to: email,
    subject: 'Welcome to MemoryRouter 🧠',
    html: welcomeEmailTemplate(name),
    text: welcomeEmailText(name),
    reply_to: REPLY_TO,
    tags: [
      { name: 'type', value: 'welcome' },
      { name: 'category', value: 'onboarding' },
    ],
  });
}

/**
 * Send verification email (for future use)
 * Not currently needed since OAuth provides verified emails
 */
export async function sendVerificationEmail(
  apiKey: string,
  email: string,
  name: string,
  verificationUrl: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  console.log(`[Email] Sending verification email to ${email}`);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc;">
  <table style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px;">
    <tr>
      <td style="text-align: center;">
        <div style="font-size: 40px; margin-bottom: 16px;">🧠</div>
        <h1 style="margin: 0 0 24px; font-size: 24px; color: #1e293b;">Verify your email</h1>
        <p style="margin: 0 0 24px; color: #475569;">
          Hey ${name?.split(' ')[0] || 'there'}! Click the button below to verify your email address.
        </p>
        <a href="${verificationUrl}" style="display: inline-block; background: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">
          Verify Email
        </a>
        <p style="margin: 24px 0 0; color: #94a3b8; font-size: 13px;">
          This link expires in 24 hours.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `
Hey ${name?.split(' ')[0] || 'there'}!

Click this link to verify your email address:
${verificationUrl}

This link expires in 24 hours.

— MemoryRouter
  `.trim();

  return sendEmail(apiKey, {
    from: FROM_EMAIL,
    to: email,
    subject: 'Verify your MemoryRouter email',
    html,
    text,
    tags: [
      { name: 'type', value: 'verification' },
      { name: 'category', value: 'auth' },
    ],
  });
}
