/**
 * Model-Specific Memory Context Formatters
 * 
 * Different models respond better to different context injection formats.
 * This maintains a centralized formatter that adapts context for each model family.
 * 
 * Reference: memoryrouter-product-spec.md Section 4.4
 * 
 * | Model Family | Format |
 * |-------------|--------|
 * | Claude (Anthropic) | XML tags |
 * | GPT (OpenAI) | Markdown |
 * | Llama (Meta) | Bracket tags |
 * | Gemini (Google) | XML context |
 * | Default | Plain text |
 */

type Formatter = (context: string) => string;

const formatters: Record<string, Formatter> = {
  // Anthropic Claude — prefers XML-style tags
  claude: (context) => `<memory_context>
<description>Relevant context from previous conversations in this session. Use this to maintain continuity.</description>
${context}
</memory_context>

Use the above memory context to inform your response. Don't mention the memory system unless asked.`,

  // OpenAI GPT — prefers markdown
  gpt: (context) => `## Memory Context
> Relevant context from previous conversations in this session.

---
${context}
---

Use this memory context to inform your response. Don't reference the memory system directly unless asked.`,

  // Meta Llama — bracket tags
  llama: (context) => `[MEMORY_CONTEXT]
${context}
[/MEMORY_CONTEXT]

The above is relevant context from previous conversations. Use it to inform your response.`,

  // Google Gemini — XML context
  gemini: (context) => `<context type="memory">
<description>Previous conversation context from this session.</description>
${context}
</context>

Use this memory context naturally in your response.`,

  // Default fallback — plain text
  default: (context) => `Relevant context from previous conversations:

${context}

Use this context to inform your response, but don't reference the memory system directly unless asked.`,
};

/**
 * Get the appropriate formatter for a model
 */
export function getFormatter(model: string): Formatter {
  const modelLower = model.toLowerCase();
  
  if (modelLower.includes('claude')) return formatters.claude;
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3') || modelLower.includes('o4')) return formatters.gpt;
  if (modelLower.includes('llama')) return formatters.llama;
  if (modelLower.includes('gemini')) return formatters.gemini;
  
  return formatters.default;
}

/**
 * Format memory context for the target model
 */
export function formatMemoryContext(model: string, context: string): string {
  if (!context || context.trim().length === 0) {
    return '';
  }
  
  const formatter = getFormatter(model);
  return formatter(context);
}

export { formatters };
