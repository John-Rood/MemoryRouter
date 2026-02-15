import type { Metadata } from 'next'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Privacy Policy — MemoryRouter',
  description: 'Privacy policy for MemoryRouter',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <Header />

      <div className="max-w-4xl mx-auto px-6 pt-32 pb-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold">Privacy Policy</h1>
          <p className="text-gray-400 mt-2">Last updated: February 2, 2026</p>
        </div>

        <div className="space-y-8">
          <Section title="1. Information We Collect">
            <h3 className="text-white font-semibold mb-2">Account Information</h3>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>Email address (via Google OAuth)</li>
              <li>Name (as provided by Google)</li>
              <li>Google account identifier</li>
            </ul>
            <h3 className="text-white font-semibold mb-2">Usage Data</h3>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>API request metadata (timestamps, token counts, model used)</li>
              <li>Memory storage metrics</li>
              <li>Billing and payment information (processed by Stripe)</li>
            </ul>
            <h3 className="text-white font-semibold mb-2">Memory Data</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Content you store through the MemoryRouter API</li>
              <li>Embeddings generated from your content</li>
              <li>Memory metadata (creation time, access patterns)</li>
            </ul>
          </Section>

          <Section title="2. How We Use Your Information">
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Provide the Service:</strong> Store, retrieve, and inject memories into your AI requests</li>
              <li><strong className="text-white">Billing:</strong> Track usage and process payments</li>
              <li><strong className="text-white">Improve the Service:</strong> Analyze aggregate usage patterns (never individual content)</li>
              <li><strong className="text-white">Security:</strong> Detect and prevent abuse, fraud, and unauthorized access</li>
              <li><strong className="text-white">Communication:</strong> Send important service updates and billing notifications</li>
            </ul>
          </Section>

          <Section title="3. What We Do NOT Do">
            <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-6">
              <ul className="space-y-3">
                <li className="flex items-start gap-2"><span className="text-green-400">✓</span> We do NOT use your stored memories to train AI models</li>
                <li className="flex items-start gap-2"><span className="text-green-400">✓</span> We do NOT sell your data to third parties</li>
                <li className="flex items-start gap-2"><span className="text-green-400">✓</span> We do NOT read or access your memory content except for debugging with your permission</li>
                <li className="flex items-start gap-2"><span className="text-green-400">✓</span> We do NOT share your API keys with anyone</li>
                <li className="flex items-start gap-2"><span className="text-green-400">✓</span> We do NOT log the content of your AI requests or responses</li>
              </ul>
            </div>
          </Section>

          <Section title="4. Data Storage & Security">
            <ul className="list-disc pl-6 space-y-2">
              <li>Memory data is stored on Cloudflare&apos;s global infrastructure</li>
              <li>All data is encrypted in transit (TLS 1.3) and at rest</li>
              <li>Memory contexts are isolated per API key — no cross-contamination</li>
              <li>API keys are hashed and never stored in plaintext</li>
              <li>We use Cloudflare Workers for edge computing with no cold starts</li>
            </ul>
          </Section>

          <Section title="5. Third-Party Services">
            <p className="mb-4">We use the following third-party services:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Cloudflare:</strong> Infrastructure, CDN, and Workers runtime</li>
              <li><strong className="text-white">Stripe:</strong> Payment processing (we never see your full card number)</li>
              <li><strong className="text-white">Google OAuth:</strong> Authentication</li>
              <li><strong className="text-white">Vercel:</strong> Dashboard hosting</li>
            </ul>
            <p className="mt-4">Your AI API keys are sent directly to providers (OpenAI, Anthropic, etc.) — we proxy requests but do not store your keys beyond your encrypted configuration.</p>
          </Section>

          <Section title="6. Data Retention">
            <ul className="list-disc pl-6 space-y-2">
              <li>Active memories: Retained as long as your account is active</li>
              <li>Deleted memories: Permanently removed within 30 days</li>
              <li>Account deletion: All data removed within 30 days of request</li>
              <li>Usage logs: Retained for 90 days for billing and debugging</li>
              <li>Billing records: Retained as required by law</li>
            </ul>
          </Section>

          <Section title="7. Your Rights">
            <p className="mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-white">Access:</strong> View all data we store about you via the dashboard</li>
              <li><strong className="text-white">Delete:</strong> Remove any or all memories via the API or dashboard</li>
              <li><strong className="text-white">Export:</strong> Download your data in standard formats</li>
              <li><strong className="text-white">Correct:</strong> Update your account information</li>
              <li><strong className="text-white">Object:</strong> Opt out of non-essential data processing</li>
            </ul>
          </Section>

          <Section title="8. Government & Law Enforcement">
            <p>We will NOT voluntarily share your data with any government agency. We will only comply with valid legal process (subpoenas, court orders) after legal review. We will notify you of any requests for your data unless legally prohibited from doing so.</p>
          </Section>

          <Section title="9. Children&apos;s Privacy">
            <p>MemoryRouter is not intended for users under 18. We do not knowingly collect data from children. If you believe a child has provided us with personal information, please contact us immediately.</p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>We may update this policy periodically. We will notify users of significant changes via email or dashboard notification. Continued use after changes constitutes acceptance.</p>
          </Section>

          <Section title="11. Contact Us">
            <p>For privacy concerns or data requests: <a href="mailto:privacy@memoryrouter.ai" className="text-green-400 hover:text-green-300 underline">privacy@memoryrouter.ai</a></p>
          </Section>
        </div>
      </div>

      <Footer />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white/[0.02] border border-white/5 backdrop-blur-sm rounded-2xl p-8">
      <h2 className="text-2xl font-semibold mb-4">{title}</h2>
      <div className="text-gray-400 leading-relaxed">{children}</div>
    </section>
  )
}
