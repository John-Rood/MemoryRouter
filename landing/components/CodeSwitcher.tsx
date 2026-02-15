'use client'

import { useState } from 'react'

const providers = ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'cohere'] as const

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
  xai: 'xAI (Grok)',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  cohere: 'Cohere',
}

// Syntax highlighted code blocks matching index.html exactly
const providerCode: Record<string, { python: React.ReactNode; typescript: React.ReactNode }> = {
  openai: {
    python: (
      <>
        <span className="text-gray-500"># pip install openai</span>{'\n'}
        <span className="text-purple-400">from</span> openai <span className="text-purple-400">import</span> OpenAI{'\n\n'}
        <span className="text-gray-500"># Memory key = isolated context</span>{'\n'}
        client = OpenAI({'\n'}
        {'    '}base_url=<span className="text-green-400">"https://api.memoryrouter.ai/v1"</span>,{'\n'}
        {'    '}api_key=<span className="text-green-400">"mk_your-memory-key"</span>{'\n'}
        ){'\n\n'}
        <span className="text-gray-500"># That's it. AI now remembers this user.</span>{'\n'}
        response = client.chat.completions.create({'\n'}
        {'    '}model=<span className="text-green-400">"gpt-5.2"</span>,{'\n'}
        {'    '}messages=[{'{'}<span className="text-green-400">"role"</span>: <span className="text-green-400">"user"</span>, <span className="text-green-400">"content"</span>: <span className="text-green-400">"..."</span>{'}'}]{'\n'}
        )
      </>
    ),
    typescript: (
      <>
        <span className="text-gray-500">// npm install openai</span>{'\n'}
        <span className="text-purple-400">import</span> OpenAI <span className="text-purple-400">from</span> <span className="text-green-400">'openai'</span>;{'\n\n'}
        <span className="text-gray-500">// Each key = separate memory context</span>{'\n'}
        <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> OpenAI({'{'}){'\n'}
        {'  '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai/v1'</span>,{'\n'}
        {'  '}apiKey: <span className="text-green-400">'mk_your-memory-key'</span>{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">// Same API. Memory handled automatically.</span>{'\n'}
        <span className="text-purple-400">const</span> response = <span className="text-purple-400">await</span> client.chat.completions.create({'{'}){'\n'}
        {'  '}model: <span className="text-green-400">'gpt-5.2'</span>,{'\n'}
        {'  '}messages: [{'{'}role: <span className="text-green-400">'user'</span>, content: <span className="text-green-400">'...'</span>{'}'}]{'\n'}
        {'}'});
      </>
    ),
  },
  anthropic: {
    python: (
      <>
        <span className="text-gray-500"># pip install anthropic</span>{'\n'}
        <span className="text-purple-400">from</span> anthropic <span className="text-purple-400">import</span> Anthropic{'\n\n'}
        <span className="text-gray-500"># Memory key = isolated context</span>{'\n'}
        client = Anthropic({'\n'}
        {'    '}base_url=<span className="text-green-400">"https://api.memoryrouter.ai"</span>,{'\n'}
        {'    '}api_key=<span className="text-green-400">"mk_your-memory-key"</span>{'\n'}
        ){'\n\n'}
        <span className="text-gray-500"># That's it. AI now remembers this user.</span>{'\n'}
        message = client.messages.create({'\n'}
        {'    '}model=<span className="text-green-400">"claude-opus-4-6"</span>,{'\n'}
        {'    '}max_tokens=<span className="text-cyan-400">1024</span>,{'\n'}
        {'    '}messages=[{'{'}<span className="text-green-400">"role"</span>: <span className="text-green-400">"user"</span>, <span className="text-green-400">"content"</span>: <span className="text-green-400">"..."</span>{'}'}]{'\n'}
        )
      </>
    ),
    typescript: (
      <>
        <span className="text-gray-500">// npm install @anthropic-ai/sdk</span>{'\n'}
        <span className="text-purple-400">import</span> Anthropic <span className="text-purple-400">from</span> <span className="text-green-400">'@anthropic-ai/sdk'</span>;{'\n\n'}
        <span className="text-gray-500">// Each key = separate memory context</span>{'\n'}
        <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> Anthropic({'{'}){'\n'}
        {'  '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai'</span>,{'\n'}
        {'  '}apiKey: <span className="text-green-400">'mk_your-memory-key'</span>{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">// Same API. Memory handled automatically.</span>{'\n'}
        <span className="text-purple-400">const</span> message = <span className="text-purple-400">await</span> client.messages.create({'{'}){'\n'}
        {'  '}model: <span className="text-green-400">'claude-opus-4-6'</span>,{'\n'}
        {'  '}max_tokens: <span className="text-cyan-400">1024</span>,{'\n'}
        {'  '}messages: [{'{'}role: <span className="text-green-400">'user'</span>, content: <span className="text-green-400">'...'</span>{'}'}]{'\n'}
        {'}'});
      </>
    ),
  },
  google: {
    python: (
      <>
        <span className="text-gray-500"># pip install openai</span>{'\n'}
        <span className="text-purple-400">from</span> openai <span className="text-purple-400">import</span> OpenAI{'\n\n'}
        <span className="text-gray-500"># Memory key = isolated context</span>{'\n'}
        client = OpenAI({'\n'}
        {'    '}base_url=<span className="text-green-400">"https://api.memoryrouter.ai/v1"</span>,{'\n'}
        {'    '}api_key=<span className="text-green-400">"mk_your-memory-key"</span>{'\n'}
        ){'\n\n'}
        <span className="text-gray-500"># That's it. AI now remembers this user.</span>{'\n'}
        response = client.chat.completions.create({'\n'}
        {'    '}model=<span className="text-green-400">"gemini-3-pro"</span>,{'\n'}
        {'    '}messages=[{'{'}<span className="text-green-400">"role"</span>: <span className="text-green-400">"user"</span>, <span className="text-green-400">"content"</span>: <span className="text-green-400">"..."</span>{'}'}]{'\n'}
        )
      </>
    ),
    typescript: (
      <>
        <span className="text-gray-500">// npm install openai</span>{'\n'}
        <span className="text-purple-400">import</span> OpenAI <span className="text-purple-400">from</span> <span className="text-green-400">'openai'</span>;{'\n\n'}
        <span className="text-gray-500">// Each key = separate memory context</span>{'\n'}
        <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> OpenAI({'{'}){'\n'}
        {'  '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai/v1'</span>,{'\n'}
        {'  '}apiKey: <span className="text-green-400">'mk_your-memory-key'</span>{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">// Same API. Memory handled automatically.</span>{'\n'}
        <span className="text-purple-400">const</span> response = <span className="text-purple-400">await</span> client.chat.completions.create({'{'}){'\n'}
        {'  '}model: <span className="text-green-400">'gemini-3-pro'</span>,{'\n'}
        {'  '}messages: [{'{'}role: <span className="text-green-400">'user'</span>, content: <span className="text-green-400">'...'</span>{'}'}]{'\n'}
        {'}'});
      </>
    ),
  },
  xai: {
    python: (
      <>
        <span className="text-gray-500"># pip install openai</span>{'\n'}
        <span className="text-purple-400">from</span> openai <span className="text-purple-400">import</span> OpenAI{'\n\n'}
        <span className="text-gray-500"># Memory key = isolated context</span>{'\n'}
        client = OpenAI({'\n'}
        {'    '}base_url=<span className="text-green-400">"https://api.memoryrouter.ai/v1"</span>,{'\n'}
        {'    '}api_key=<span className="text-green-400">"mk_your-memory-key"</span>{'\n'}
        ){'\n\n'}
        <span className="text-gray-500"># That's it. AI now remembers this user.</span>{'\n'}
        response = client.chat.completions.create({'\n'}
        {'    '}model=<span className="text-green-400">"grok-4"</span>,{'\n'}
        {'    '}messages=[{'{'}<span className="text-green-400">"role"</span>: <span className="text-green-400">"user"</span>, <span className="text-green-400">"content"</span>: <span className="text-green-400">"..."</span>{'}'}]{'\n'}
        )
      </>
    ),
    typescript: (
      <>
        <span className="text-gray-500">// npm install openai</span>{'\n'}
        <span className="text-purple-400">import</span> OpenAI <span className="text-purple-400">from</span> <span className="text-green-400">'openai'</span>;{'\n\n'}
        <span className="text-gray-500">// Each key = separate memory context</span>{'\n'}
        <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> OpenAI({'{'}){'\n'}
        {'  '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai/v1'</span>,{'\n'}
        {'  '}apiKey: <span className="text-green-400">'mk_your-memory-key'</span>{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">// Same API. Memory handled automatically.</span>{'\n'}
        <span className="text-purple-400">const</span> response = <span className="text-purple-400">await</span> client.chat.completions.create({'{'}){'\n'}
        {'  '}model: <span className="text-green-400">'grok-4'</span>,{'\n'}
        {'  '}messages: [{'{'}role: <span className="text-green-400">'user'</span>, content: <span className="text-green-400">'...'</span>{'}'}]{'\n'}
        {'}'});
      </>
    ),
  },
  deepseek: {
    python: (
      <>
        <span className="text-gray-500"># pip install openai</span>{'\n'}
        <span className="text-purple-400">from</span> openai <span className="text-purple-400">import</span> OpenAI{'\n\n'}
        <span className="text-gray-500"># Memory key = isolated context</span>{'\n'}
        client = OpenAI({'\n'}
        {'    '}base_url=<span className="text-green-400">"https://api.memoryrouter.ai/v1"</span>,{'\n'}
        {'    '}api_key=<span className="text-green-400">"mk_your-memory-key"</span>{'\n'}
        ){'\n\n'}
        <span className="text-gray-500"># That's it. AI now remembers this user.</span>{'\n'}
        response = client.chat.completions.create({'\n'}
        {'    '}model=<span className="text-green-400">"deepseek-v3"</span>,{'\n'}
        {'    '}messages=[{'{'}<span className="text-green-400">"role"</span>: <span className="text-green-400">"user"</span>, <span className="text-green-400">"content"</span>: <span className="text-green-400">"..."</span>{'}'}]{'\n'}
        )
      </>
    ),
    typescript: (
      <>
        <span className="text-gray-500">// npm install openai</span>{'\n'}
        <span className="text-purple-400">import</span> OpenAI <span className="text-purple-400">from</span> <span className="text-green-400">'openai'</span>;{'\n\n'}
        <span className="text-gray-500">// Each key = separate memory context</span>{'\n'}
        <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> OpenAI({'{'}){'\n'}
        {'  '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai/v1'</span>,{'\n'}
        {'  '}apiKey: <span className="text-green-400">'mk_your-memory-key'</span>{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">// Same API. Memory handled automatically.</span>{'\n'}
        <span className="text-purple-400">const</span> response = <span className="text-purple-400">await</span> client.chat.completions.create({'{'}){'\n'}
        {'  '}model: <span className="text-green-400">'deepseek-v3'</span>,{'\n'}
        {'  '}messages: [{'{'}role: <span className="text-green-400">'user'</span>, content: <span className="text-green-400">'...'</span>{'}'}]{'\n'}
        {'}'});
      </>
    ),
  },
  mistral: {
    python: (
      <>
        <span className="text-gray-500"># pip install openai</span>{'\n'}
        <span className="text-purple-400">from</span> openai <span className="text-purple-400">import</span> OpenAI{'\n\n'}
        <span className="text-gray-500"># Memory key = isolated context</span>{'\n'}
        client = OpenAI({'\n'}
        {'    '}base_url=<span className="text-green-400">"https://api.memoryrouter.ai/v1"</span>,{'\n'}
        {'    '}api_key=<span className="text-green-400">"mk_your-memory-key"</span>{'\n'}
        ){'\n\n'}
        <span className="text-gray-500"># That's it. AI now remembers this user.</span>{'\n'}
        response = client.chat.completions.create({'\n'}
        {'    '}model=<span className="text-green-400">"mistral-large-3"</span>,{'\n'}
        {'    '}messages=[{'{'}<span className="text-green-400">"role"</span>: <span className="text-green-400">"user"</span>, <span className="text-green-400">"content"</span>: <span className="text-green-400">"..."</span>{'}'}]{'\n'}
        )
      </>
    ),
    typescript: (
      <>
        <span className="text-gray-500">// npm install openai</span>{'\n'}
        <span className="text-purple-400">import</span> OpenAI <span className="text-purple-400">from</span> <span className="text-green-400">'openai'</span>;{'\n\n'}
        <span className="text-gray-500">// Each key = separate memory context</span>{'\n'}
        <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> OpenAI({'{'}){'\n'}
        {'  '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai/v1'</span>,{'\n'}
        {'  '}apiKey: <span className="text-green-400">'mk_your-memory-key'</span>{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">// Same API. Memory handled automatically.</span>{'\n'}
        <span className="text-purple-400">const</span> response = <span className="text-purple-400">await</span> client.chat.completions.create({'{'}){'\n'}
        {'  '}model: <span className="text-green-400">'mistral-large-3'</span>,{'\n'}
        {'  '}messages: [{'{'}role: <span className="text-green-400">'user'</span>, content: <span className="text-green-400">'...'</span>{'}'}]{'\n'}
        {'}'});
      </>
    ),
  },
  cohere: {
    python: (
      <>
        <span className="text-gray-500"># pip install openai</span>{'\n'}
        <span className="text-purple-400">from</span> openai <span className="text-purple-400">import</span> OpenAI{'\n\n'}
        <span className="text-gray-500"># Memory key = isolated context</span>{'\n'}
        client = OpenAI({'\n'}
        {'    '}base_url=<span className="text-green-400">"https://api.memoryrouter.ai/v1"</span>,{'\n'}
        {'    '}api_key=<span className="text-green-400">"mk_your-memory-key"</span>{'\n'}
        ){'\n\n'}
        <span className="text-gray-500"># That's it. AI now remembers this user.</span>{'\n'}
        response = client.chat.completions.create({'\n'}
        {'    '}model=<span className="text-green-400">"command-a"</span>,{'\n'}
        {'    '}messages=[{'{'}<span className="text-green-400">"role"</span>: <span className="text-green-400">"user"</span>, <span className="text-green-400">"content"</span>: <span className="text-green-400">"..."</span>{'}'}]{'\n'}
        )
      </>
    ),
    typescript: (
      <>
        <span className="text-gray-500">// npm install openai</span>{'\n'}
        <span className="text-purple-400">import</span> OpenAI <span className="text-purple-400">from</span> <span className="text-green-400">'openai'</span>;{'\n\n'}
        <span className="text-gray-500">// Each key = separate memory context</span>{'\n'}
        <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> OpenAI({'{'}){'\n'}
        {'  '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai/v1'</span>,{'\n'}
        {'  '}apiKey: <span className="text-green-400">'mk_your-memory-key'</span>{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">// Same API. Memory handled automatically.</span>{'\n'}
        <span className="text-purple-400">const</span> response = <span className="text-purple-400">await</span> client.chat.completions.create({'{'}){'\n'}
        {'  '}model: <span className="text-green-400">'command-a'</span>,{'\n'}
        {'  '}messages: [{'{'}role: <span className="text-green-400">'user'</span>, content: <span className="text-green-400">'...'</span>{'}'}]{'\n'}
        {'}'});
      </>
    ),
  },
}

export function CodeSwitcher() {
  const [activeProvider, setActiveProvider] = useState<string>('openai')
  
  return (
    <>
      {/* Provider Selector */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {providers.map((provider) => (
          <button
            key={provider}
            onClick={() => setActiveProvider(provider)}
            className={`provider-btn px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeProvider === provider ? 'provider-btn-active' : ''
            }`}
          >
            {providerLabels[provider]}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Python */}
        <div className="code-window rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10 bg-white/5">
            <span className="text-yellow-400 font-mono text-sm font-bold">Python</span>
          </div>
          <div className="p-5 text-sm overflow-x-auto">
            <pre className="font-mono"><code>{providerCode[activeProvider].python}</code></pre>
          </div>
        </div>

        {/* TypeScript */}
        <div className="code-window rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10 bg-white/5">
            <span className="text-blue-400 font-mono text-sm font-bold">TypeScript</span>
          </div>
          <div className="p-5 text-sm overflow-x-auto">
            <pre className="font-mono"><code>{providerCode[activeProvider].typescript}</code></pre>
          </div>
        </div>

        {/* Multi-tenant */}
        <div className="code-window rounded-2xl overflow-hidden lg:col-span-2">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10 bg-white/5">
            <span className="text-purple-400 font-mono text-sm font-bold">Multi-Tenant Pattern</span>
            <span className="text-gray-500 text-sm">— One memory per user</span>
          </div>
          <div className="p-5 text-sm overflow-x-auto">
            <pre className="font-mono"><code>
              <span className="text-gray-500">// SaaS pattern: each user gets isolated memory</span>{'\n'}
              <span className="text-purple-400">function</span> <span className="text-cyan-400">getClientForUser</span>(userId: <span className="text-yellow-400">string</span>) {'{'}{'\n'}
              {'  '}<span className="text-purple-400">return new</span> OpenAI({'{'}{'\n'}
              {'    '}baseURL: <span className="text-green-400">'https://api.memoryrouter.ai/v1'</span>,{'\n'}
              {'    '}apiKey: userMemoryKeys[userId]  <span className="text-gray-500">// Per-user memory isolation</span>{'\n'}
              {'  '}{'}'});{'\n'}
              {'}'}{'\n\n'}
              <span className="text-gray-500">// User A: "I prefer dark mode and brief responses"</span>{'\n'}
              <span className="text-gray-500">// User B: "I like detailed explanations with examples"</span>{'\n'}
              <span className="text-gray-500">// Each gets a personalized AI - memories never leak between users</span>
            </code></pre>
          </div>
        </div>
      </div>
    </>
  )
}
