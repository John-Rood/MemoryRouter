import Link from "next/link";
import { ArrowLeft, Shield, Lock, Eye, Trash2, Globe, Mail } from "lucide-react";

export const metadata = {
  title: "Privacy Policy - MemoryRouter",
  description: "How MemoryRouter handles and protects your data",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Background effects */}
      <div className="fixed inset-0 grid-bg opacity-50 pointer-events-none" />
      <div className="fixed inset-0 ambient-glow pointer-events-none" />
      
      <div className="relative max-w-4xl mx-auto px-6 py-12">
        {/* Back link */}
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
        
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-gradient-neon">
              <Shield className="h-6 w-6 text-black" />
            </div>
            <h1 className="text-4xl font-bold">Privacy Policy</h1>
          </div>
          <p className="text-muted-foreground">
            Last updated: February 2, 2026
          </p>
        </div>
        
        {/* Content */}
        <div className="space-y-8">
          {/* Introduction */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Eye className="h-5 w-5 text-neon-green" />
              Introduction
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              MemoryRouter (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is an AI memory service that helps developers give their AI applications persistent memory. 
              We are committed to protecting your privacy and being transparent about how we handle your data. 
              This policy explains what information we collect, how we use it, and your rights regarding your data.
            </p>
          </section>
          
          {/* Core Commitments - Highlighted */}
          <section className="rounded-2xl p-8 bg-gradient-to-br from-neon-green/10 to-electric-blue/5 border border-neon-green/20">
            <h2 className="text-2xl font-semibold mb-6 text-neon-green">Our Core Privacy Commitments</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-neon-green/20 mt-0.5">
                  <Lock className="h-4 w-4 text-neon-green" />
                </div>
                <div>
                  <h3 className="font-semibold">We Never Sell Your Data</h3>
                  <p className="text-sm text-muted-foreground">
                    Your data is never sold, rented, or traded to third parties. Period.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-neon-green/20 mt-0.5">
                  <Globe className="h-4 w-4 text-neon-green" />
                </div>
                <div>
                  <h3 className="font-semibold">No Voluntary Government Sharing</h3>
                  <p className="text-sm text-muted-foreground">
                    We do not voluntarily share data with governments. We only comply when legally compelled.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-neon-green/20 mt-0.5">
                  <Shield className="h-4 w-4 text-neon-green" />
                </div>
                <div>
                  <h3 className="font-semibold">Encrypted & Secure</h3>
                  <p className="text-sm text-muted-foreground">
                    All data is encrypted in transit and at rest using industry-standard encryption.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-neon-green/20 mt-0.5">
                  <Trash2 className="h-4 w-4 text-neon-green" />
                </div>
                <div>
                  <h3 className="font-semibold">You Control Your Data</h3>
                  <p className="text-sm text-muted-foreground">
                    Access, export, or delete your data at any time from your dashboard.
                  </p>
                </div>
              </div>
            </div>
          </section>
          
          {/* What We Collect */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">What Data We Collect</h2>
            <div className="space-y-4 text-muted-foreground">
              <div>
                <h3 className="text-foreground font-medium mb-2">Account Information</h3>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Email address (from OAuth provider)</li>
                  <li>Name (from OAuth provider)</li>
                  <li>Profile picture (from OAuth provider)</li>
                </ul>
              </div>
              <div>
                <h3 className="text-foreground font-medium mb-2">Memory Data</h3>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Conversation context and memory content you store through our API</li>
                  <li>Memory encodings generated from your stored content</li>
                  <li>Metadata including timestamps and session identifiers</li>
                </ul>
              </div>
              <div>
                <h3 className="text-foreground font-medium mb-2">API Keys</h3>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>MemoryRouter API keys (generated by us)</li>
                  <li>Third-party AI provider API keys you provide (BYOK - Bring Your Own Key)</li>
                </ul>
              </div>
              <div>
                <h3 className="text-foreground font-medium mb-2">Usage & Billing Data</h3>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Token usage and API call metrics</li>
                  <li>Billing information processed through Stripe</li>
                  <li>Transaction history</li>
                </ul>
              </div>
            </div>
          </section>
          
          {/* How We Use Data */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">How We Use Your Data</h2>
            <p className="text-muted-foreground mb-4">
              We use your data <span className="text-foreground font-medium">solely to provide and improve our service</span>:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
              <li>To store and retrieve your AI memory data via our API</li>
              <li>To authenticate your identity and secure your account</li>
              <li>To process payments and maintain billing records</li>
              <li>To monitor usage for billing purposes</li>
              <li>To detect and prevent abuse or unauthorized access</li>
              <li>To improve service performance and reliability</li>
              <li>To communicate service updates and important notices</li>
            </ul>
          </section>
          
          {/* Data Security */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Data Security</h2>
            <p className="text-muted-foreground mb-4">
              We implement robust security measures to protect your data:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
              <li><span className="text-foreground">Encryption in transit:</span> All data is transmitted over TLS 1.3</li>
              <li><span className="text-foreground">Encryption at rest:</span> Data is encrypted using AES-256 encryption</li>
              <li><span className="text-foreground">Secure infrastructure:</span> Hosted on Cloudflare&apos;s global edge network</li>
              <li><span className="text-foreground">Access controls:</span> Strict internal access policies with audit logging</li>
              <li><span className="text-foreground">API key security:</span> Provider API keys are encrypted and never logged</li>
            </ul>
          </section>
          
          {/* No Data Sales */}
          <section className="glass-card rounded-2xl p-8 border-neon-green/30">
            <h2 className="text-2xl font-semibold mb-4 text-neon-green">We Do NOT Sell Your Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              <span className="text-foreground font-semibold">We will never sell, rent, lease, or trade your personal information or memory data to third parties.</span>
              {" "}This includes advertisers, data brokers, and marketing companies. Your data exists solely to power your AI applications, not to be monetized by us through third-party sales.
            </p>
          </section>
          
          {/* Government Requests */}
          <section className="glass-card rounded-2xl p-8 border-electric-blue/30">
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--electric-blue)' }}>Government & Legal Requests</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              <span className="text-foreground font-semibold">We do not voluntarily share your data with any government or law enforcement agency.</span>
              {" "}We will only disclose information when we are legally compelled to do so, such as:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
              <li>Valid court orders or subpoenas</li>
              <li>Legally binding government requests with proper jurisdiction</li>
              <li>When required to protect against imminent harm</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              When possible and legally permitted, we will notify affected users before disclosing their data to authorities.
            </p>
          </section>
          
          {/* Third-Party Services */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Third-Party Services</h2>
            <p className="text-muted-foreground mb-4">
              We use limited third-party services to operate MemoryRouter:
            </p>
            <div className="space-y-3 text-muted-foreground">
              <div>
                <span className="text-foreground font-medium">Stripe:</span> Payment processing. Stripe handles all payment data under their own privacy policy.
              </div>
              <div>
                <span className="text-foreground font-medium">Cloudflare:</span> Infrastructure and security. Data processing governed by Cloudflare&apos;s privacy policy.
              </div>
              <div>
                <span className="text-foreground font-medium">OAuth Providers (Google, GitHub):</span> Authentication only. We receive basic profile information you authorize.
              </div>
              <div>
                <span className="text-foreground font-medium">AI Providers (when using BYOK):</span> Your prompts and responses are sent to your chosen AI provider using your own API keys.
              </div>
            </div>
          </section>
          
          {/* Cookies */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Cookies & Analytics</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use only essential cookies required for authentication and session management. 
              We do not use third-party tracking cookies or sell your browsing data to advertisers.
              We may collect anonymized, aggregated analytics to improve our service, but this data cannot identify individual users.
            </p>
          </section>
          
          {/* Data Retention */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Data Retention & Deletion</h2>
            <p className="text-muted-foreground mb-4">
              You control your data retention:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
              <li>Memory data is retained until you delete it or close your account</li>
              <li>You can delete individual memories or entire keys via the API or dashboard</li>
              <li>Account deletion removes all associated data within 30 days</li>
              <li>Billing records may be retained as required by law for tax purposes</li>
              <li>Backups are automatically purged within 90 days of deletion</li>
            </ul>
          </section>
          
          {/* Your Rights */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Your Rights</h2>
            <p className="text-muted-foreground mb-4">
              You have the following rights regarding your data:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
              <li><span className="text-foreground font-medium">Access:</span> View all data we store about you</li>
              <li><span className="text-foreground font-medium">Export:</span> Download your data in a portable format</li>
              <li><span className="text-foreground font-medium">Deletion:</span> Request deletion of your account and data</li>
              <li><span className="text-foreground font-medium">Correction:</span> Update or correct your account information</li>
              <li><span className="text-foreground font-medium">Portability:</span> Receive your data in a machine-readable format</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              Exercise these rights from your dashboard settings or by contacting us.
            </p>
          </section>
          
          {/* Policy Changes */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">Policy Updates</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this privacy policy from time to time. We will notify you of significant changes via email or through the dashboard.
              Continued use of MemoryRouter after changes constitutes acceptance of the updated policy.
              We encourage you to review this policy periodically.
            </p>
          </section>
          
          {/* Contact */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Mail className="h-5 w-5 text-neon-green" />
              Contact Us
            </h2>
            <p className="text-muted-foreground mb-4">
              If you have questions about this privacy policy or how we handle your data:
            </p>
            <div className="space-y-2 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">Email:</span>{" "}
                <a href="mailto:privacy@memoryrouter.ai" className="text-neon-green hover:underline">
                  privacy@memoryrouter.ai
                </a>
              </p>
              <p>
                <span className="text-foreground font-medium">Website:</span>{" "}
                <a href="https://memoryrouter.ai" className="text-neon-green hover:underline">
                  memoryrouter.ai
                </a>
              </p>
            </div>
          </section>
        </div>
        
        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-border/10 text-center text-sm text-muted-foreground">
          <p>
            <Link href="/terms" className="hover:text-foreground underline">Terms of Service</Link>
            {" · "}
            <Link href="/" className="hover:text-foreground">Back to Home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
