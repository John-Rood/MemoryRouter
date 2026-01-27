export const mockUser = { name: "John", email: "john@example.com" };

export const mockStats = {
  creditBalance: 15.42,
  tokensUsed: 36_200_000,
  tokensSaved: 142_800_000,
  savingsAmount: 428,
};

export const mockProviderKeys = [
  { id: "pk_1", provider: "openai" as const, providerName: "OpenAI", maskedKey: "sk-proj-\u2022\u2022\u2022\u2022xxxx", addedAt: "Jan 15, 2026", isDefault: true },
  { id: "pk_2", provider: "anthropic" as const, providerName: "Anthropic", maskedKey: "sk-ant-\u2022\u2022\u2022\u2022xxxx", addedAt: "Jan 20, 2026", isDefault: false },
];

export const mockMemoryKeys = [
  { id: "mk_1", name: "main-assistant", key: "mk_abc123def456", tokensUsed: 3_200_000, lastUsed: "2 min ago" },
  { id: "mk_2", name: "user-12345", key: "mk_ghi789jkl012", tokensUsed: 890_000, lastUsed: "1 hour ago" },
  { id: "mk_3", name: "project-alpha", key: "mk_mno345pqr678", tokensUsed: 12_100_000, lastUsed: "3 days ago" },
];

export const mockTransactions = [
  { id: "tx_1", date: "Jan 26, 2026", description: "Auto-reup", amount: 20.0, balance: 35.42 },
  { id: "tx_2", date: "Jan 24, 2026", description: "Auto-reup", amount: 20.0, balance: 15.42 },
  { id: "tx_3", date: "Jan 20, 2026", description: "Auto-reup", amount: 20.0, balance: 12.18 },
  { id: "tx_4", date: "Jan 15, 2026", description: "Initial funding", amount: 20.0, balance: 20.0 },
];

export const mockPaymentMethod = { brand: "VISA", last4: "4242", expiry: "12/2028" };

export const mockWeeklyUsage = [
  { day: "Mon", stored: 320000, retrieved: 480000 },
  { day: "Tue", stored: 450000, retrieved: 620000 },
  { day: "Wed", stored: 580000, retrieved: 750000 },
  { day: "Thu", stored: 720000, retrieved: 890000 },
  { day: "Fri", stored: 950000, retrieved: 1100000 },
  { day: "Sat", stored: 680000, retrieved: 820000 },
  { day: "Sun", stored: 410000, retrieved: 550000 },
];

export const MEMORYROUTER_API_KEY = "mr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
export const MEMORYROUTER_BASE_URL = "https://api.memoryrouter.ai/v1";
