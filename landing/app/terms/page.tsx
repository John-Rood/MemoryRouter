import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service — MemoryRouter',
  description: 'Terms and conditions for using MemoryRouter',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      {/* Header */}
      <header className="border-b border-white/5 py-4 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold hover:text-green-400 transition">
            ← MemoryRouter
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold">Terms of Service</h1>
          <p className="text-gray-400 mt-2">Last updated: February 2, 2026</p>
        </div>

        <div className="space-y-8">
          <Section title="1. Agreement to Terms">
            <p>By accessing or using MemoryRouter (&quot;Service&quot;), you agree to be bound by these Terms of Service. If you disagree with any part, you may not access the Service. These terms apply to all users, including developers, businesses, and API consumers.</p>
          </Section>

          <Section title="2. Description of Service">
            <p className="mb-4">MemoryRouter is an AI memory service that provides:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Persistent memory storage and retrieval for AI applications</li>
              <li>API proxy with automatic memory injection</li>
              <li>Compatible with OpenAI, Anthropic, and other AI providers</li>
              <li>Memory key management for isolated contexts</li>
            </ul>
          </Section>

          <Section title="3. Account Terms">
            <ul className="list-disc pl-6 space-y-2">
              <li>You must provide accurate information when creating an account</li>
              <li>You are responsible for maintaining the security of your API keys</li>
              <li>You must be 18 years or older to use this Service</li>
              <li>One person or entity may not maintain more than one free account</li>
            </ul>
          </Section>

          <Section title="4. Acceptable Use">
            <p className="mb-4">You agree NOT to use the Service to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Store or transmit illegal content</li>
              <li>Violate any applicable laws or regulations</li>
              <li>Attempt to gain unauthorized access to the Service</li>
              <li>Interfere with or disrupt the Service infrastructure</li>
              <li>Store personally identifiable information without proper consent</li>
              <li>Use the Service for any purpose that violates AI provider terms</li>
            </ul>
          </Section>

          <Section title="5. API Usage & Rate Limits">
            <p>We reserve the right to impose rate limits and usage quotas. Abuse of the API may result in temporary or permanent suspension. Current rate limits are published in our documentation and may be updated.</p>
          </Section>

          <Section title="6. Billing & Payments">
            <ul className="list-disc pl-6 space-y-2">
              <li>Free tier: 50M memory tokens included</li>
              <li>Paid usage: $0.20 per 1M memory tokens</li>
              <li>You bring your own API keys — we never charge for inference</li>
              <li>Auto-reup can be configured to maintain your balance</li>
              <li>Refunds are handled on a case-by-case basis</li>
            </ul>
          </Section>

          <Section title="7. Your Data">
            <p>You retain all rights to data you store through the Service. We do not use your stored memories to train models or share with third parties. You can delete your data at any time through the API or dashboard.</p>
          </Section>

          <Section title="8. Service Availability">
            <p>We strive for high availability but do not guarantee 100% uptime. We are not liable for any downtime, data loss, or service interruptions. We will make reasonable efforts to notify users of planned maintenance.</p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p>THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND. IN NO EVENT SHALL MEMORYROUTER BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE SERVICE.</p>
          </Section>

          <Section title="10. Changes to Terms">
            <p>We may update these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms. We will notify users of significant changes via email or dashboard notification.</p>
          </Section>

          <Section title="11. Contact">
            <p>Questions about these terms? Contact us at <a href="mailto:support@memoryrouter.ai" className="text-green-400 hover:text-green-300 underline">support@memoryrouter.ai</a></p>
          </Section>
        </div>
      </div>
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
