'use client'

import { useState } from 'react'

export function Calculator() {
  const [spend, setSpend] = useState(5000)

  // Calculations matching index.html logic
  const waste = spend * 0.5 // 50% wasted on re-context
  const reducedInference = spend * 0.4 // 60% reduction
  const memoryCost = spend * 0.09 // ~9% memory cost
  const totalWith = reducedInference + memoryCost
  const savings = spend - totalWith
  const percent = Math.round((savings / spend) * 100)

  const formatNumber = (num: number) => Math.round(num).toLocaleString()

  return (
    <section id="calculator" className="py-24 px-6 scroll-mt">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-green-400 font-medium text-sm tracking-wide uppercase mb-3">💰 Savings Calculator</p>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">How Much Are You Wasting?</h2>
          <p className="text-xl text-gray-400">Drag the slider. Watch your money come back.</p>
        </div>

        <div className="card-glass rounded-3xl p-8 md:p-12">
          <div className="mb-10">
            <label className="block text-gray-400 mb-4 text-lg">Your monthly AI spend</label>
            <input
              type="range"
              min="100"
              max="50000"
              value={spend}
              onChange={(e) => setSpend(parseInt(e.target.value))}
              className="w-full mb-4"
            />
            <div className="flex justify-between text-sm text-gray-500">
              <span>$100</span>
              <span className="text-2xl font-bold text-white">${formatNumber(spend)}/mo</span>
              <span>$50,000</span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Without MemoryRouter */}
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
              <div className="text-red-400 text-sm font-medium mb-4">❌ Without MemoryRouter</div>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Monthly inference</span>
                  <span className="text-white font-mono">${formatNumber(spend)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Wasted on re-context</span>
                  <span className="text-red-400 font-mono">~${formatNumber(waste)}</span>
                </div>
              </div>
              <div className="border-t border-red-500/20 pt-4">
                <div className="text-3xl font-bold text-red-400">
                  ${formatNumber(spend)}
                  <span className="text-base font-normal text-gray-500">/mo</span>
                </div>
              </div>
            </div>

            {/* With MemoryRouter */}
            <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-6">
              <div className="text-green-400 text-sm font-medium mb-4">✓ With MemoryRouter</div>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Reduced inference</span>
                  <span className="text-white font-mono">${formatNumber(reducedInference)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Memory cost</span>
                  <span className="text-white font-mono">${formatNumber(memoryCost)}</span>
                </div>
              </div>
              <div className="border-t border-green-500/20 pt-4">
                <div className="text-3xl font-bold money-gradient">
                  ${formatNumber(totalWith)}
                  <span className="text-base font-normal text-gray-500">/mo</span>
                </div>
              </div>
            </div>
          </div>

          {/* Savings summary */}
          <div className="mt-8 bg-gradient-to-r from-green-500/10 to-cyan-500/10 border border-green-500/20 rounded-2xl p-6 text-center">
            <div className="text-gray-400 mb-2">You save</div>
            <div className="text-5xl md:text-6xl font-bold money-gradient mb-2">
              ${formatNumber(savings)}/mo
            </div>
            <div className="text-2xl text-cyan-400 font-semibold">{percent}% reduction in AI costs</div>
            <div className="mt-4 text-gray-500">
              That&apos;s{' '}
              <span className="text-green-400 font-bold">${formatNumber(savings * 12)}</span> back in your pocket per
              year
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
