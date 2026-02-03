'use client'

import { useState } from 'react'

const providers = ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'cohere'] as const

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  cohere: 'Cohere',
}

const providerExamples: Record<string, { python: string; typescript: string }> = {
  openai: {
    python: `from openai import OpenAI

client = OpenAI(
    api_key="mk_xxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)`,
    typescript: `import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxx',  // Your Memory Key
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'openai/gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }]
});`
  },
  anthropic: {
    python: `from anthropic import Anthropic

client = Anthropic(
    api_key="mk_xxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai"
)

message = client.messages.create(
    model="anthropic/claude-3-5-sonnet",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)`,
    typescript: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
    apiKey: 'mk_xxx',  // Your Memory Key
    baseURL: 'https://api.memoryrouter.ai'
});

const message = await client.messages.create({
    model: 'anthropic/claude-3-5-sonnet',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
});`
  },
  google: {
    python: `from openai import OpenAI

client = OpenAI(
    api_key="mk_xxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="google/gemini-2.0-flash",
    messages=[{"role": "user", "content": "Hello!"}]
)`,
    typescript: `import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxx',  // Your Memory Key
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'google/gemini-2.0-flash',
    messages: [{ role: 'user', content: 'Hello!' }]
});`
  },
  xai: {
    python: `from openai import OpenAI

client = OpenAI(
    api_key="mk_xxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="xai/grok-beta",
    messages=[{"role": "user", "content": "Hello!"}]
)`,
    typescript: `import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxx',  // Your Memory Key
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'xai/grok-beta',
    messages: [{ role: 'user', content: 'Hello!' }]
});`
  },
  deepseek: {
    python: `from openai import OpenAI

client = OpenAI(
    api_key="mk_xxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="deepseek/deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}]
)`,
    typescript: `import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxx',  // Your Memory Key
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'deepseek/deepseek-chat',
    messages: [{ role: 'user', content: 'Hello!' }]
});`
  },
  mistral: {
    python: `from openai import OpenAI

client = OpenAI(
    api_key="mk_xxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="mistral/mistral-large",
    messages=[{"role": "user", "content": "Hello!"}]
)`,
    typescript: `import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxx',  // Your Memory Key
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'mistral/mistral-large',
    messages: [{ role: 'user', content: 'Hello!' }]
});`
  },
  cohere: {
    python: `from openai import OpenAI

client = OpenAI(
    api_key="mk_xxx",  # Your Memory Key
    base_url="https://api.memoryrouter.ai/v1"
)

response = client.chat.completions.create(
    model="cohere/command-r-plus",
    messages=[{"role": "user", "content": "Hello!"}]
)`,
    typescript: `import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: 'mk_xxx',  // Your Memory Key
    baseURL: 'https://api.memoryrouter.ai/v1'
});

const response = await client.chat.completions.create({
    model: 'cohere/command-r-plus',
    messages: [{ role: 'user', content: 'Hello!' }]
});`
  },
}

export function CodeSwitcher() {
  const [activeProvider, setActiveProvider] = useState<string>('openai')
  const [activeTab, setActiveTab] = useState<'python' | 'typescript'>('python')
  
  return (
    <div className="card-glass rounded-2xl overflow-hidden">
      {/* Provider Tabs */}
      <div className="flex flex-wrap gap-2 p-4 border-b border-white/5 bg-white/[0.02]">
        {providers.map((provider) => (
          <button
            key={provider}
            onClick={() => setActiveProvider(provider)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeProvider === provider
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {providerLabels[provider]}
          </button>
        ))}
      </div>
      
      {/* Language Tabs */}
      <div className="flex gap-2 p-4 border-b border-white/5">
        <button
          onClick={() => setActiveTab('python')}
          className={`px-3 py-1.5 rounded text-sm transition-all ${
            activeTab === 'python'
              ? 'bg-white/10 text-white'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Python
        </button>
        <button
          onClick={() => setActiveTab('typescript')}
          className={`px-3 py-1.5 rounded text-sm transition-all ${
            activeTab === 'typescript'
              ? 'bg-white/10 text-white'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          TypeScript
        </button>
      </div>
      
      {/* Code Block */}
      <div className="p-6 font-mono text-sm overflow-x-auto">
        <pre className="text-gray-300">
          <code>{providerExamples[activeProvider][activeTab]}</code>
        </pre>
      </div>
    </div>
  )
}
