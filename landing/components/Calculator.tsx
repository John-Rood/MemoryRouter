'use client'

import { useState } from 'react'

export function Calculator() {
  const [spend, setSpend] = useState(5000)
  
  // Calculations
  const memoryTokens = spend * 2_000_000 // $0.50 per 1M
  const conversationsPerDay = Math.round(memoryTokens / 30 / 2000) // ~2K tokens per conversation
  const contextSaved = Math.round(spend * 4) // Rough estimate of context window savings
  const inferenceSavings = Math.round(contextSaved * 2.5) // ~$2.50 saved per $1 context
  const roi = Math.round((inferenceSavings / spend) * 100)
  
  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return n.toString()
  }
  
  return (
    <section id="calculator" className="py-24 px-6 relative">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-6">
            <span className="text-green-400">💰</span>
            <span className="text-sm text-gray-400">ROI Calculator</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            See Your <span className="gradient-text">Savings</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Every dollar on memory saves you dollars on inference. Calculate your ROI.
          </p>
        </div>
        
        {/* Calculator Card */}
        <div className="card-glass rounded-3xl p-8 md:p-12">
          {/* Slider */}
          <div className="mb-12">
            <div className="flex justify-between items-center mb-4">
              <span className="text-gray-400">Monthly Memory Budget</span>
              <span className="text-3xl font-bold text-green-400">${spend.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min="100"
              max="50000"
              step="100"
              value={spend}
              onChange={(e) => setSpend(parseInt(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-sm text-gray-500 mt-2">
              <span>$100</span>
              <span>$50,000</span>
            </div>
          </div>
          
          {/* Results Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center p-4 rounded-xl bg-white/5">
              <div className="text-2xl md:text-3xl font-bold text-white mb-1">{formatNumber(memoryTokens)}</div>
              <div className="text-sm text-gray-400">Memory Tokens</div>
            </div>
            <div className="text-center p-4 rounded-xl bg-white/5">
              <div className="text-2xl md:text-3xl font-bold text-white mb-1">{formatNumber(conversationsPerDay)}</div>
              <div className="text-sm text-gray-400">Convos/Day</div>
            </div>
            <div className="text-center p-4 rounded-xl bg-white/5">
              <div className="text-2xl md:text-3xl font-bold text-green-400 mb-1">${formatNumber(inferenceSavings)}</div>
              <div className="text-sm text-gray-400">Inference Saved</div>
            </div>
            <div className="text-center p-4 rounded-xl bg-green-500/10 border border-green-500/20">
              <div className="text-2xl md:text-3xl font-bold text-green-400 mb-1">{roi}%</div>
              <div className="text-sm text-green-400/80">ROI</div>
            </div>
          </div>
          
          {/* Explanation */}
          <p className="text-center text-gray-500 text-sm mt-8">
            Based on average context window reduction and inference cost savings
          </p>
        </div>
      </div>
    </section>
  )
}
