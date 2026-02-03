'use client'

import { useState } from 'react'

const providers = [
  { id: 'all', label: 'All Models' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
  { id: 'meta', label: 'Meta/Llama' },
  { id: 'mistral', label: 'Mistral' },
]

const models = [
  // OpenAI
  { provider: 'openai', name: 'GPT-5.2', context: '128K', badges: ['Flagship'], desc: "OpenAI's flagship model. Improved personality, creativity, and reasoning.", tags: ['Vision', 'Creative', 'Agentic'] },
  { provider: 'openai', name: 'GPT-5.1', context: '128K', badges: [], desc: 'Strong general-purpose model. Excellent balance of capability and cost.', tags: ['Vision', 'Function Calling', 'JSON Mode'] },
  { provider: 'openai', name: 'GPT-4.5', context: '128K', badges: ['Pro'], desc: 'Large pre-trained model for Pro users. Deep knowledge and nuance.', tags: ['Vision', 'Research', 'Analysis'] },
  { provider: 'openai', name: 'o3', context: '200K', badges: ['Reasoning'], desc: 'Most powerful reasoning model. SOTA on coding, math, and science benchmarks.', tags: ['Chain-of-Thought', 'SOTA', 'Science'] },
  { provider: 'openai', name: 'o1-pro', context: '200K', badges: ['Premium'], desc: 'Premium reasoning with extended compute. Best for the hardest problems.', tags: ['Expert', 'Research'] },
  { provider: 'openai', name: 'o1', context: '200K', badges: ['Reasoning'], desc: 'Advanced reasoning model. Thinks before responding for complex tasks.', tags: ['Chain-of-Thought', 'Math', 'Code'] },
  
  // Anthropic
  { provider: 'anthropic', name: 'Claude Opus 4.5', context: '200K', badges: ['Flagship'], desc: 'Flagship model. Best for coding, agents, and computer use. $5/$25 per 1M tokens.', tags: ['Vision', 'Coding', 'Agentic'] },
  { provider: 'anthropic', name: 'Claude Sonnet 4.5', context: '200K', badges: ['Popular'], desc: 'Best balance of speed, intelligence, and cost. Great for everyday tasks.', tags: ['Vision', 'Balanced', 'Analysis'] },
  { provider: 'anthropic', name: 'Claude Haiku 4.5', context: '200K', badges: [], desc: 'Fastest and cheapest Claude. Lightning-fast for simple tasks at scale.', tags: ['Vision', 'Ultra Fast', 'Low Cost'] },
  
  // Google
  { provider: 'google', name: 'Gemini 3 Pro', context: '1M', badges: ['Flagship'], desc: 'Most advanced multimodal model. Perfect for analyzing entire codebases or documents.', tags: ['Vision', 'Audio', 'Video'] },
  { provider: 'google', name: 'Gemini 3 Flash', context: '1M', badges: ['1M Context'], desc: 'Fast and scalable with massive context. Great for real-time apps.', tags: ['Vision', 'Fast', 'Multimodal'] },
  { provider: 'google', name: 'Gemini 2.5 Pro', context: '1M', badges: ['1M Context'], desc: 'Strong predecessor with native tool use and agentic capabilities.', tags: ['Agentic', 'Tool Use', 'Reasoning'] },
  { provider: 'google', name: 'Gemini 2.5 Flash', context: '1M', badges: [], desc: 'Fast and cost-efficient. Excellent for high-volume multimodal workloads.', tags: ['Fast', 'Low Cost', 'Multimodal'] },
  
  // Meta
  { provider: 'meta', name: 'Llama 4 Maverick', context: '1M', badges: ['Flagship'], desc: '128-expert MoE flagship. Industry-leading multimodal with 17B active params. Beats GPT-4o.', tags: ['Vision', 'MoE 128E', 'Multilingual'] },
  { provider: 'meta', name: 'Llama 4 Scout', context: '10M', badges: ['10M Context'], desc: '16-expert MoE with industry-leading 10M context. Fits on single H100. Best in class.', tags: ['Vision', 'Long Context', 'Open Weights'] },
  { provider: 'meta', name: 'Llama 3.3 70B', context: '128K', badges: [], desc: 'Best price-to-performance open model. Excellent general-purpose capabilities.', tags: ['Open Weights', 'Balanced', 'Coding'] },
  
  // Mistral
  { provider: 'mistral', name: 'Mistral Large 3', context: '256K', badges: ['Flagship'], desc: "41B/675B MoE flagship. World's best open-weight multimodal model. Apache 2.0 license.", tags: ['Vision', 'MoE', 'Agentic'] },
  { provider: 'mistral', name: 'Ministral 3 14B', context: '128K', badges: [], desc: 'Best-in-class edge model. Vision + reasoning in 14B params. Perfect for local deployment.', tags: ['Vision', 'Edge', 'Open Weights'] },
  { provider: 'mistral', name: 'Mistral Small 3.2', context: '128K', badges: [], desc: '24B enterprise-ready compact model. Vision capabilities with Apache 2.0 license.', tags: ['Vision', 'Fast', 'Open Weights'] },
  
]

const providerStyles: Record<string, { border: string; badge: string; context: string; glow: string }> = {
  openai: { border: 'border-emerald-500/30 hover:border-emerald-500/60', glow: 'hover:shadow-lg hover:shadow-emerald-500/20', badge: 'bg-emerald-500/15 text-emerald-400', context: 'text-green-400' },
  anthropic: { border: 'border-orange-400/30 hover:border-orange-400/60', glow: 'hover:shadow-lg hover:shadow-orange-400/20', badge: 'bg-orange-400/15 text-orange-300', context: 'text-cyan-400' },
  google: { border: 'border-red-500/30 hover:border-red-500/60', glow: 'hover:shadow-lg hover:shadow-red-500/20', badge: 'bg-red-500/15 text-red-400', context: 'text-red-400' },
  meta: { border: 'border-blue-500/30 hover:border-blue-500/60', glow: 'hover:shadow-lg hover:shadow-blue-500/20', badge: 'bg-blue-500/15 text-blue-400', context: 'text-blue-400' },
  mistral: { border: 'border-orange-500/30 hover:border-orange-500/60', glow: 'hover:shadow-lg hover:shadow-orange-500/20', badge: 'bg-orange-500/15 text-orange-400', context: 'text-orange-400' },
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  meta: 'Meta via OpenRouter',
  mistral: 'Mistral via OpenRouter',
}

const badgeStyles: Record<string, string> = {
  Flagship: 'bg-green-500/20 text-green-400',
  Popular: 'bg-cyan-500/20 text-cyan-400',
  Pro: 'bg-pink-500/20 text-pink-400',
  Premium: 'bg-pink-500/20 text-pink-400',
  Reasoning: 'bg-purple-500/20 text-purple-400',
  '1M Context': 'bg-yellow-500/20 text-yellow-400',
  '10M Context': 'bg-yellow-500/20 text-yellow-400',
}

export function ModelsGrid() {
  const [filter, setFilter] = useState('all')

  const filteredModels = filter === 'all' ? models : models.filter(m => m.provider === filter)

  return (
    <>
      {/* Filter tabs */}
      <section className="py-8 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap justify-center gap-3">
            {providers.map(p => (
              <button
                key={p.id}
                onClick={() => setFilter(p.id)}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition ${
                  filter === p.id
                    ? 'bg-green-500/15 border-green-500/50 text-green-400'
                    : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Models Grid */}
      <section className="py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredModels.map((model, i) => {
              const styles = providerStyles[model.provider]
              return (
                <div
                  key={i}
                  className={`card-glass rounded-2xl p-6 transition-all duration-300 border ${styles.border} ${styles.glow}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex flex-wrap gap-2">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${styles.badge}`}>
                        {providerLabels[model.provider]}
                      </span>
                      {model.badges.map(badge => (
                        <span key={badge} className={`text-xs px-2 py-1 rounded-full ${badgeStyles[badge] || 'bg-white/10 text-white'}`}>
                          {badge}
                        </span>
                      ))}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Context</div>
                      <div className={`text-sm font-bold ${styles.context}`}>{model.context}</div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-2">{model.name}</h3>
                  <p className="text-gray-400 text-sm mb-4">{model.desc}</p>
                  <div className="flex flex-wrap gap-2">
                    {model.tags.map(tag => (
                      <span key={tag} className="text-xs bg-white/5 px-2 py-1 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* More Models Card */}
            <div className="card-glass rounded-2xl p-6 transition-all bg-gradient-to-br from-green-500/5 to-cyan-500/5 border-green-500/20">
              <div className="flex items-start justify-between mb-4">
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-gradient-to-r from-green-500/20 to-cyan-500/20 text-green-400">
                  And More
                </span>
              </div>
              <h3 className="text-xl font-bold mb-2 gradient-text-hero">200+ More Models</h3>
              <p className="text-gray-400 text-sm mb-4">
                Cohere, Perplexity, Together, and dozens more. If it&apos;s on OpenRouter, it works with MemoryRouter.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-white/5 px-2 py-1 rounded">Cohere</span>
                <span className="text-xs bg-white/5 px-2 py-1 rounded">Perplexity</span>
                <span className="text-xs bg-white/5 px-2 py-1 rounded">Together</span>
                <span className="text-xs bg-white/5 px-2 py-1 rounded">+ more</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
