export const PRICING = {
  FREE_TIER_TOKENS: 50_000_000,
  PRICE_PER_MILLION: 0.50,
  DEFAULT_REUP_AMOUNT: 20,
  DEFAULT_REUP_TRIGGER: 5,
  MIN_REUP_AMOUNT: 5,
} as const;

export const REUP_AMOUNTS = [5, 10, 20, 50, 100] as const;
export const REUP_TRIGGERS = [1, 5, 10] as const;
export const MONTHLY_CAPS = [50, 100, 500] as const;

export const PROVIDERS = [
  { 
    id: "openai", 
    name: "OpenAI", 
    prefix: "sk-",
    placeholder: "sk-proj-...",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    formatHint: "Starts with sk-proj- or sk-"
  },
  { 
    id: "anthropic", 
    name: "Anthropic", 
    prefix: "sk-ant-",
    placeholder: "sk-ant-...",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    formatHint: "Starts with sk-ant-"
  },
  { 
    id: "google", 
    name: "Google AI", 
    prefix: "AI",
    placeholder: "AIza...",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    formatHint: "Starts with AIza"
  },
  { 
    id: "xai", 
    name: "xAI (Grok)", 
    prefix: "xai-",
    placeholder: "xai-...",
    apiKeyUrl: "https://console.x.ai/",
    formatHint: "Starts with xai-"
  },
  { 
    id: "deepseek", 
    name: "DeepSeek", 
    prefix: "sk-",
    placeholder: "sk-...",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    formatHint: "Starts with sk-"
  },
  { 
    id: "mistral", 
    name: "Mistral", 
    prefix: "",
    placeholder: "...",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    formatHint: "UUID format"
  },
  { 
    id: "cohere", 
    name: "Cohere", 
    prefix: "",
    placeholder: "...",
    apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    formatHint: "Alphanumeric string"
  },
  { 
    id: "openrouter", 
    name: "OpenRouter", 
    prefix: "sk-or-",
    placeholder: "sk-or-...",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    formatHint: "Starts with sk-or-"
  },
] as const;

export const RETENTION_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days (default)" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
] as const;

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}K`;
  }
  return tokens.toString();
}

export function tokensToDollars(tokens: number): number {
  return (tokens / 1_000_000) * PRICING.PRICE_PER_MILLION;
}

export function dollarsToTokens(dollars: number): number {
  return (dollars / PRICING.PRICE_PER_MILLION) * 1_000_000;
}
