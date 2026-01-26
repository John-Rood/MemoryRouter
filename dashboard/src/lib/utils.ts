import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 7) + "••••••••••••" + key.slice(-4);
}

export const PRICING = {
  FREE_TIER_TOKENS: 50_000_000,
  PRICE_PER_MILLION: 1.0,
  DEFAULT_REUP_AMOUNT: 20,
  DEFAULT_REUP_TRIGGER: 5,
  MIN_REUP_AMOUNT: 5,
} as const;
