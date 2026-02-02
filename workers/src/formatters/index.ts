/**
 * Model-specific Memory Context Formatters
 * Single source of truth for all model formatting
 */

// Re-export Google transform utilities
export {
  transformToGoogle,
  transformFromGoogle,
  createGoogleStreamTransformer,
  extractGoogleResponseContent,
  type GeminiRequest,
  type GeminiResponse,
} from './google';

type Formatter = (context: string) => string;

const formatters: Record<string, Formatter> = {
  // Anthropic models prefer XML-style tags
  claude: (context) => `<memory_context>
${context}
</memory_context>

Use the above context from previous conversations to inform your response. Do not explicitly mention that you're using memory unless directly asked.`,

  // OpenAI models prefer markdown
  gpt: (context) => `## Relevant Memory
---
${context}
---

Use this context to inform your response. Reference it naturally without explicitly mentioning "memory" unless asked.`,

  // Llama/Meta models
  llama: (context) => `[MEMORY_CONTEXT]
${context}
[/MEMORY_CONTEXT]

The above is relevant context from previous conversations. Use it naturally in your response.`,

  // Google models
  gemini: (context) => `<context type="memory">
${context}
</context>

Use this context naturally to inform your response.`,

  // Default fallback
  default: (context) => `Relevant context from previous conversations:

${context}

Use this context to inform your response, but don't reference it directly unless asked.`,
};

/**
 * Get the appropriate formatter for a model
 */
export function getFormatter(model: string): Formatter {
  const modelLower = model.toLowerCase();
  
  if (modelLower.includes('claude')) return formatters.claude;
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3')) return formatters.gpt;
  if (modelLower.includes('llama')) return formatters.llama;
  if (modelLower.includes('gemini')) return formatters.gemini;
  
  return formatters.default;
}

/**
 * Format memory context for a specific model
 */
export function formatMemoryContext(model: string, context: string): string {
  const formatter = getFormatter(model);
  return formatter(context);
}

/**
 * Estimate token count from text
 * Rough approximation: ~4 characters per token
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export { formatters };
