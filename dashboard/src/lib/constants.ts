export const PRICING = {
  FREE_TIER_TOKENS: 50_000_000,
  PRICE_PER_MILLION: 1.00,
  DEFAULT_REUP_AMOUNT: 20,
  DEFAULT_REUP_TRIGGER: 5,
  MIN_REUP_AMOUNT: 5,
} as const;

export const REUP_AMOUNTS = [5, 10, 20, 50, 100] as const;
export const REUP_TRIGGERS = [1, 5, 10] as const;
export const MONTHLY_CAPS = [50, 100, 500] as const;

export const PROVIDERS = [
  { id: "openai", name: "OpenAI", prefix: "sk-" },
  { id: "anthropic", name: "Anthropic", prefix: "sk-ant-" },
  { id: "google", name: "Google", prefix: "AI" },
  { id: "openrouter", name: "OpenRouter", prefix: "sk-or-" },
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
