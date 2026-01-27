# MemoryRouter Test Suite

Comprehensive unit and integration tests for the MemoryRouter API.

## Test Structure

```
tests/
├── fixtures/           # Test data and mock fixtures
│   └── index.ts        # Messages, memory keys, API requests, temporal data
├── helpers/            # Test utilities
│   ├── test-app.ts     # App factory and request helpers
│   └── stripe.ts       # Stripe webhook and metering helpers
├── mocks/              # MSW mock handlers
│   ├── handlers.ts     # API mock handlers for providers
│   └── server.ts       # MSW server setup
├── unit/               # Unit tests
│   ├── auth.test.ts    # Authentication middleware
│   ├── billing.test.ts # Billing/quota logic
│   ├── formatters.test.ts # Response formatters
│   ├── kronos.test.ts  # KRONOS temporal logic
│   ├── memory.test.ts  # Memory middleware
│   ├── providers.test.ts # Provider routing & encryption
│   └── tokens.test.ts  # Token counting
├── integration/        # Integration tests
│   ├── billing.test.ts # Billing API endpoints
│   ├── chat-completion.test.ts # Full chat flow
│   ├── memory-storage.test.ts  # Memory store/retrieve
│   ├── rate-limiting.test.ts   # Rate/quota enforcement
│   ├── stripe-webhooks.test.ts # Stripe webhook handling
│   └── temporal-queries.test.ts # KRONOS temporal queries
└── edge-cases/         # Edge case tests
    └── error-handling.test.ts  # Error scenarios
```

## Running Tests

```bash
# Run all tests
npm test

# Run with watch mode
npm test -- --watch

# Run specific test file
npm test -- tests/unit/tokens.test.ts

# Run tests matching pattern
npm test -- --grep "token"

# Run with coverage
npm test -- --coverage
```

## Test Categories

### Unit Tests (295 tests)

| File | Tests | Description |
|------|-------|-------------|
| `tokens.test.ts` | 27 | Token counting, estimation, and model limits |
| `auth.test.ts` | 22 | Memory key validation, middleware flow |
| `memory.test.ts` | 35 | Memory options parsing, context injection, storage |
| `billing.test.ts` | 15 | Usage calculation, quota checking |
| `kronos.test.ts` | 45 | Temporal windows, retrieval allocation, query parsing |
| `providers.test.ts` | 31 | Provider routing, request transformation, encryption |
| `formatters.test.ts` | 24 | Response formatting, error handling |

### Integration Tests

| File | Tests | Description |
|------|-------|-------------|
| `chat-completion.test.ts` | 26 | Full request/response cycle |
| `memory-storage.test.ts` | 20 | VectorVault storage and retrieval |
| `temporal-queries.test.ts` | 17 | KRONOS temporal memory queries |
| `rate-limiting.test.ts` | 15 | Rate limiting and quota enforcement |
| `billing.test.ts` | 23 | Billing API endpoints |
| `stripe-webhooks.test.ts` | 21 | Stripe webhook handling |

### Edge Case Tests

| File | Tests | Description |
|------|-------|-------------|
| `error-handling.test.ts` | 38 | Invalid inputs, provider failures |

## Key Test Scenarios

### Authentication
- Valid/invalid memory key validation
- Missing Authorization header
- Non-mk_ prefix rejection
- Provider key decryption

### Memory Operations
- Context injection modes (auto/read/write/off)
- Selective memory (`memory: false` flag)
- Cross-session recall
- Memory key isolation

### KRONOS Temporal Logic
- Temporal window classification (HOT/WORKING/LONG_TERM/EXPIRED)
- Retrieval allocation across windows
- Temporal query parsing ("yesterday", "last week", etc.)
- Recency bias handling

### Billing & Quota
- Free tier token limits (50M)
- Paid tier unlimited usage
- Rate limiting (20/100 req/min)
- Usage metering
- Subscription lifecycle

### Provider Routing
- Model-to-provider mapping
- Request transformation (OpenAI → Anthropic)
- Response normalization
- Streaming support

## Stripe Interface Contract

The Stripe tests define the expected interface:

```typescript
// Required webhook events
const REQUIRED_WEBHOOK_EVENTS = [
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
];

// Metering interface
interface MeteringService {
  reportUsage(subscriptionItemId: string, quantity: number): Promise<UsageRecord>;
  batchReportUsage(items: BatchUsageItem[]): Promise<UsageRecord[]>;
  getCurrentUsage(subscriptionItemId: string): Promise<CurrentUsage>;
}
```

## Mock Services

### MockVectorVault
Simple keyword-based retrieval for testing memory storage logic.

### MockQuotaService
In-memory quota and rate limit tracking.

### MockMeteringService
Tracks usage reports for Stripe metering tests.

## Known Limitations

1. **MSW Integration**: Some edge-case tests require MSW handlers to be properly configured to intercept requests. Tests may hit real APIs in some scenarios.

2. **Temporal Tests**: Use `vi.useFakeTimers()` for consistent time-based testing.

3. **Provider Mocks**: Anthropic/OpenRouter transformations are mocked at the HTTP level.

## Contributing

When adding new tests:

1. Add fixtures to `tests/fixtures/index.ts`
2. Add helper functions to `tests/helpers/`
3. Follow existing patterns for test organization
4. Ensure tests are deterministic (no reliance on external state)
