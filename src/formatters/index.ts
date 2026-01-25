/**
 * Model-specific memory context formatters
 * Single source of truth for all model formatting
 */

type Formatter = (context: string) => string;

const formatters: Record<string, Formatter> = {
  // Anthropic models prefer XML-style tags
  claude: (context) => `<memory_context>
${context}
</memory_context>

Use the above context from previous conversations to inform your response.`,

  // OpenAI models prefer markdown
  gpt: (context) => `## Relevant Memory
---
${context}
---

Use this context to inform your response.`,

  // Llama/Meta models
  llama: (context) => `[MEMORY_CONTEXT]
${context}
[/MEMORY_CONTEXT]

The above is relevant context from previous conversations.`,

  // Google models
  gemini: (context) => `<context type="memory">
${context}
</context>`,

  // Default fallback
  default: (context) => `Relevant context from previous conversations:

${context}

Use this context to inform your response, but don't reference it directly unless asked.`,
};

export function getFormatter(model: string): Formatter {
  const modelLower = model.toLowerCase();
  if (modelLower.includes('claude')) return formatters.claude;
  if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3')) return formatters.gpt;
  if (modelLower.includes('llama')) return formatters.llama;
  if (modelLower.includes('gemini')) return formatters.gemini;
  return formatters.default;
}

export function formatMemoryContext(model: string, context: string): string {
  const formatter = getFormatter(model);
  return formatter(context);
}

export { formatters };
