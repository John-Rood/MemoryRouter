/**
 * Test Fixtures
 * 
 * Pre-defined test data for consistent testing
 */

// =============================================================================
// MESSAGES FIXTURES
// =============================================================================

export const messages = {
  // Simple conversation
  simple: [
    { role: 'user' as const, content: 'Hello, how are you?' },
  ],
  
  // Conversation with system message
  withSystem: [
    { role: 'system' as const, content: 'You are a helpful assistant.' },
    { role: 'user' as const, content: 'What is TypeScript?' },
  ],
  
  // Multi-turn conversation
  multiTurn: [
    { role: 'system' as const, content: 'You are a coding assistant.' },
    { role: 'user' as const, content: 'How do I sort an array in JavaScript?' },
    { role: 'assistant' as const, content: 'You can use the sort() method.' },
    { role: 'user' as const, content: 'Can you show me an example?' },
  ],
  
  // Selective memory conversation
  selectiveMemory: [
    { role: 'user' as const, content: 'My API key is sk-secret123', memory: false },
    { role: 'user' as const, content: 'Help me with authentication' },
    { role: 'assistant' as const, content: 'I can help with authentication.' },
    { role: 'user' as const, content: 'Here is the full codebase...', memory: false },
    { role: 'user' as const, content: 'Focus on the login function' },
  ],
  
  // Long context
  longContext: [
    { role: 'system' as const, content: 'You are an expert code reviewer.' },
    { role: 'user' as const, content: 'A'.repeat(10000) }, // ~2500 tokens
  ],
  
  // Image content (vision)
  withImage: [
    { 
      role: 'user' as const, 
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo...' } },
      ],
    },
  ],
};

// =============================================================================
// MEMORY CONTEXT FIXTURES
// =============================================================================

export const memoryContexts = {
  // Simple memory context
  simple: `User asked about React hooks.
Assistant explained useState and useEffect.
User prefers functional components.`,
  
  // Technical project context
  technicalProject: `User is building a REST API with Node.js.
Tech stack: Express, TypeScript, PostgreSQL.
Authentication uses JWT tokens.
User prefers async/await over callbacks.
The project follows clean architecture patterns.`,
  
  // Multi-session context
  multiSession: `Session 1 (3 days ago):
- User started learning TypeScript
- Asked about types vs interfaces

Session 2 (yesterday):
- User worked on React components
- Discussed state management options

Session 3 (2 hours ago):
- User is setting up testing
- Chose Vitest over Jest`,
  
  // Empty context
  empty: '',
  
  // Large context
  large: `${'Previous conversation context. '.repeat(500)}`,
};

// =============================================================================
// PROVIDER RESPONSES FIXTURES
// =============================================================================

export const providerResponses = {
  openai: {
    success: {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1677858242,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'This is a test response from OpenAI.',
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 20,
        total_tokens: 70,
      },
    },
    
    error: {
      error: {
        message: 'Rate limit exceeded',
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
      },
    },
  },
  
  anthropic: {
    success: {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'This is a test response from Anthropic.',
      }],
      model: 'claude-3-opus-20240229',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 50,
        output_tokens: 20,
      },
    },
    
    error: {
      type: 'error',
      error: {
        type: 'overloaded_error',
        message: 'Overloaded',
      },
    },
  },
};

// =============================================================================
// MEMORY KEY FIXTURES
// =============================================================================

// =============================================================================
// PROVIDER API KEYS (test fixtures)
// =============================================================================

export const providerKeys = {
  openai: {
    decrypted: 'sk-test-openai-key-1234567890abcdef',
    encrypted: 'encrypted_openai_key_base64', // Mock encrypted value
  },
  anthropic: {
    decrypted: 'sk-ant-test-anthropic-key-1234567890',
    encrypted: 'encrypted_anthropic_key_base64',
  },
  openrouter: {
    decrypted: 'sk-or-test-openrouter-key-abcdef',
    encrypted: 'encrypted_openrouter_key_base64',
  },
};

export const memoryKeys = {
  // Valid active key
  valid: {
    key: 'mk_test_project_abc123',
    userId: 'user_001',
    name: 'Test Project',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    lastUsedAt: new Date(),
  },
  
  // Inactive key
  inactive: {
    key: 'mk_inactive_key_xyz789',
    userId: 'user_001',
    name: 'Old Project',
    isActive: false,
    createdAt: new Date('2023-01-01'),
  },
  
  // Different user's key
  otherUser: {
    key: 'mk_other_user_key_456',
    userId: 'user_002',
    name: 'Other Project',
    isActive: true,
    createdAt: new Date('2024-01-15'),
  },
};

// =============================================================================
// USER FIXTURES
// =============================================================================

export const users = {
  // Free tier user
  free: {
    id: 'user_free_001',
    email: 'free@example.com',
    name: 'Free User',
    tier: 'free' as const,
    usedTokens: 3_000_000,
    quotaTokens: 50_000_000,
  },
  
  // Paid tier user
  paid: {
    id: 'user_paid_001',
    email: 'paid@example.com',
    name: 'Paid User',
    tier: 'paid' as const,
    stripeCustomerId: 'cus_paid123',
    stripeSubscriptionId: 'sub_paid123',
    usedTokens: 50_000_000,
    quotaTokens: Infinity,
  },
  
  // User at quota limit
  atLimit: {
    id: 'user_limit_001',
    email: 'limit@example.com',
    name: 'Limited User',
    tier: 'free' as const,
    usedTokens: 50_000_000,
    quotaTokens: 50_000_000,
  },
  
  // User over quota
  overQuota: {
    id: 'user_over_001',
    email: 'over@example.com',
    name: 'Over Quota User',
    tier: 'free' as const,
    usedTokens: 51_000_000,
    quotaTokens: 50_000_000,
  },
};

// =============================================================================
// MODELS FIXTURES
// =============================================================================

export const models = {
  openai: ['openai/gpt-4', 'openai/gpt-4-turbo', 'openai/gpt-3.5-turbo', 'gpt-4', 'o1-preview'],
  anthropic: ['anthropic/claude-3-opus', 'anthropic/claude-3-sonnet', 'claude-3-haiku'],
  google: ['google/gemini-pro', 'gemini-1.5-pro'],
  openrouter: ['meta-llama/llama-3-70b', 'mistral/mistral-large'],
  unknown: ['unknown/model-xyz', 'some-random-model'],
};

// =============================================================================
// TEMPORAL FIXTURES (for KRONOS tests)
// =============================================================================

export const temporalData = {
  // Timestamps for different windows
  timestamps: {
    hot: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
    working: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    longTerm: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    expired: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
  },
  
  // Natural language temporal queries
  queries: {
    yesterday: 'What did I work on yesterday?',
    lastWeek: 'What did we discuss last week?',
    threedays: 'What did I mention 3 days ago?',
    whenDid: 'When did I first mention TypeScript?',
    earlier: 'What did I say earlier about authentication?',
    nonTemporal: 'How do I sort an array?',
  },
};

// =============================================================================
// API REQUEST FIXTURES
// =============================================================================

export const apiRequests = {
  // Valid chat completion request
  valid: {
    model: 'openai/gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  },
  
  // Missing model
  missingModel: {
    messages: [{ role: 'user', content: 'Hello' }],
  },
  
  // Missing messages
  missingMessages: {
    model: 'openai/gpt-4',
  },
  
  // Empty messages
  emptyMessages: {
    model: 'openai/gpt-4',
    messages: [],
  },
  
  // Streaming request
  streaming: {
    model: 'openai/gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  },
  
  // With all options
  fullOptions: {
    model: 'openai/gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
    max_tokens: 1000,
    stream: false,
  },
};

// =============================================================================
// ERROR RESPONSES FIXTURES
// =============================================================================

export const errorResponses = {
  unauthorized: {
    status: 401,
    body: {
      error: 'Invalid or inactive memory key',
      hint: 'Memory keys start with mk_',
    },
  },
  
  badRequest: {
    status: 400,
    body: {
      error: 'Missing required field: model',
    },
  },
  
  quotaExceeded: {
    status: 429,
    body: {
      error: {
        code: 'quota_exceeded',
        message: 'Free tier quota exceeded. Please upgrade to continue.',
        upgrade_url: 'https://memoryrouter.ai/pricing',
      },
    },
  },
  
  providerError: {
    status: 502,
    body: {
      error: 'Failed to connect to provider',
      details: 'Provider returned error',
    },
  },
};
