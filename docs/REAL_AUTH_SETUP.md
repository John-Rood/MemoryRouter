# MemoryRouter Real Auth Setup

## What Was Implemented

### Phase 1: D1 Schema ✅
- Created `workers/migrations/0003_users_billing.sql`
- Tables: `users`, `billing`, `transactions`, `memory_keys`, `provider_keys`, `payment_methods`, `stripe_events`
- Migration applied to production D1

### Phase 2: Workers User API ✅
- Created `workers/src/routes/users.ts`
- Endpoints:
  - `POST /api/users/upsert` — Create/update user from OAuth
  - `GET /api/users/:userId` — Get user
  - `GET/POST /api/users/:userId/billing` — Get/update billing
  - `POST /api/users/:userId/credit` — Add credit balance
  - `GET /api/users/:userId/usage` — Get usage stats
  - `GET/POST/DELETE /api/users/:userId/memory-keys` — Manage memory keys
  - `GET/POST/DELETE /api/users/:userId/provider-keys` — Manage provider keys
  - `POST /api/users/:userId/onboarding/complete` — Mark onboarding done

### Phase 3: Dashboard OAuth ✅
- Updated `src/app/api/auth/google/callback/route.ts`
- Updated `src/app/api/auth/github/callback/route.ts`
- Now calls Workers API to persist user in D1

### Phase 4: Dashboard API Routes ✅
- Updated `src/app/api/billing/overview/route.ts` — Real billing from D1
- Updated `src/app/api/keys/memory/route.ts` — Real memory keys from D1
- Updated `src/app/api/keys/provider/route.ts` — Real provider keys from D1

---

## What You Need To Do

### 1. Add Environment Variables to Vercel

Go to Vercel → MemoryRouter Dashboard → Settings → Environment Variables

Add these NEW variables:

```
WORKERS_API_URL=https://api.memoryrouter.ai
DASHBOARD_API_KEY=e6cf5be65c6a397651b75d9be5cd7439fbe47a4a703b590f1b8e1ba5f5c67792
```

### 2. Redeploy Dashboard

After adding env vars:

```bash
cd /Users/johnrood/apps/MemoryRouter/dashboard
vercel --prod
```

Or trigger deploy from Vercel dashboard.

---

## How To Test

### Test 1: User Persistence
1. Go to https://app.memoryrouter.ai
2. Log in with Google
3. Complete onboarding (or skip)
4. Note your user ID in the URL or via API
5. Redeploy dashboard (trigger a new deployment)
6. Log in again — you should see the SAME user, not a new one

### Test 2: Real Billing
1. Log in
2. Go to Billing page
3. Should show `$0.00` balance (not the old hardcoded `$15.42`)
4. Add funds via Stripe (if configured)
5. Balance should update in real-time

### Test 3: Memory Keys
1. Go to Keys page
2. Create a new memory key
3. The key should appear in the list
4. Log out and back in — key should still be there

### Test 4: Check D1 Directly
```bash
cd /Users/johnrood/apps/MemoryRouter/workers

# List users
npx wrangler d1 execute memoryrouter-vectors --remote \
  --command "SELECT * FROM users"

# List memory keys
npx wrangler d1 execute memoryrouter-vectors --remote \
  --command "SELECT * FROM memory_keys"

# Check billing
npx wrangler d1 execute memoryrouter-vectors --remote \
  --command "SELECT * FROM billing"
```

---

## API Authentication

The Dashboard → Workers API uses a shared secret (`X-Dashboard-Key` header).

- Secret is already set in Workers: `DASHBOARD_API_KEY`
- Dashboard needs same value in env: `DASHBOARD_API_KEY`

This prevents unauthorized access to user management endpoints.

---

## What's Left (Phase 5 & 6)

### Phase 5: Usage Tracking (Optional Enhancement)
Currently tracks requests in `usage_events` and `usage_daily` tables.
The `/api/users/:userId/usage` endpoint aggregates this data.

To fully wire this:
1. The inference endpoint (`/v1/chat/completions`) already records usage
2. Dashboard can display this in a usage chart

### Phase 6: Stripe Billing (Needs Verification)
- Stripe customer creation should happen on first purchase
- Webhook at `/api/webhooks/stripe` needs to call Workers API to credit balance
- Test with Stripe test mode before going live

---

## Files Modified

### Workers
- `workers/migrations/0003_users_billing.sql` (NEW)
- `workers/src/routes/users.ts` (NEW)
- `workers/src/index.ts` (added user routes)

### Dashboard
- `dashboard/src/lib/api/workers-client.ts` (NEW)
- `dashboard/src/lib/auth/jwt.ts` (extended TokenPayload)
- `dashboard/src/lib/auth/session.ts` (added metadata support)
- `dashboard/src/lib/auth/server.ts` (replaced mock store)
- `dashboard/src/app/api/auth/google/callback/route.ts` (calls Workers)
- `dashboard/src/app/api/auth/github/callback/route.ts` (calls Workers)
- `dashboard/src/app/api/billing/overview/route.ts` (real data)
- `dashboard/src/app/api/keys/memory/route.ts` (real data)
- `dashboard/src/app/api/keys/provider/route.ts` (real data)

---

## Summary

**Before**: Users stored in-memory Map → reset on every deploy → billing hardcoded

**After**: Users stored in D1 → persists forever → billing is real

Just add the 2 env vars to Vercel and redeploy. 🚀
