'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'

interface Message {
  role: 'user' | 'assistant'
  content: string
  mrTime?: number
  totalTime?: number
  isError?: boolean
}

interface LatencyStats {
  mrProcessingTimes: number[]
  providerTimes: number[]
  totalTimes: number[]
  successCount: number
  failCount: number
}

const API_BASE = 'https://api.memoryrouter.ai'

const testPrompts = [
  "What is 2+2?",
  "Say hello in 3 words.",
  "What color is the sky?",
  "Count to 5.",
  "Name a fruit."
]

export default function PlaygroundPage() {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('openai/gpt-4o')
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [currentMR, setCurrentMR] = useState<number | null>(null)
  const [currentTotal, setCurrentTotal] = useState<number | null>(null)
  const [isBenchmarking, setIsBenchmarking] = useState(false)
  const [benchmarkProgress, setBenchmarkProgress] = useState(0)
  
  const [stats, setStats] = useState<LatencyStats>({
    mrProcessingTimes: [],
    providerTimes: [],
    totalTimes: [],
    successCount: 0,
    failCount: 0
  })
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  
  // Load config from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem('memoryrouter_apikey')
    const savedModel = localStorage.getItem('memoryrouter_model')
    if (savedKey) setApiKey(savedKey)
    if (savedModel) setModel(savedModel)
  }, [])
  
  // Save config to localStorage
  useEffect(() => {
    if (apiKey) localStorage.setItem('memoryrouter_apikey', apiKey)
    if (model) localStorage.setItem('memoryrouter_model', model)
  }, [apiKey, model])
  
  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])
  
  const getContextMessages = () => {
    return messages.slice(-3).map(m => ({
      role: m.role,
      content: m.content
    }))
  }
  
  const updateStats = (mrTime: number | null, providerTime: number | null, totalTime: number | null, success: boolean) => {
    setStats(prev => {
      const newStats = { ...prev }
      if (mrTime !== null && providerTime !== null && totalTime !== null) {
        newStats.mrProcessingTimes = [...prev.mrProcessingTimes, mrTime]
        newStats.providerTimes = [...prev.providerTimes, providerTime]
        newStats.totalTimes = [...prev.totalTimes, totalTime]
      }
      if (success) newStats.successCount++
      else newStats.failCount++
      return newStats
    })
  }
  
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  
  const sendMessage = useCallback(async (messageText?: string) => {
    const userMessage = messageText || inputValue.trim()
    if (!userMessage) return
    
    if (!apiKey) {
      alert('Please enter your MemoryRouter API key')
      return
    }
    
    if (!model) {
      alert('Please enter a model')
      return
    }
    
    setInputValue('')
    setIsLoading(true)
    setIsStreaming(true)
    setStreamingContent('')
    setCurrentMR(null)
    setCurrentTotal(null)
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    
    // Build context
    const contextMessages = getContextMessages()
    const apiMessages = [
      ...contextMessages.slice(0, -1),
      { role: 'user', content: userMessage }
    ]
    
    const startTime = performance.now()
    let mrProcessingMs = 0
    let providerMs = 0
    let fullResponse = ''
    
    try {
      const response = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true
        })
      })
      
      mrProcessingMs = parseInt(response.headers.get('X-MR-Processing-Ms') || '0')
      providerMs = parseInt(response.headers.get('X-Provider-Response-Ms') || '0')
      setCurrentMR(mrProcessingMs)
      
      if (!response.ok) {
        const endTime = performance.now()
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }))
        const errorMsg = errorData.error?.message || errorData.error?.provider_error?.error?.message || 'Request failed'
        
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `Error: ${errorMsg}`,
          isError: true,
          totalTime: endTime - startTime
        }])
        updateStats(null, null, null, false)
        setIsStreaming(false)
        setIsLoading(false)
        return
      }
      
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')
      
      const decoder = new TextDecoder()
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6))
              const content = data.choices?.[0]?.delta?.content
              const anthropicContent = data.delta?.text
              
              if (content) fullResponse += content
              if (anthropicContent) fullResponse += anthropicContent
              
              if (content || anthropicContent) {
                setStreamingContent(fullResponse)
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
      
      const endTime = performance.now()
      const totalTime = endTime - startTime
      setCurrentTotal(totalTime)
      
      // Add assistant message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fullResponse,
        mrTime: mrProcessingMs,
        totalTime
      }])
      
      updateStats(mrProcessingMs, providerMs, totalTime, true)
      
    } catch (error) {
      const endTime = performance.now()
      const totalTime = endTime - startTime
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true,
        totalTime
      }])
      updateStats(null, null, null, false)
    } finally {
      setIsStreaming(false)
      setIsLoading(false)
      setStreamingContent('')
      inputRef.current?.focus()
    }
  }, [inputValue, apiKey, model, messages])
  
  const runBenchmark = async () => {
    if (!apiKey || !model) {
      alert('Please enter your API key and model first')
      return
    }
    
    setIsBenchmarking(true)
    
    for (let i = 0; i < testPrompts.length; i++) {
      setBenchmarkProgress(i + 1)
      await sendMessage(testPrompts[i])
      await new Promise(r => setTimeout(r, 500))
    }
    
    setIsBenchmarking(false)
    setBenchmarkProgress(0)
    
    const avgMR = Math.round(avg(stats.mrProcessingTimes))
    alert(`Benchmark complete!\n\nAvg MR Processing: ${avgMR}ms`)
  }
  
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }
  
  const getMRColor = (ms: number) => {
    if (ms > 500) return 'text-red-400'
    if (ms > 200) return 'text-yellow-400'
    return 'text-green-400'
  }
  
  const lastMR = stats.mrProcessingTimes[stats.mrProcessingTimes.length - 1]
  const lastProvider = stats.providerTimes[stats.providerTimes.length - 1]
  const lastTotal = stats.totalTimes[stats.totalTimes.length - 1]

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Header */}
      <header className="bg-[#13131a] border-b border-white/10 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition">
            <Image src="/logo.png" alt="MemoryRouter" width={32} height={32} className="rounded-lg" />
            <h1 className="text-xl font-bold">Memory<span className="text-green-400">Router</span></h1>
            <span className="text-sm text-gray-500 ml-2 pl-2 border-l border-white/10">Playground</span>
          </Link>
          
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500 uppercase tracking-wide">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="mk_xxxxxxxx"
                className="bg-[#1a1a24] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono w-[200px] focus:border-green-500/50 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500 uppercase tracking-wide">Model</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="openai/gpt-4o"
                className="bg-[#1a1a24] border border-white/10 rounded-lg px-3 py-2 text-sm w-[180px] focus:border-green-500/50 focus:outline-none"
              />
            </div>
            <button
              onClick={runBenchmark}
              disabled={isBenchmarking || isLoading}
              className="self-end h-[42px] px-5 bg-[#1a1a24] border border-green-500 text-green-400 rounded-lg font-semibold text-sm hover:bg-green-500 hover:text-black transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBenchmarking ? `⏳ ${benchmarkProgress}/5...` : '🚀 Benchmark'}
            </button>
          </div>
        </div>
      </header>
      
      {/* Latency Panel */}
      <div className="bg-gradient-to-br from-[#13131a] to-[#1a1a24] border-b border-white/10 px-6 py-5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide">⚡ Latency Metrics</h2>
            <span className="bg-green-500/15 text-green-400 text-[11px] px-2 py-0.5 rounded font-medium">STREAMING</span>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            {/* Hero: MR Processing */}
            <div className={`bg-[#0a0a0f] border rounded-xl p-4 ${lastMR && lastMR > 500 ? 'border-red-500/50' : lastMR && lastMR > 200 ? 'border-yellow-500/50' : 'border-green-500/30'} bg-gradient-to-br from-green-500/5 to-transparent`}>
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">MR Processing</div>
              <div className={`text-3xl font-bold ${lastMR ? getMRColor(lastMR) : 'text-green-400'}`}>
                {lastMR ? Math.round(lastMR) : '—'}<span className="text-sm font-normal ml-0.5">ms</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">Our overhead</div>
            </div>
            
            <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">AI Provider</div>
              <div className="text-2xl font-bold text-green-400">
                {lastProvider ? Math.round(lastProvider) : '—'}<span className="text-sm font-normal ml-0.5">ms</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">OpenAI/Anthropic</div>
            </div>
            
            <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Total Time</div>
              <div className="text-2xl font-bold text-green-400">
                {lastTotal ? Math.round(lastTotal) : '—'}<span className="text-sm font-normal ml-0.5">ms</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">End to end</div>
            </div>
            
            <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Avg MR</div>
              <div className="text-2xl font-bold text-green-400">
                {stats.mrProcessingTimes.length ? Math.round(avg(stats.mrProcessingTimes)) : '—'}<span className="text-sm font-normal ml-0.5">ms</span>
              </div>
            </div>
            
            <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Avg Provider</div>
              <div className="text-2xl font-bold text-green-400">
                {stats.providerTimes.length ? Math.round(avg(stats.providerTimes)) : '—'}<span className="text-sm font-normal ml-0.5">ms</span>
              </div>
            </div>
            
            <div className="bg-[#0a0a0f] border border-white/10 rounded-xl p-4">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Avg Total</div>
              <div className="text-2xl font-bold text-green-400">
                {stats.totalTimes.length ? Math.round(avg(stats.totalTimes)) : '—'}<span className="text-sm font-normal ml-0.5">ms</span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-6 mt-4 pt-4 border-t border-white/10 text-sm">
            <div><span className="text-gray-500">Requests:</span> <span className="font-semibold">{stats.successCount + stats.failCount}</span></div>
            <div><span className="text-gray-500">Success:</span> <span className="font-semibold text-green-400">{stats.successCount}</span></div>
            <div><span className="text-gray-500">Failed:</span> <span className="font-semibold text-red-400">{stats.failCount}</span></div>
          </div>
        </div>
      </div>
      
      {/* Chat Container */}
      <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-6">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-6">
          {messages.length === 0 && !isStreaming && (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4 py-12">
              <svg className="w-16 h-16 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h2 className="text-lg font-medium text-white">Test MemoryRouter Latency</h2>
              <p className="text-sm text-center max-w-md">
                Measures <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">MR Processing</code> — the latency MemoryRouter adds.
                <br /><br />
                Last 3 messages sent as context. Uses streaming to measure real latency.
              </p>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <div key={i} className={`flex flex-col gap-2 max-w-[85%] ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
              <div className={`flex items-center gap-2 text-xs text-gray-500 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                <span className="font-semibold uppercase tracking-wide">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                {msg.mrTime !== undefined && (
                  <span className="font-mono">
                    <span className="text-green-400">MR: {Math.round(msg.mrTime)}ms</span>
                    {msg.totalTime && <span className="text-gray-500"> · Total: {formatTime(msg.totalTime)}</span>}
                  </span>
                )}
              </div>
              <div className={`px-4 py-3 rounded-xl text-[15px] leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user' 
                  ? 'bg-[#1e3a5f] rounded-br-sm' 
                  : msg.isError 
                    ? 'bg-red-500/10 border border-red-500 text-red-400 rounded-bl-sm'
                    : 'bg-[#1a1a24] border border-white/10 rounded-bl-sm'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          
          {/* Streaming message */}
          {isStreaming && (
            <div className="flex flex-col gap-2 max-w-[85%] self-start">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="font-semibold uppercase tracking-wide">Assistant</span>
                {currentMR !== null && (
                  <span className="font-mono text-green-400">MR: {Math.round(currentMR)}ms</span>
                )}
              </div>
              <div className="bg-[#1a1a24] border border-white/10 rounded-xl rounded-bl-sm px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                {streamingContent || ''}
                <span className="inline-block w-2 h-4 bg-green-400 ml-0.5 animate-pulse" />
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
        
        {/* Context info */}
        {messages.length > 0 && (
          <div className="text-xs text-gray-500 text-center py-2">
            Sending <span className="text-green-400">{Math.min(messages.length, 3)}</span> messages as context
          </div>
        )}
        
        {/* Input */}
        <div className="flex gap-3 bg-[#13131a] p-4 rounded-xl border border-white/10">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!isLoading) sendMessage()
              }
            }}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 bg-[#1a1a24] border border-white/10 rounded-lg px-4 py-3 text-[15px] focus:border-green-500/50 focus:outline-none resize-none min-h-[48px] max-h-[150px]"
          />
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !inputValue.trim()}
            className="bg-green-500 text-black px-6 py-3 rounded-lg font-semibold text-[15px] hover:bg-green-400 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            Send
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
