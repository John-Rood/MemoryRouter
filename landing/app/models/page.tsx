import Image from 'next/image'
import Link from 'next/link'
import { Metadata } from 'next'
import { FooterNewsletter } from '@/components/FooterNewsletter'
import { ModelsGrid } from '@/components/ModelsGrid'

export const metadata: Metadata = {
  title: 'Supported Models — MemoryRouter | 200+ AI Models, One Memory',
  description: 'MemoryRouter works with GPT-5.2, Claude Opus 4.5, Gemini 3 Pro, Llama 3, and 200+ more models. Same memory, any model. One line change.',
}

export default function ModelsPage() {
  return (
    <>
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-500/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-[150px]" />
      </div>

      {/* Nav */}
      <nav className="fixed w-full z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition shrink-0">
            <Image src="/logo.png" alt="MemoryRouter" width={32} height={32} className="rounded-lg" />
            <span className="text-xl font-bold whitespace-nowrap">MemoryRouter</span>
          </Link>
          
          <div className="hidden lg:flex items-center justify-center gap-6 flex-1 mx-8">
            <a href="/#calculator" className="text-gray-400 hover:text-white transition text-sm whitespace-nowrap">
              Calculator
            </a>
            <a href="/#use-cases" className="text-gray-400 hover:text-white transition text-sm whitespace-nowrap">
              Use Cases
            </a>
            <a href="/#how-it-works" className="text-gray-400 hover:text-white transition text-sm whitespace-nowrap">
              How It Works
            </a>
            <Link href="/models" className="text-white font-medium transition text-sm whitespace-nowrap">
              Models
            </Link>
            <a href="/#pricing" className="text-gray-400 hover:text-white transition text-sm whitespace-nowrap">
              Pricing
            </a>
            <a href="/#faq" className="text-gray-400 hover:text-white transition text-sm whitespace-nowrap">
              FAQ
            </a>
          </div>
          
          <a
            href="https://app.memoryrouter.ai"
            className="btn-primary px-5 py-2.5 rounded-lg text-sm transition shrink-0 whitespace-nowrap ml-auto lg:ml-0"
          >
            Get Started Free
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-16 px-6 relative grid-bg">
        <div className="max-w-5xl mx-auto text-center relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-2 mb-8">
            <span className="text-cyan-400 text-sm font-medium">200+ models supported</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-8 leading-[1.05] tracking-tight">
            Every Model.
            <br />
            <span className="gradient-text-hero">One Memory.</span>
          </h1>

          <p className="text-xl md:text-2xl text-gray-400 mb-10 max-w-3xl mx-auto leading-relaxed">
            Switch between GPT-5, Claude Opus, Gemini 3, Llama, and 200+ more —{' '}
            <span className="text-white font-semibold">your memory follows seamlessly.</span>
          </p>

          {/* Code swap demo */}
          <div className="max-w-2xl mx-auto mb-10">
            <div className="code-window rounded-2xl overflow-hidden shadow-2xl shadow-black/50">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10 bg-white/5">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="text-gray-500 text-sm ml-4 font-mono">swap models, keep memory</span>
              </div>
              <div className="p-5 text-sm text-left">
                <pre>
                  <code>
                    <span className="text-gray-500">{'// Monday: Use GPT-5.2'}</span>
                    {'\n'}model: <span className="text-green-400">{'"gpt-5.2"'}</span>
                    {'\n\n'}
                    <span className="text-gray-500">{'// Tuesday: Try Claude'}</span>
                    {'\n'}model: <span className="text-cyan-400">{'"anthropic/claude-opus-4.5"'}</span>
                    {'\n\n'}
                    <span className="text-gray-500">{'// Wednesday: Test Gemini'}</span>
                    {'\n'}model: <span className="text-purple-400">{'"google/gemini-3-pro"'}</span>
                    {'\n\n'}
                    <span className="neon-text">{'// Memory persists across all of them ✓'}</span>
                  </code>
                </pre>
              </div>
            </div>
          </div>

          <p className="text-gray-500 text-sm">No lock-in. No migration. Just change the model parameter.</p>
        </div>
      </section>

      {/* Models Grid with Filters - Client Component */}
      <ModelsGrid />

      {/* CTA Section */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="card-glass rounded-3xl p-8 md:p-12 border-green-500/20 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/5 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl" />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Add Memory?</h2>
              <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
                One line change. Same code. Persistent memory across every model.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href="https://app.memoryrouter.ai"
                  className="btn-primary px-8 py-4 rounded-xl text-lg transition inline-flex items-center justify-center gap-2"
                >
                  Get Started Free
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </a>
                <a
                  href="/#calculator"
                  className="bg-white/5 border border-white/10 px-8 py-4 rounded-xl text-lg font-semibold hover:bg-white/10 transition"
                >
                  Calculate Savings
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-[#09090b]/50">
        <div className="max-w-6xl mx-auto px-6 py-16">
          {/* Main Footer Grid */}
          <div className="grid grid-cols-2 md:grid-cols-10 gap-8 mb-12">
            {/* Brand + Newsletter */}
            <div className="col-span-2 md:col-span-4 pr-6 md:pr-12 overflow-hidden">
              <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition mb-4">
                <Image src="/logo.png" alt="MemoryRouter" width={32} height={32} className="rounded-lg" />
                <span className="text-xl font-bold">MemoryRouter</span>
              </Link>
              <p className="text-gray-400 text-sm mb-6">
                AI memory infrastructure. Same memory, any model. Stop paying for AI to forget.
              </p>
              
              {/* Newsletter */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-white mb-3">Stay in the loop</h4>
                <FooterNewsletter />
              </div>
              <p className="text-gray-600 text-xs">No spam, unsubscribe anytime.</p>
            </div>
            
            {/* Product Column */}
            <div className="md:col-span-2">
              <h4 className="text-sm font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="/#calculator" className="text-gray-400 hover:text-white transition">Calculator</a></li>
                <li><a href="/#how-it-works" className="text-gray-400 hover:text-white transition">How It Works</a></li>
                <li><a href="/#pricing" className="text-gray-400 hover:text-white transition">Pricing</a></li>
                <li><Link href="/models" className="text-gray-400 hover:text-white transition">Models</Link></li>
                <li><a href="/#use-cases" className="text-gray-400 hover:text-white transition">Use Cases</a></li>
              </ul>
            </div>
            
            {/* Developers Column */}
            <div className="md:col-span-2">
              <h4 className="text-sm font-semibold text-white mb-4">Developers</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="https://docs.memoryrouter.ai" className="text-gray-400 hover:text-white transition">Documentation</a></li>
                <li><a href="https://docs.memoryrouter.ai/api-reference" className="text-gray-400 hover:text-white transition">API Reference</a></li>
                <li><a href="/#faq" className="text-gray-400 hover:text-white transition">FAQ</a></li>
                <li><a href="https://github.com/John-Rood/memoryrouter-sdk" className="text-gray-400 hover:text-white transition">GitHub</a></li>
              </ul>
            </div>
            
            {/* Company Column */}
            <div className="md:col-span-2">
              <h4 className="text-sm font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="https://twitter.com/memoryrouter" className="text-gray-400 hover:text-white transition">Twitter</a></li>
                <li><a href="mailto:hello@memoryrouter.ai" className="text-gray-400 hover:text-white transition">Contact</a></li>
                <li><a href="/privacy" className="text-gray-400 hover:text-white transition">Privacy Policy</a></li>
                <li><a href="/terms" className="text-gray-400 hover:text-white transition">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          
          {/* Bottom Bar */}
          <div className="pt-8 border-t border-white/5 flex items-center justify-between">
            <div className="text-sm text-gray-600">© 2026 MemoryRouter</div>
            <div className="flex items-center gap-6">
              <a href="https://twitter.com/memoryrouter" className="text-gray-500 hover:text-white transition" aria-label="Twitter">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://github.com/John-Rood/memoryrouter-sdk" className="text-gray-500 hover:text-white transition" aria-label="GitHub">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}
