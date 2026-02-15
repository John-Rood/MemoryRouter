import Image from 'next/image'
import Link from 'next/link'
import { Calculator } from '@/components/Calculator'
import { CodeSwitcher } from '@/components/CodeSwitcher'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'

export default function Home() {
  return (
    <>
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-500/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-[150px]" />
      </div>

      {/* Nav */}
      <Header />

      {/* Hero */}
      <section className="pt-32 pb-16 px-6 relative grid-bg">
        <div className="max-w-5xl mx-auto text-center relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-full px-4 py-2 mb-8">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-400 text-sm font-medium">Private Beta — 500+ devs on waitlist</span>
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-[5.5rem] font-bold mb-8 leading-[1.05] tracking-tight">
            Stop Paying for
            <br />
            <span className="gradient-text-hero">AI to Forget</span>
          </h1>

          <p className="text-xl md:text-2xl text-gray-400 mb-8 max-w-2xl mx-auto leading-relaxed">
            Memory that makes every AI call smarter.
            <span className="text-white font-semibold"> Same memory, any model.</span>
          </p>

          {/* Value prop banner */}
          <div className="inline-block bg-black/50 border border-green-500/30 rounded-2xl p-6 mb-10">
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
              <div className="text-center">
                <div className="text-4xl md:text-5xl font-bold money-gradient">$0.20</div>
                <div className="text-gray-500 text-sm">per 1M tokens</div>
              </div>
              <div className="text-4xl text-gray-600">·</div>
              <div className="text-center">
                <div className="text-4xl md:text-5xl font-bold money-gradient">50M</div>
                <div className="text-gray-500 text-sm">tokens free</div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <a
              href="#calculator"
              className="btn-primary px-8 py-4 rounded-xl text-lg transition inline-flex items-center justify-center gap-2"
            >
              Calculate Your Savings
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="bg-white/5 border border-white/10 px-8 py-4 rounded-xl text-lg font-semibold hover:bg-white/10 transition"
            >
              See How It Works
            </a>
          </div>

          <p className="text-gray-600 text-sm">Works with OpenAI, Anthropic, Google, and 100+ models</p>
        </div>
      </section>

      {/* Live code demo */}
      <section className="pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="code-window rounded-2xl overflow-hidden shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10 bg-white/5">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <span className="text-gray-500 text-sm ml-4 font-mono">the entire integration</span>
            </div>
            <div className="p-6 text-sm md:text-base">
              <pre>
                <code>
                  <span className="text-gray-600">{'// Before: AI forgets everything'}</span>
                  {'\n'}
                  <span className="text-purple-400">const</span> client ={' '}
                  <span className="text-purple-400">new</span> <span className="text-cyan-300">OpenAI</span>(
                  {'{'}
                  {'\n  '}baseURL: <span className="text-red-400 line-through">{'"https://api.openai.com/v1"'}</span>
                  {'\n}'});{'\n\n'}
                  <span className="text-gray-600">{'// After: AI remembers everything'}</span>
                  {'\n'}
                  <span className="text-purple-400">const</span> client ={' '}
                  <span className="text-purple-400">new</span> <span className="text-cyan-300">OpenAI</span>(
                  {'{'}
                  {'\n  '}baseURL: <span className="neon-text">{'"https://api.memoryrouter.ai/v1"'}</span>
                  {'\n}'});{'\n\n'}
                  <span className="text-gray-600">{"// That's it. Same code. Now with memory."}</span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="py-8 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="line-glow mb-8 opacity-50" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="stat-card rounded-xl p-5 text-center">
              <div className="text-3xl md:text-4xl font-bold money-gradient">50-70%</div>
              <div className="text-gray-500 text-sm mt-1">Token Reduction</div>
            </div>
            <div className="stat-card rounded-xl p-5 text-center">
              <div className="text-3xl md:text-4xl font-bold text-cyan-400">&lt;50ms</div>
              <div className="text-gray-500 text-sm mt-1">Memory Retrieval</div>
            </div>
            <div className="stat-card rounded-xl p-5 text-center">
              <div className="text-3xl md:text-4xl font-bold text-purple-400">100+</div>
              <div className="text-gray-500 text-sm mt-1">Models Supported</div>
            </div>
            <div className="stat-card rounded-xl p-5 text-center">
              <div className="text-3xl md:text-4xl font-bold text-pink-400">∞</div>
              <div className="text-gray-500 text-sm mt-1">Memory Contexts</div>
            </div>
          </div>
          <div className="line-glow mt-8 opacity-50" />
        </div>
      </section>

      {/* Interactive Savings Calculator - Client Component */}
      <Calculator />

      {/* The Problem */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-red-400 font-medium text-sm tracking-wide uppercase mb-3">The Problem</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">The Hidden Tax on Every AI Call</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              You&apos;re not just paying for AI. You&apos;re paying for AI to re-learn what it already knew.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <div className="card-glass rounded-2xl p-6 card-glow transition-all">
              <div className="text-4xl mb-4">🔄</div>
              <h3 className="text-xl font-bold mb-2">Groundhog Day Prompts</h3>
              <p className="text-gray-400">
                Every session, you re-explain user preferences, project context, conversation history. Again. And again.
              </p>
            </div>
            <div className="card-glass rounded-2xl p-6 card-glow transition-all">
              <div className="text-4xl mb-4">📦</div>
              <h3 className="text-xl font-bold mb-2">Bloated Context Windows</h3>
              <p className="text-gray-400">
                Stuffing 50k+ tokens into every request because the alternative is an AI that doesn&apos;t know
                anything.
              </p>
            </div>
            <div className="card-glass rounded-2xl p-6 card-glow transition-all">
              <div className="text-4xl mb-4">💸</div>
              <h3 className="text-xl font-bold mb-2">Token Inflation</h3>
              <p className="text-gray-400">
                50-70% of your tokens are redundant. You&apos;re paying for the same information over and over.
              </p>
            </div>
          </div>

          {/* The Magic: Persistent Intelligence */}
          <div className="bg-gradient-to-br from-green-500/5 to-transparent rounded-2xl border border-green-500/10 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400">
                ✨
              </div>
              <h3 className="text-xl font-bold text-green-400">Your AI Actually Knows You</h3>
            </div>
            <div className="font-mono text-sm bg-black/30 rounded-xl p-6 mb-4 overflow-x-auto">
              <div className="text-gray-500">{'// Your code never changes. Ever.'}</div>
              <div className="text-gray-300">{'const ai = new OpenAI({'}</div>
              <div className="text-green-400 pl-4">{`baseURL: "https://api.memoryrouter.ai/v1"`}</div>
              <div className="text-gray-300">{'});'}</div>
              <div className="text-gray-600 mt-4">{'// ─────────────────────────────────────────'}</div>
              <div className="text-cyan-400 mt-4">{'// January 15th'}</div>
              <div className="text-gray-300">{'await ai.chat.completions.create({'}</div>
              <div className="text-gray-300 pl-4">
                {'messages: [{ role: "user", content: '}
                <span className="text-yellow-400">
                  {'"I prefer short emails, no fluff, sign off with just my first name"'}
                </span>
                {' }]'}
              </div>
              <div className="text-gray-300">{'});'}</div>
              <div className="text-gray-600 mt-4">{'// ─────────────────────────────────────────'}</div>
              <div className="text-cyan-400 mt-4">{'// March 3rd — different session, 47 days later'}</div>
              <div className="text-gray-300">{'await ai.chat.completions.create({'}</div>
              <div className="text-gray-300 pl-4">
                {'messages: [{ role: "user", content: '}
                <span className="text-yellow-400">{'"Draft a follow-up email to the investor"'}</span>
                {' }]'}
              </div>
              <div className="text-gray-300">{'});'}</div>
              <div className="text-green-400 mt-4">
                {'// → Concise email, signs "- John". No style guide needed.'}
              </div>
            </div>
            <div className="text-green-400 text-sm font-medium">
              Same code. No context stuffing. Your AI actually knows you.
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section id="use-cases" className="py-24 px-6 scroll-mt">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-cyan-400 font-medium text-sm tracking-wide uppercase mb-3">Use Cases</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Memory Changes Everything</h2>
            <p className="text-xl text-gray-400">Real products. Real savings. Real results.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Customer Support */}
            <div className="card-glass rounded-2xl p-8 card-glow transition-all">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="text-3xl mb-3">🎧</div>
                  <h3 className="text-2xl font-bold mb-2">Customer Support Bots</h3>
                  <p className="text-gray-400">AI that actually remembers your customers.</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Token savings</div>
                  <div className="text-2xl font-bold text-green-400">50-70%</div>
                </div>
              </div>
              <div className="bg-black/30 rounded-xl p-4 mb-6">
                <div className="text-sm text-gray-500 mb-2">Before: Every message</div>
                <div className="text-xs text-red-400 font-mono">
                  &quot;Here&apos;s the context from our last 5 conversations... their preferences... what they told
                  us...&quot;
                </div>
                <div className="text-sm text-gray-500 mb-2 mt-4">After: Just the message</div>
                <div className="text-xs text-green-400 font-mono">
                  &quot;Can you help with that issue I mentioned last week?&quot;
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Memory recalls: what the customer told you, their stated preferences, past issues discussed
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Remembers what customers told you
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Recalls past conversations across sessions
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> No more &quot;As I mentioned before...&quot;
                </li>
              </ul>
            </div>

            {/* Sales Assistant */}
            <div className="card-glass rounded-2xl p-8 card-glow transition-all">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="text-3xl mb-3">📈</div>
                  <h3 className="text-2xl font-bold mb-2">Sales Intelligence</h3>
                  <p className="text-gray-400">AI that remembers every conversation.</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Context retained</div>
                  <div className="text-2xl font-bold text-green-400">100%</div>
                </div>
              </div>
              <div className="bg-black/30 rounded-xl p-4 mb-6">
                <div className="text-sm text-gray-500 mb-2">How reps use it</div>
                <div className="text-xs text-cyan-400 font-mono">
                  &quot;Brief me on the Acme Corp deal before my call&quot;
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  → AI recalls everything you&apos;ve discussed: objections mentioned, pricing conversations, competitor
                  concerns, and what stakeholders said — across weeks of conversations.
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Remembers every conversation about the deal
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Recalls objections discussed & your responses
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Context persists across months
                </li>
              </ul>
            </div>

            {/* Healthcare Intake */}
            <div className="card-glass rounded-2xl p-8 card-glow transition-all">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="text-3xl mb-3">🏥</div>
                  <h3 className="text-2xl font-bold mb-2">Healthcare Assistants</h3>
                  <p className="text-gray-400">Patient conversations that persist.</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Memory retention</div>
                  <div className="text-2xl font-bold text-green-400">90 days</div>
                </div>
              </div>
              <div className="bg-black/30 rounded-xl p-4 mb-6">
                <div className="text-sm text-gray-500 mb-2">Continuity of care</div>
                <div className="text-xs text-gray-400">
                  Patient returns 3 months later. AI remembers what they said:
                </div>
                <div className="text-xs text-green-400 font-mono mt-2">
                  • Symptoms they described
                  <br />
                  • Medications they mentioned taking
                  <br />
                  • Allergies they told you about
                  <br />• How they prefer to communicate
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Per-patient memory isolation
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Remembers conversations over time
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> HIPAA-ready architecture
                </li>
              </ul>
            </div>

            {/* Documentation Q&A */}
            <div className="card-glass rounded-2xl p-8 card-glow transition-all">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="text-3xl mb-3">📚</div>
                  <h3 className="text-2xl font-bold mb-2">Docs & Knowledge Base</h3>
                  <p className="text-gray-400">AI that remembers what users asked.</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Context</div>
                  <div className="text-2xl font-bold text-green-400">Persistent</div>
                </div>
              </div>
              <div className="bg-black/30 rounded-xl p-4 mb-6">
                <div className="text-sm text-gray-500 mb-2">Smart context building</div>
                <div className="text-xs text-gray-400">
                  AI remembers what each user has asked about, their follow-up questions, and what worked for them.
                </div>
                <div className="text-xs text-purple-400 font-mono mt-2">
                  &quot;How do I set up OAuth?&quot; → AI remembers you mentioned using Node.js, that you tried the
                  basic guide, that you need enterprise SSO
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Remembers every interaction
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Per-user conversation history
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> No re-explaining your setup
                </li>
              </ul>
            </div>

            {/* Personal AI Companion */}
            <div className="card-glass rounded-2xl p-8 card-glow transition-all border border-purple-500/20">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="text-3xl mb-3">💜</div>
                  <h3 className="text-2xl font-bold mb-2">Personal AI Companions</h3>
                  <p className="text-gray-400">Build a real relationship with AI.</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">The difference</div>
                  <div className="text-2xl font-bold text-purple-400">Everything</div>
                </div>
              </div>
              <div className="bg-black/30 rounded-xl p-4 mb-6">
                <div className="text-sm text-purple-400 mb-2">This is what changes everything</div>
                <div className="text-sm text-gray-300">
                  Current AI meets you fresh every time — a stranger on repeat. With memory, your AI{' '}
                  <em>actually knows you</em>. Your humor. Your struggles. What you said three months ago. It&apos;s the
                  difference between a chatbot and a companion.
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span> Conversations that compound over months
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span> AI that learns your communication style
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span> The foundation for AI that actually matters to people
                </li>
              </ul>
            </div>

            {/* Legal Research */}
            <div className="card-glass rounded-2xl p-8 card-glow transition-all">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="text-3xl mb-3">⚖️</div>
                  <h3 className="text-2xl font-bold mb-2">Legal Assistants</h3>
                  <p className="text-gray-400">Case conversations that persist.</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Case memory</div>
                  <div className="text-2xl font-bold text-green-400">Complete</div>
                </div>
              </div>
              <div className="bg-black/30 rounded-xl p-4 mb-6">
                <div className="text-sm text-gray-500 mb-2">Per-case memory</div>
                <div className="text-xs text-gray-400">
                  AI remembers every conversation about the case: arguments discussed, precedents mentioned, strategies
                  developed — across weeks of prep.
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Full conversation history per case
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Recalls strategy discussions
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Matter-level memory isolation
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 px-6 scroll-mt">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-purple-400 font-medium text-sm tracking-wide uppercase mb-3">How It Works</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Three Steps. Zero Complexity.</h2>
            <p className="text-xl text-gray-400">No vector database. No embedding pipeline. No ops burden.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-6 border border-green-500/20">
                <span className="text-2xl font-bold text-green-400">1</span>
              </div>
              <h3 className="text-xl font-bold mb-3">Add Your API Keys</h3>
              <p className="text-gray-400">
                Bring your OpenAI, Anthropic, or OpenRouter keys. You pay providers directly — we never touch your
                inference spend.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-6 border border-cyan-500/20">
                <span className="text-2xl font-bold text-cyan-400">2</span>
              </div>
              <h3 className="text-xl font-bold mb-3">Create Memory Keys</h3>
              <p className="text-gray-400">
                Each MemoryRouter key is a memory context. Create one per user, per project, per conversation —
                unlimited.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mx-auto mb-6 border border-purple-500/20">
                <span className="text-2xl font-bold text-purple-400">3</span>
              </div>
              <h3 className="text-xl font-bold mb-3">Memory Just Works</h3>
              <p className="text-gray-400">
                Every call builds memory. Every response uses it. Your AI gets smarter automatically. No extra code.
              </p>
            </div>
          </div>

          {/* Architecture diagram */}
          <div className="card-glass rounded-2xl p-8">
            <div className="text-center text-xs text-gray-500 font-medium tracking-widest uppercase mb-8">
              Powered by KRONOS — 3D Context Engine
            </div>
            <div className="flex flex-col lg:flex-row items-center justify-center gap-4">
              <div className="bg-white/5 rounded-xl px-6 py-4 border border-white/10 text-center">
                <div className="text-lg font-bold">Your App</div>
                <div className="text-xs text-gray-500">Same SDK</div>
              </div>
              <svg
                className="w-8 h-8 text-gray-600 rotate-90 lg:rotate-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <div className="bg-gradient-to-br from-green-500/20 to-cyan-500/20 rounded-xl px-8 py-4 border border-green-500/30 text-center relative">
                <div className="text-lg font-bold">MemoryRouter</div>
                <div className="text-xs text-green-400">KRONOS Engine</div>
                <div className="absolute -top-2 -right-2 bg-green-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">
                  &lt;50ms
                </div>
              </div>
              <svg
                className="w-8 h-8 text-gray-600 rotate-90 lg:rotate-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <div className="bg-white/5 rounded-xl px-6 py-4 border border-white/10 text-center">
                <div className="text-lg font-bold">AI Provider</div>
                <div className="text-xs text-gray-500">+ memories</div>
              </div>
            </div>
            <div className="mt-8 text-center text-sm text-gray-500">
              <span className="text-cyan-400 font-semibold">KRONOS</span> analyzes context across 3 dimensions:
              <span className="text-white"> Semantic</span> (meaning),
              <span className="text-white"> Temporal</span> (time),
              <span className="text-white"> Spatial</span> (structure)
            </div>
          </div>
        </div>
      </section>

      {/* Code Examples - Client Component */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-pink-400 font-medium text-sm tracking-wide uppercase mb-3">Integration</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Your Code. Now With Memory.</h2>
            <p className="text-xl text-gray-400">Native SDK support for every major provider.</p>
          </div>

          <CodeSwitcher />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 scroll-mt">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-green-400 font-medium text-sm tracking-wide uppercase mb-3">Pricing</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Memory That Pays for Itself</h2>
            <p className="text-xl text-gray-400">The math is simple: spend a little, save a lot.</p>
          </div>

          <div className="card-glass rounded-3xl p-8 md:p-12 border-green-500/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/5 rounded-full blur-3xl" />
            <div className="relative">
              <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-8">
                <div>
                  <div className="text-xs text-green-400 font-bold tracking-widest uppercase mb-2">Simple Pricing</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-6xl md:text-7xl font-bold">$0.20</span>
                    <span className="text-xl text-gray-500">per 1M memory tokens</span>
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <div className="text-4xl font-bold money-gradient mb-1">10x ROI</div>
                  <div className="text-gray-500">guaranteed return</div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6 mb-8">
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span className="text-gray-300">Unlimited memory contexts</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span className="text-gray-300">90-day retention included</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span className="text-gray-300">All 100+ models supported</span>
                  </li>
                </ul>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span className="text-gray-300">Sub-50ms retrieval</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span className="text-gray-300">Ephemeral key auto-cleanup</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="text-green-400">✓</span>
                    <span className="text-gray-300">No inference markup — ever</span>
                  </li>
                </ul>
              </div>

              <div className="bg-black/30 rounded-xl p-6 mb-8">
                <div className="text-sm text-gray-500 mb-3">How billing works</div>
                <div className="text-gray-300">
                  You bring your own API keys and pay providers directly for inference at their prices. We only charge
                  for memory tokens — the storage and retrieval that makes your AI smarter.
                  <span className="text-green-400 font-semibold"> No markup on inference. No hidden fees. Ever.</span>
                </div>
              </div>

              <a
                href="https://app.memoryrouter.ai"
                className="btn-primary px-8 py-4 rounded-xl text-lg w-full transition flex items-center justify-center gap-2"
              >
                Get Started Free — 50M Tokens Included
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ - Native HTML details/summary (no JS needed) */}
      <section id="faq" className="py-24 px-6 scroll-mt">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-cyan-400 font-medium text-sm tracking-wide uppercase mb-3">FAQ</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Questions? Answered.</h2>
          </div>

          <div className="space-y-4">
            <details className="card-glass rounded-xl group" open>
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                How does memory actually save me money?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                Without memory, you stuff context into every API call — user preferences, conversation history, project
                details. That&apos;s often 50-70% of your tokens. With MemoryRouter, relevant context is automatically
                retrieved and injected. You send less, get the same (or better) results. At $0.20 per million tokens, memory
                is the cheapest way to make your AI smarter.
              </div>
            </details>

            <details className="card-glass rounded-xl group">
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                What&apos;s KRONOS? How is it different from RAG?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                KRONOS is our proprietary 3D context engine that analyzes memory across three dimensions:{' '}
                <strong className="text-white">Semantic</strong> (meaning and relationships),{' '}
                <strong className="text-white">Temporal</strong> (when things happened and in what sequence), and{' '}
                <strong className="text-white">Spatial</strong> (structure and hierarchy). Unlike basic RAG that just
                does similarity search, KRONOS understands context holistically — retrieving not just
                &quot;similar&quot; memories, but the right memories for your specific query.
              </div>
            </details>

            <details className="card-glass rounded-xl group">
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                Do you markup inference costs?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                <strong className="text-green-400">Never.</strong> You bring your own API keys (OpenAI, Anthropic,
                OpenRouter, etc.) and pay providers directly at their published rates. We only charge for memory tokens.
                This keeps our incentives aligned: we make money when we save you money.
              </div>
            </details>

            <details className="card-glass rounded-xl group">
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                How does memory isolation work?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                Each MemoryRouter API key represents an isolated memory context. User A&apos;s memories never touch User
                B&apos;s memories. Create one key per user, per conversation, per project — whatever granularity makes
                sense for your app. Memories are encrypted at rest and in transit.
              </div>
            </details>

            <details className="card-glass rounded-xl group">
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                What happens to unused memory keys?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                Ephemeral keys that are never used are never persisted — no bloat, no cost. Active memories have a
                90-day retention by default. You can extend retention for specific contexts or delete memories
                programmatically.
              </div>
            </details>

            <details className="card-glass rounded-xl group">
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                Which models are supported?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                All of them. MemoryRouter works with every model from OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek,
                and more — all models from every major provider. If it works with the OpenAI SDK, it works with MemoryRouter.{' '}
                <a href="/models" className="text-green-400 hover:text-green-300 underline">
                  See all supported models →
                </a>
              </div>
            </details>

            <details className="card-glass rounded-xl group">
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                How fast is memory retrieval?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                Sub-50ms. KRONOS is optimized for real-time retrieval. In practice, memory lookup adds negligible
                latency to your API calls — usually less than the variance in provider response times.
              </div>
            </details>

            <details className="card-glass rounded-xl group">
              <summary className="p-6 cursor-pointer flex items-center justify-between font-semibold text-lg hover:text-green-400 transition">
                Can I control what gets remembered?
                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-6 pb-6 text-gray-400">
                Yes. You can mark specific messages as &quot;do not remember,&quot; delete specific memories, or wipe an
                entire context. We also provide analytics so you can see what&apos;s being stored and retrieved.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* CTA - Direct to Signup */}
      <section id="waitlist" className="py-24 px-6 scroll-mt">
        <div className="max-w-3xl mx-auto text-center">
          <div className="card-glass rounded-3xl p-12 border-green-500/20 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-cyan-500/5" />
            <div className="relative">
              <div className="text-5xl mb-6">🚀</div>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Stop Paying for AI Amnesia</h2>
              <p className="text-xl text-gray-400 mb-8">500+ developers building with memory. Free tier included.</p>

              <a
                href="https://app.memoryrouter.ai"
                className="btn-primary px-10 py-5 rounded-xl text-lg font-semibold inline-flex items-center gap-3 transition"
              >
                Get Started Free
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>

              <p className="text-gray-600 text-sm mt-6">50M tokens free. No credit card required.</p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  )
}
