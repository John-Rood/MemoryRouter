/**
 * Newsletter Signup API
 * Adds subscribers to Resend audience for drip email sequence
 */

import { NextRequest, NextResponse } from 'next/server';

const RESEND_API_URL = 'https://api.resend.com';
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID || 'memoryrouter-newsletter';

interface ResendContactPayload {
  email: string;
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, firstName } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('[Newsletter] RESEND_API_KEY not configured');
      return NextResponse.json(
        { error: 'Newsletter service not configured' },
        { status: 500 }
      );
    }

    // Add contact to Resend audience
    const contactPayload: ResendContactPayload = {
      email,
      first_name: firstName || undefined,
      unsubscribed: false,
    };

    // Try to add to audience first
    const audienceResponse = await fetch(
      `${RESEND_API_URL}/audiences/${AUDIENCE_ID}/contacts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(contactPayload),
      }
    );

    // If audience doesn't exist, just add as a contact
    if (!audienceResponse.ok && audienceResponse.status === 404) {
      // Fallback: create a contact directly
      const contactResponse = await fetch(`${RESEND_API_URL}/contacts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...contactPayload,
          audience_id: AUDIENCE_ID,
        }),
      });

      if (!contactResponse.ok) {
        const errorData = await contactResponse.json().catch(() => ({}));
        console.error('[Newsletter] Failed to create contact:', errorData);
        // Still return success to user - don't expose internal errors
      }
    } else if (!audienceResponse.ok) {
      const errorData = await audienceResponse.json().catch(() => ({}));
      console.error('[Newsletter] Resend API error:', errorData);
      // Still return success - better UX to not show errors for newsletter
    }

    // Send immediate welcome/confirmation email
    await fetch(`${RESEND_API_URL}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'MemoryRouter <hello@memoryrouter.ai>',
        to: email,
        subject: "You're on the list 🚀",
        html: getNewsletterWelcomeHtml(firstName),
        text: getNewsletterWelcomeText(firstName),
        reply_to: 'john@johnrood.com',
        tags: [
          { name: 'type', value: 'newsletter-welcome' },
          { name: 'category', value: 'newsletter' },
        ],
      }),
    });

    console.log(`[Newsletter] Subscribed: ${email}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Newsletter] Error:', error);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}

function getNewsletterWelcomeHtml(firstName?: string): string {
  const name = firstName || 'there';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #09090b; color: #ffffff;">
  <table style="max-width: 560px; margin: 0 auto; background: #18181b; border-radius: 12px; border: 1px solid #27272a;">
    <tr>
      <td style="padding: 40px; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 20px;">🧠</div>
        <h1 style="margin: 0 0 16px; font-size: 24px; color: #ffffff;">You're in.</h1>
        <p style="margin: 0 0 24px; color: #a1a1aa; font-size: 16px; line-height: 1.6;">
          Hey ${name} — thanks for joining the MemoryRouter newsletter.
        </p>
        <p style="margin: 0 0 24px; color: #a1a1aa; font-size: 16px; line-height: 1.6;">
          Over the next few weeks, I'll share why AI memory is the most underrated problem in the industry — and how we're fixing it.
        </p>
        <div style="background: linear-gradient(135deg, #22c55e 0%, #06b6d4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 20px; font-weight: 700; margin: 24px 0;">
          $1 on memory → $10 saved on inference
        </div>
        <p style="margin: 24px 0 0; color: #71717a; font-size: 14px;">
          — John<br>
          <span style="color: #52525b;">Founder, MemoryRouter</span>
        </p>
      </td>
    </tr>
  </table>
  <p style="text-align: center; margin: 24px 0 0; color: #52525b; font-size: 12px;">
    MemoryRouter · AI Memory Infrastructure
  </p>
</body>
</html>
  `.trim();
}

function getNewsletterWelcomeText(firstName?: string): string {
  const name = firstName || 'there';
  return `
Hey ${name} — thanks for joining the MemoryRouter newsletter.

Over the next few weeks, I'll share why AI memory is the most underrated problem in the industry — and how we're fixing it.

$1 on memory → $10 saved on inference

— John
Founder, MemoryRouter
  `.trim();
}
