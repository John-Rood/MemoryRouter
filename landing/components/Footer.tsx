import Image from 'next/image'
import Link from 'next/link'
import { FooterNewsletter } from './FooterNewsletter'

export function Footer() {
  return (
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
              <li><a href="/models" className="text-gray-400 hover:text-white transition">Models</a></li>
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
  )
}
