# MemoryRouter Billing Module

This module implements Stripe-based usage billing for MemoryRouter.

## Overview

MemoryRouter uses metered billing with Stripe:
- **Pricing**: $1.00 per 1 million tokens
- **Free Tier**: 50 million tokens (no card required)
- **Billing Cycle**: Monthly
- **Usage Tracking**: Real-time internal, reported to Stripe at end of period

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BILLING ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Request                                                                    │
│     │                                                                       │
│     ▼                                                                       │
│  Quota Check Middleware                                                     │
│     │ → Check billing status                                               │
│     │ → Block if free tier exhausted (402)                                 │
│     │ → Block if suspended (402)                                           │
│     │ → Add warning headers if grace period                                 │
│     ▼                                                                       │
│  Process Request                                                            │
│     │                                                                       │
│     ▼                                                                       │
│  Token Counting (async)                                                     │
│     │ → Count stored input tokens                                          │
│     │ → Count stored output tokens                                         │
│     │ → Skip ephemeral (memory:false) tokens                               │
│     │ → Track retrieved tokens (free)                                      │
│     ▼                                                                       │
│  Record Usage                                                               │
│     │ → Insert usage_records row                                           │
│     │ → Increment user.total_tokens_used                                   │
│     ▼                                                                       │
│  Daily Aggregation (cron)                                                   │
│     │ → Sum usage_records → daily_usage_summary                            │
│     ▼                                                                       │
│  End-of-Period Reporting (cron)                                             │
│     │ → Calculate billable tokens (total - 50M)                            │
│     │ → Report to Stripe as usage units                                    │
│     │ → Stripe generates invoice                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript interfaces for billing |
| `tokens.ts` | Token counting and cost calculation |
| `service.ts` | Core billing logic and database operations |
| `middleware.ts` | Quota check middleware for API routes |
| `routes.ts` | RESTful billing API endpoints |
| `webhooks.ts` | Stripe webhook handlers |
| `index.ts` | Module exports |

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Stripe

Create your Stripe product and price:

```bash
STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:setup
```

This will output environment variables to add to `.env`.

### 3. Set Up Webhook

In Stripe Dashboard:
1. Go to Developers → Webhooks
2. Add endpoint: `https://api.memoryrouter.ai/webhooks/stripe`
3. Select events:
   - `customer.created`
   - `customer.updated`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.created`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_method.attached`
   - `payment_method.detached`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

### 4. Run Migrations

```bash
# Apply billing schema
psql $DATABASE_URL < migrations/001_billing_schema.sql
```

## API Endpoints

### Billing Overview
```
GET /v1/billing
Authorization: Bearer mk_xxx

Returns current billing status, usage, and subscription info.
```

### Usage Details
```
GET /v1/billing/usage?start_date=2026-01-01&end_date=2026-01-25
Authorization: Bearer mk_xxx

Returns detailed usage breakdown by day and memory key.
```

### Payment Methods
```
GET /v1/billing/payment-methods
POST /v1/billing/payment-methods
DELETE /v1/billing/payment-methods/:id
Authorization: Bearer mk_xxx

Manage payment methods.
```

### Setup Intent
```
POST /v1/billing/setup-intent
Authorization: Bearer mk_xxx

Get a Stripe SetupIntent for adding cards via Stripe Elements.
```

### Invoices
```
GET /v1/billing/invoices
GET /v1/billing/invoices/:id
Authorization: Bearer mk_xxx

View invoice history.
```

### Portal Session
```
POST /v1/billing/portal-session
Authorization: Bearer mk_xxx

Get a link to Stripe Customer Portal.
```

### Quota Check
```
GET /v1/billing/quota
Authorization: Bearer mk_xxx

Quick quota status check.
```

## Billing Status Flow

```
FREE ──────────────────────────► ACTIVE
  │ (add payment method)            │
  │                                 │
  │ (free tier exhausted            │ (payment failed)
  │  no payment method)             │
  │                                 ▼
  ▼                           GRACE_PERIOD ─────► SUSPENDED
402 BLOCKED                    (7 days)       (payment not recovered)
                                    │
                                    │ (payment recovered)
                                    ▼
                                 ACTIVE
```

## Error Responses

### 402 - Free Tier Exhausted
```json
{
  "error": {
    "type": "payment_required",
    "message": "Free tier exhausted. Please add a payment method to continue.",
    "code": "FREE_TIER_EXHAUSTED",
    "usage": {
      "tokens_used": 10000000,
      "free_limit": 10000000
    },
    "action": {
      "type": "add_payment_method",
      "url": "https://memoryrouter.ai/billing"
    }
  }
}
```

### 402 - Account Suspended
```json
{
  "error": {
    "type": "account_suspended",
    "message": "Account suspended due to payment failure. Please update your payment method.",
    "code": "ACCOUNT_SUSPENDED",
    "action": {
      "type": "update_payment_method",
      "url": "https://memoryrouter.ai/billing"
    }
  }
}
```

## Testing

```bash
# Run billing tests
npm test -- --grep billing

# Run all tests
npm test
```

## Token Counting

Tokens are counted using character-based estimation (~4 chars per token).

| Content Type | Counted | Billed |
|--------------|---------|--------|
| Stored input (user messages) | ✅ | ✅ |
| Stored output (assistant response) | ✅ | ✅ |
| Ephemeral (memory: false) | ✅ | ❌ |
| Retrieved context (RAG) | ✅ | ❌ FREE |

## Webhook Handling

All webhooks are:
- Verified using Stripe signature (production)
- Logged with idempotency (stripe_events table)
- Processed exactly once

## Cron Jobs (Required)

Set up these scheduled jobs:

### Daily Aggregation (midnight UTC)
```sql
SELECT aggregate_daily_usage(CURRENT_DATE - INTERVAL '1 day');
```

### End-of-Period Reporting (last day of month)
```javascript
// For each active subscription
await reportUsageToStripe(userId);
```
