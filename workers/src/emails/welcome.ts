/**
 * Welcome Email Template
 * Sent to new users after first OAuth sign-in
 */

export function welcomeEmailTemplate(name: string): string {
  const firstName = name?.split(' ')[0] || 'there';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to MemoryRouter</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; line-height: 1.6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center;">
              <img src="https://memoryrouter.ai/logo.png" alt="MemoryRouter" width="64" height="64" style="display: block; margin: 0 auto 16px; border-radius: 12px;" />
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #1e293b;">
                Welcome to MemoryRouter
              </h1>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="margin: 0 0 20px; color: #475569; font-size: 16px;">
                Hey ${firstName}! 👋
              </p>
              
              <p style="margin: 0 0 20px; color: #475569; font-size: 16px;">
                You've just unlocked <strong>persistent memory for your AI apps</strong>. MemoryRouter sits between your app and any LLM provider (OpenAI, Anthropic, etc.) — giving your AI the ability to remember context across conversations.
              </p>
              
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 24px; margin: 24px 0;">
                <p style="margin: 0 0 8px; color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 500;">
                  🎁 YOUR FREE TIER
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">
                  50M tokens included
                </p>
                <p style="margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
                  That's roughly 37,500 conversations — plenty to get started.
                </p>
              </div>
              
              <h2 style="margin: 28px 0 16px; font-size: 18px; font-weight: 600; color: #1e293b;">
                Quick Start (2 minutes)
              </h2>
              
              <ol style="margin: 0 0 24px; padding-left: 20px; color: #475569;">
                <li style="margin-bottom: 12px;">
                  <strong>Add your API key</strong> — Connect your OpenAI, Anthropic, or other provider
                </li>
                <li style="margin-bottom: 12px;">
                  <strong>Get your MemoryRouter key</strong> — One key, unlimited memory
                </li>
                <li style="margin-bottom: 12px;">
                  <strong>Swap your base URL</strong> — <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 14px;">api.memoryrouter.ai/v1</code>
                </li>
              </ol>
              
              <a href="https://app.memoryrouter.ai/dashboard" style="display: inline-block; background: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Open Dashboard →
              </a>
            </td>
          </tr>
          
          <!-- Code Example -->
          <tr>
            <td style="padding: 20px 40px;">
              <div style="background: #1e293b; border-radius: 8px; padding: 20px; overflow-x: auto;">
                <pre style="margin: 0; color: #e2e8f0; font-family: 'SF Mono', Monaco, 'Courier New', monospace; font-size: 13px; line-height: 1.5;"><span style="color: #94a3b8;">// Just change the base URL</span>
<span style="color: #f472b6;">const</span> client = <span style="color: #f472b6;">new</span> OpenAI({
  baseURL: <span style="color: #a5d6ff;">'https://api.memoryrouter.ai/v1'</span>,
  apiKey: <span style="color: #a5d6ff;">'mk_your_memoryrouter_key'</span>
});</pre>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px 40px; border-top: 1px solid #e2e8f0; margin-top: 20px;">
              <p style="margin: 0 0 8px; color: #64748b; font-size: 14px;">
                Questions? Just reply to this email.
              </p>
              <p style="margin: 0; color: #94a3b8; font-size: 13px;">
                — The MemoryRouter Team
              </p>
            </td>
          </tr>
          
        </table>
        
        <!-- Unsubscribe -->
        <p style="text-align: center; margin: 24px 0 0; color: #94a3b8; font-size: 12px;">
          MemoryRouter · AI Memory Infrastructure
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Plain text version for email clients that don't render HTML
 */
export function welcomeEmailText(name: string): string {
  const firstName = name?.split(' ')[0] || 'there';
  
  return `
Hey ${firstName}! 👋

Welcome to MemoryRouter — you've just unlocked persistent memory for your AI apps.

MemoryRouter sits between your app and any LLM provider (OpenAI, Anthropic, etc.), giving your AI the ability to remember context across conversations.

🎁 YOUR FREE TIER: 50M tokens included
That's roughly 37,500 conversations — plenty to get started.

QUICK START (2 minutes):
1. Add your API key — Connect your OpenAI, Anthropic, or other provider
2. Get your MemoryRouter key — One key, unlimited memory  
3. Swap your base URL — api.memoryrouter.ai/v1

Open your dashboard: https://app.memoryrouter.ai/dashboard

Example:
  const client = new OpenAI({
    baseURL: 'https://api.memoryrouter.ai/v1',
    apiKey: 'mk_your_memoryrouter_key'
  });

Questions? Just reply to this email.

— The MemoryRouter Team
  `.trim();
}
