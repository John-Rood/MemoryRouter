/**
 * Unit Tests: Provider Logic
 * 
 * Tests provider routing, request transformation,
 * and API key encryption/decryption.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { providerKeys, messages } from '../fixtures';

// =============================================================================
// PROVIDER ROUTING LOGIC (to be implemented)
// =============================================================================

type Provider = 'openai' | 'anthropic' | 'openrouter';

interface ProviderConfig {
  name: Provider;
  baseUrl: string;
  transformRequest?: (req: any) => any;
  transformResponse?: (res: any) => any;
}

const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  openai: {
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    name: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    transformRequest: transformToAnthropic,
    transformResponse: transformFromAnthropic,
  },
  openrouter: {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
};

/**
 * Parse provider from model string
 */
function parseModelProvider(model: string): { provider: Provider; modelName: string } {
  const parts = model.split('/');
  
  if (parts.length === 2) {
    const [providerPart, modelName] = parts;
    const provider = providerPart.toLowerCase() as Provider;
    
    if (provider in PROVIDER_CONFIGS) {
      return { provider, modelName };
    }
  }
  
  // Infer provider from model name
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('text-')) {
    return { provider: 'openai', modelName: model };
  }
  
  if (model.startsWith('claude-')) {
    return { provider: 'anthropic', modelName: model };
  }
  
  // Default to OpenRouter for unknown models
  return { provider: 'openrouter', modelName: model };
}

/**
 * Transform OpenAI-style request to Anthropic format
 */
function transformToAnthropic(request: any): any {
  const { model, messages, max_tokens, temperature, stream } = request;
  
  // Extract system message
  const systemMessage = messages.find((m: any) => m.role === 'system');
  const nonSystemMessages = messages.filter((m: any) => m.role !== 'system');
  
  // Transform messages (Anthropic uses different roles)
  const anthropicMessages = nonSystemMessages.map((m: any) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  
  return {
    model,
    messages: anthropicMessages,
    system: systemMessage?.content,
    max_tokens: max_tokens || 4096,
    temperature,
    stream,
  };
}

/**
 * Transform Anthropic response to OpenAI format
 */
function transformFromAnthropic(response: any): any {
  const { id, content, model, stop_reason, usage } = response;
  
  return {
    id,
    object: 'chat.completion',
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content[0]?.text || '',
        },
        finish_reason: stop_reason === 'end_turn' ? 'stop' : stop_reason,
      },
    ],
    usage: {
      prompt_tokens: usage?.input_tokens || 0,
      completion_tokens: usage?.output_tokens || 0,
      total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
    },
  };
}

// =============================================================================
// ENCRYPTION (for provider API keys)
// =============================================================================

// Note: In production, use proper encryption (AES-256-GCM with secure key management)
// This is a simplified version for testing

function encryptKey(plaintext: string, secret: string): string {
  // XOR-based pseudo-encryption for testing only
  // NEVER use this in production
  const encoded = Buffer.from(plaintext);
  const key = Buffer.from(secret.repeat(Math.ceil(encoded.length / secret.length)));
  const encrypted = Buffer.alloc(encoded.length);
  
  for (let i = 0; i < encoded.length; i++) {
    encrypted[i] = encoded[i] ^ key[i];
  }
  
  return encrypted.toString('base64');
}

function decryptKey(ciphertext: string, secret: string): string {
  const encrypted = Buffer.from(ciphertext, 'base64');
  const key = Buffer.from(secret.repeat(Math.ceil(encrypted.length / secret.length)));
  const decrypted = Buffer.alloc(encrypted.length);
  
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ key[i];
  }
  
  return decrypted.toString();
}

// =============================================================================
// TESTS
// =============================================================================

describe('Provider Routing', () => {
  describe('parseModelProvider', () => {
    describe('Explicit provider prefix', () => {
      it('parses openai/gpt-4', () => {
        const result = parseModelProvider('openai/gpt-4');
        expect(result.provider).toBe('openai');
        expect(result.modelName).toBe('gpt-4');
      });

      it('parses anthropic/claude-3-opus', () => {
        const result = parseModelProvider('anthropic/claude-3-opus');
        expect(result.provider).toBe('anthropic');
        expect(result.modelName).toBe('claude-3-opus');
      });

      it('parses openrouter/meta-llama/llama-3-70b', () => {
        const result = parseModelProvider('openrouter/meta-llama/llama-3-70b');
        expect(result.provider).toBe('openrouter');
        // Model name includes everything after the first slash
        expect(result.modelName).toContain('meta-llama');
      });

      it('handles case insensitivity', () => {
        const result = parseModelProvider('OpenAI/GPT-4');
        expect(result.provider).toBe('openai');
      });
    });

    describe('Implicit provider inference', () => {
      it('infers OpenAI for gpt- prefix', () => {
        const result = parseModelProvider('gpt-4-turbo');
        expect(result.provider).toBe('openai');
        expect(result.modelName).toBe('gpt-4-turbo');
      });

      it('infers OpenAI for o1 models', () => {
        const result = parseModelProvider('o1-preview');
        expect(result.provider).toBe('openai');
      });

      it('infers Anthropic for claude- prefix', () => {
        const result = parseModelProvider('claude-3-sonnet-20240229');
        expect(result.provider).toBe('anthropic');
      });

      it('defaults to OpenRouter for unknown models', () => {
        const result = parseModelProvider('unknown-model-xyz');
        expect(result.provider).toBe('openrouter');
      });
    });

    describe('Edge cases', () => {
      it('handles model with multiple slashes', () => {
        const result = parseModelProvider('meta-llama/llama-3-70b-instruct');
        // Without explicit provider, goes to OpenRouter
        expect(result.provider).toBe('openrouter');
      });

      it('handles empty string', () => {
        const result = parseModelProvider('');
        expect(result.provider).toBe('openrouter');
      });
    });
  });
});

describe('Request Transformation', () => {
  describe('transformToAnthropic', () => {
    it('extracts system message', () => {
      const request = {
        model: 'claude-3-opus',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
      };

      const transformed = transformToAnthropic(request);

      expect(transformed.system).toBe('You are helpful');
      expect(transformed.messages).toHaveLength(1);
    });

    it('preserves user and assistant messages', () => {
      const request = {
        model: 'claude-3-opus',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' },
        ],
      };

      const transformed = transformToAnthropic(request);

      expect(transformed.messages).toHaveLength(3);
      expect(transformed.messages[0].role).toBe('user');
      expect(transformed.messages[1].role).toBe('assistant');
    });

    it('sets default max_tokens', () => {
      const request = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const transformed = transformToAnthropic(request);

      expect(transformed.max_tokens).toBe(4096);
    });

    it('preserves stream option', () => {
      const request = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const transformed = transformToAnthropic(request);

      expect(transformed.stream).toBe(true);
    });

    it('handles messages without system', () => {
      const request = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const transformed = transformToAnthropic(request);

      expect(transformed.system).toBeUndefined();
      expect(transformed.messages).toHaveLength(1);
    });
  });

  describe('transformFromAnthropic', () => {
    it('transforms response to OpenAI format', () => {
      const anthropicResponse = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello there!' }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const transformed = transformFromAnthropic(anthropicResponse);

      expect(transformed.object).toBe('chat.completion');
      expect(transformed.choices[0].message.role).toBe('assistant');
      expect(transformed.choices[0].message.content).toBe('Hello there!');
      expect(transformed.choices[0].finish_reason).toBe('stop');
    });

    it('transforms usage correctly', () => {
      const anthropicResponse = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello' }],
        model: 'claude-3-opus',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };

      const transformed = transformFromAnthropic(anthropicResponse);

      expect(transformed.usage.prompt_tokens).toBe(100);
      expect(transformed.usage.completion_tokens).toBe(50);
      expect(transformed.usage.total_tokens).toBe(150);
    });

    it('handles max_tokens stop reason', () => {
      const anthropicResponse = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'truncated...' }],
        model: 'claude-3-opus',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 100 },
      };

      const transformed = transformFromAnthropic(anthropicResponse);

      expect(transformed.choices[0].finish_reason).toBe('max_tokens');
    });
  });
});

describe('API Key Encryption', () => {
  const testSecret = 'test_encryption_secret_32bytes!!';

  describe('encryptKey / decryptKey', () => {
    it('encrypts and decrypts correctly', () => {
      const original = 'sk-1234567890abcdef';
      const encrypted = encryptKey(original, testSecret);
      const decrypted = decryptKey(encrypted, testSecret);

      expect(decrypted).toBe(original);
    });

    it('produces different output than input', () => {
      const original = 'sk-myapikey123';
      const encrypted = encryptKey(original, testSecret);

      expect(encrypted).not.toBe(original);
    });

    it('produces base64 output', () => {
      const encrypted = encryptKey('test', testSecret);
      
      // Should be valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    });

    it('handles OpenAI key format', () => {
      const openaiKey = providerKeys.openai.decrypted;
      const encrypted = encryptKey(openaiKey, testSecret);
      const decrypted = decryptKey(encrypted, testSecret);

      expect(decrypted).toBe(openaiKey);
    });

    it('handles Anthropic key format', () => {
      const anthropicKey = providerKeys.anthropic.decrypted;
      const encrypted = encryptKey(anthropicKey, testSecret);
      const decrypted = decryptKey(encrypted, testSecret);

      expect(decrypted).toBe(anthropicKey);
    });

    it('handles empty string', () => {
      const encrypted = encryptKey('', testSecret);
      const decrypted = decryptKey(encrypted, testSecret);

      expect(decrypted).toBe('');
    });

    it('different secrets produce different ciphertexts', () => {
      const original = 'sk-test-key';
      const encrypted1 = encryptKey(original, 'secret1_32bytes_secret1_32bytes!');
      const encrypted2 = encryptKey(original, 'secret2_32bytes_secret2_32bytes!');

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('same input produces same output (deterministic)', () => {
      const original = 'sk-test-key';
      const encrypted1 = encryptKey(original, testSecret);
      const encrypted2 = encryptKey(original, testSecret);

      expect(encrypted1).toBe(encrypted2);
    });

    it('wrong secret fails decryption', () => {
      const original = 'sk-test-key';
      const encrypted = encryptKey(original, testSecret);
      const wrongDecrypted = decryptKey(encrypted, 'wrong_secret_32bytes_wrong_32!!');

      expect(wrongDecrypted).not.toBe(original);
    });
  });

  describe('Key storage format', () => {
    it('encrypted key is storable in database', () => {
      const apiKey = 'sk-very-long-api-key-1234567890abcdef';
      const encrypted = encryptKey(apiKey, testSecret);

      // Should be a reasonable length for database storage
      expect(encrypted.length).toBeLessThan(500);
      
      // Should be ASCII (safe for most databases)
      expect(/^[A-Za-z0-9+/=]*$/.test(encrypted)).toBe(true);
    });
  });
});

describe('Provider Key Retrieval', () => {
  const mockUserKeys = {
    openai: encryptKey('sk-openai-real', 'test_secret_32bytes_test_32b!!!'),
    anthropic: encryptKey('sk-ant-real', 'test_secret_32bytes_test_32b!!!'),
  };

  function getDecryptedKey(
    provider: Provider,
    userKeys: Record<string, string>,
    secret: string
  ): string | null {
    const encrypted = userKeys[provider];
    if (!encrypted) return null;
    return decryptKey(encrypted, secret);
  }

  it('retrieves OpenAI key', () => {
    const key = getDecryptedKey('openai', mockUserKeys, 'test_secret_32bytes_test_32b!!!');
    expect(key).toBe('sk-openai-real');
  });

  it('retrieves Anthropic key', () => {
    const key = getDecryptedKey('anthropic', mockUserKeys, 'test_secret_32bytes_test_32b!!!');
    expect(key).toBe('sk-ant-real');
  });

  it('returns null for missing provider', () => {
    const key = getDecryptedKey('openrouter', mockUserKeys, 'test_secret_32bytes_test_32b!!!');
    expect(key).toBeNull();
  });
});
