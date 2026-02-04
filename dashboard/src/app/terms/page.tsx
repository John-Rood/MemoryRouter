import Link from "next/link";
import { ArrowLeft, FileText, AlertTriangle, Scale, Zap } from "lucide-react";

export const metadata = {
  title: "Terms of Service - MemoryRouter",
  description: "Terms and conditions for using MemoryRouter",
};

export default function TermsPage() {
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
              <FileText className="h-6 w-6 text-black" />
            </div>
            <h1 className="text-4xl font-bold">Terms of Service</h1>
          </div>
          <p className="text-muted-foreground">
            Last updated: February 2, 2026
          </p>
        </div>
        
        {/* Content */}
        <div className="space-y-8">
          {/* Introduction */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">1. Agreement to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using MemoryRouter (&quot;Service&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;). 
              If you disagree with any part of these terms, you may not access the Service.
              These Terms apply to all visitors, users, and others who access or use the Service.
            </p>
          </section>
          
          {/* Service Description */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-neon-green" />
              2. Service Description
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              MemoryRouter is an AI memory service that provides:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
              <li>Persistent memory storage for AI applications</li>
              <li>API access for storing and retrieving conversation context</li>
              <li>Token tracking and usage analytics</li>
              <li>Integration with AI providers (BYOK - Bring Your Own Key)</li>
            </ul>
          </section>
          
          {/* Account Terms */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">3. Account Terms</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">3.1</span> You must provide accurate and complete information when creating an account.
              </p>
              <p>
                <span className="text-foreground font-medium">3.2</span> You are responsible for safeguarding your API keys and account credentials.
              </p>
              <p>
                <span className="text-foreground font-medium">3.3</span> You are responsible for all activities that occur under your account.
              </p>
              <p>
                <span className="text-foreground font-medium">3.4</span> You must notify us immediately of any unauthorized use of your account.
              </p>
              <p>
                <span className="text-foreground font-medium">3.5</span> You must be at least 18 years old to use this Service.
              </p>
            </div>
          </section>
          
          {/* Acceptable Use */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <Scale className="h-5 w-5 text-neon-green" />
              4. Acceptable Use
            </h2>
            <p className="text-muted-foreground mb-4">You agree NOT to use the Service to:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-2">
              <li>Violate any applicable laws or regulations</li>
              <li>Store or transmit malicious code or malware</li>
              <li>Infringe on intellectual property rights of others</li>
              <li>Store illegal content or content that promotes harm</li>
              <li>Attempt to gain unauthorized access to our systems</li>
              <li>Interfere with or disrupt the Service or servers</li>
              <li>Reverse engineer or attempt to extract source code</li>
              <li>Use the Service for competitive analysis without permission</li>
              <li>Resell or redistribute the Service without authorization</li>
            </ul>
          </section>
          
          {/* API Usage */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">5. API Usage & Rate Limits</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">5.1</span> API usage is subject to rate limits as documented. Exceeding limits may result in temporary throttling.
              </p>
              <p>
                <span className="text-foreground font-medium">5.2</span> You are responsible for all API calls made using your API keys.
              </p>
              <p>
                <span className="text-foreground font-medium">5.3</span> We reserve the right to suspend accounts that abuse the Service or create excessive load.
              </p>
            </div>
          </section>
          
          {/* Billing */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">6. Billing & Payments</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">6.1</span> Pricing is based on token usage as displayed on your dashboard and our pricing page.
              </p>
              <p>
                <span className="text-foreground font-medium">6.2</span> New accounts receive a free tier allocation. Usage beyond free tier requires payment.
              </p>
              <p>
                <span className="text-foreground font-medium">6.3</span> Payments are processed through Stripe. You agree to Stripe&apos;s terms when adding payment methods.
              </p>
              <p>
                <span className="text-foreground font-medium">6.4</span> All fees are non-refundable except as required by law or at our sole discretion.
              </p>
              <p>
                <span className="text-foreground font-medium">6.5</span> We may change pricing with 30 days notice. Continued use after notice constitutes acceptance.
              </p>
            </div>
          </section>
          
          {/* Your Data */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">7. Your Data</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">7.1</span> You retain ownership of all data you upload to MemoryRouter.
              </p>
              <p>
                <span className="text-foreground font-medium">7.2</span> You grant us a limited license to store, process, and transmit your data solely to provide the Service.
              </p>
              <p>
                <span className="text-foreground font-medium">7.3</span> You are responsible for ensuring you have the right to store any data you upload.
              </p>
              <p>
                <span className="text-foreground font-medium">7.4</span> We do not access your data except as necessary to provide support (with your permission) or as required by law.
              </p>
            </div>
          </section>
          
          {/* BYOK */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">8. Bring Your Own Key (BYOK)</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">8.1</span> When you provide third-party API keys (e.g., OpenAI, Anthropic), those keys are used to process your requests.
              </p>
              <p>
                <span className="text-foreground font-medium">8.2</span> Your use of third-party services through BYOK is subject to those providers&apos; terms and pricing.
              </p>
              <p>
                <span className="text-foreground font-medium">8.3</span> We are not responsible for charges incurred on your third-party accounts.
              </p>
              <p>
                <span className="text-foreground font-medium">8.4</span> You are responsible for keeping your API keys secure and within their respective usage policies.
              </p>
            </div>
          </section>
          
          {/* Disclaimers */}
          <section className="glass-card rounded-2xl p-8 border-yellow-500/20">
            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              9. Disclaimers
            </h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">9.1</span> THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.
              </p>
              <p>
                <span className="text-foreground font-medium">9.2</span> We do not warrant that the Service will be uninterrupted, secure, or error-free.
              </p>
              <p>
                <span className="text-foreground font-medium">9.3</span> We are not responsible for the accuracy or reliability of AI outputs generated using our Service.
              </p>
              <p>
                <span className="text-foreground font-medium">9.4</span> You use the Service at your own risk.
              </p>
            </div>
          </section>
          
          {/* Limitation of Liability */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">10. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, MEMORYROUTER SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, 
              OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, 
              RESULTING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM.
            </p>
          </section>
          
          {/* Termination */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">11. Termination</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                <span className="text-foreground font-medium">11.1</span> You may terminate your account at any time from your dashboard settings.
              </p>
              <p>
                <span className="text-foreground font-medium">11.2</span> We may terminate or suspend your account immediately for violation of these Terms.
              </p>
              <p>
                <span className="text-foreground font-medium">11.3</span> Upon termination, your right to use the Service ceases immediately.
              </p>
              <p>
                <span className="text-foreground font-medium">11.4</span> Data deletion upon termination is governed by our Privacy Policy.
              </p>
            </div>
          </section>
          
          {/* Changes */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">12. Changes to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We reserve the right to modify these Terms at any time. We will provide notice of significant changes via email or through the Service.
              Your continued use of the Service after changes constitutes acceptance of the new Terms.
              If you do not agree to the new Terms, you must stop using the Service.
            </p>
          </section>
          
          {/* Governing Law */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">13. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">
              These Terms shall be governed by and construed in accordance with the laws of the United States, 
              without regard to its conflict of law provisions. Any disputes arising from these Terms shall be resolved 
              in the courts of competent jurisdiction.
            </p>
          </section>
          
          {/* Contact */}
          <section className="glass-card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold mb-4">14. Contact</h2>
            <p className="text-muted-foreground mb-4">
              Questions about these Terms? Contact us at:
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground font-medium">Email:</span>{" "}
              <a href="mailto:legal@memoryrouter.ai" className="text-neon-green hover:underline">
                legal@memoryrouter.ai
              </a>
            </p>
          </section>
        </div>
        
        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-border/10 text-center text-sm text-muted-foreground">
          <p>
            <Link href="/privacy" className="hover:text-foreground underline">Privacy Policy</Link>
            {" · "}
            <Link href="/" className="hover:text-foreground">Back to Home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
