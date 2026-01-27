# MemoryRouter Deployment Architecture

## Three Subdomains

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MEMORYROUTER INFRASTRUCTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. memoryrouter.ai (Landing Page)                                         │
│     ├── Platform: Vercel                                                    │
│     ├── Code: /index.html                                                   │
│     ├── Status: ✅ DEPLOYED                                                 │
│     └── Purpose: Marketing, waitlist, documentation                        │
│                                                                             │
│  2. api.memoryrouter.ai (Inference API)                                    │
│     ├── Platform: Cloudflare Workers                                        │
│     ├── Code: /workers/                                                     │
│     ├── Status: ⚠️ READY TO DEPLOY (needs CF auth)                         │
│     └── Purpose: AI proxy with memory injection                            │
│         • POST /v1/chat/completions (OpenAI-compatible)                    │
│         • POST /v1/messages (Anthropic-compatible)                         │
│         • Memory retrieval & storage (KRONOS)                              │
│         • Provider routing (OpenAI, Anthropic, OpenRouter)                 │
│                                                                             │
│  3. app.memoryrouter.ai (Dashboard)                                        │
│     ├── Platform: Vercel (Next.js) or Cloudflare Pages                     │
│     ├── Code: /dashboard/ (TO BE CREATED)                                  │
│     ├── Status: ❌ NOT BUILT YET                                           │
│     └── Purpose: User dashboard                                            │
│         • User registration & login (Auth)                                 │
│         • Memory key management                                            │
│         • Provider key storage (encrypted)                                 │
│         • Usage analytics & billing                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current Status

| Subdomain | Platform | Code Location | Status |
|-----------|----------|---------------|--------|
| memoryrouter.ai | Vercel | `/index.html` | ✅ Live |
| api.memoryrouter.ai | Cloudflare Workers | `/workers/` | ⚠️ Ready to deploy |
| app.memoryrouter.ai | TBD | `/dashboard/` | ❌ Not built |

---

## 1. Landing Page (memoryrouter.ai) ✅

**Already deployed on Vercel.**

```bash
# Vercel config exists
cat vercel.json
# { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

---

## 2. Inference API (api.memoryrouter.ai) ⚠️

### Ready to Deploy
The Cloudflare Workers code is complete at `/workers/`.

### Deployment Steps

```bash
cd /Users/johnkodarood/Documents/GitHub/MemoryRouter/workers

# 1. Authenticate with Cloudflare
npx wrangler login

# 2. Create KV namespaces
npx wrangler kv namespace create "VECTORS_KV"
npx wrangler kv namespace create "METADATA_KV"

# 3. Create R2 bucket
npx wrangler r2 bucket create memoryrouter-vectors

# 4. Update wrangler.toml with IDs from step 2

# 5. Deploy
npm run deploy

# 6. Add custom domain
npx wrangler domains add api.memoryrouter.ai
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/chat/completions` | POST | OpenAI-compatible proxy with memory |
| `/v1/memory/stats` | GET | Memory statistics for key |
| `/v1/memory` | DELETE | Clear memory for key |
| `/v1/keys` | POST | Create new memory key |

---

## 3. Dashboard App (app.memoryrouter.ai) ❌

### Needs to be built

**Recommended Stack:**
- **Framework:** Next.js 14 (App Router)
- **Auth:** Supabase Auth or Clerk
- **Database:** Supabase PostgreSQL
- **Deployment:** Vercel
- **Styling:** Tailwind CSS (matches landing page)

### Core Features Needed

1. **Authentication**
   - Email/password signup
   - Magic link login
   - OAuth (Google, GitHub)

2. **Memory Key Management**
   - Create memory keys
   - List/delete keys
   - Copy key to clipboard
   - View per-key usage

3. **Provider Key Storage**
   - Add OpenAI API key
   - Add Anthropic API key
   - Add OpenRouter API key
   - Encrypted storage
   - Key validation

4. **Usage & Billing**
   - Token usage charts
   - Memory token count per key
   - Billing history
   - Upgrade/downgrade plans

5. **Settings**
   - Account settings
   - Notification preferences
   - Delete account

### Database Schema (Supabase)

```sql
-- Users (handled by Supabase Auth)

-- Provider Keys
CREATE TABLE provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'openai' | 'anthropic' | 'openrouter'
  encrypted_key TEXT NOT NULL,
  nickname TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Memory Keys
CREATE TABLE memory_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL, -- 'mk_xxx'
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  is_active BOOLEAN DEFAULT true,
  memory_token_count BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP
);

-- Usage Records
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_key_id UUID REFERENCES memory_keys(id) ON DELETE CASCADE,
  tokens_stored INTEGER,
  tokens_retrieved INTEGER,
  model TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Integration Flow

```
┌──────────────────┐      ┌───────────────────────┐
│  app.memoryrouter.ai │  │  api.memoryrouter.ai  │
│    (Dashboard)    │      │   (Workers API)       │
├──────────────────┤      ├───────────────────────┤
│                  │      │                       │
│  1. User logs in │      │                       │
│  2. Creates key  │──────│─► Key stored in KV    │
│  3. Adds API key │──────│─► Encrypted in DB     │
│  4. Copies mk_*  │      │                       │
│                  │      │                       │
└──────────────────┘      └───────────────────────┘
         │                          ▲
         │                          │
         ▼                          │
┌──────────────────┐               │
│  User's App      │               │
├──────────────────┤               │
│ OpenAI SDK with: │               │
│ baseURL: api.memoryrouter.ai ────┘
│ apiKey: mk_xxx   │
└──────────────────┘
```

---

## Priority Order

### Monday Launch Blockers

1. **[CRITICAL] api.memoryrouter.ai** - Deploy Workers (5 min after CF auth)
2. **[CRITICAL] OpenAI embeddings key** - Need key for memory features
3. **[HIGH] Basic key provisioning** - How do beta users get mk_* keys?

### For Beta (can be manual)
- Manually create memory keys in KV
- Share keys with beta users directly
- Dashboard can come after beta feedback

### For Public Launch
- Full dashboard at app.memoryrouter.ai
- Self-serve key management
- Billing integration (Stripe)

---

## Quick Actions

### Deploy API Now
```bash
cd /Users/johnkodarood/Documents/GitHub/MemoryRouter/workers
npx wrangler login  # Do this first!
./scripts/deploy.sh
```

### Create Beta Key Manually (after deploy)
```bash
npx wrangler kv key put --namespace-id=<METADATA_KV_ID> \
  "mk:mk_beta_user_1" \
  '{"key":"mk_beta_user_1","userId":"beta","name":"Beta Tester","createdAt":1737800000000}'
```

---

## Questions for John

1. **OpenAI API key for embeddings** - Do you have one to add as a Worker secret?
2. **Dashboard priority** - Should I scaffold the Next.js dashboard now, or focus on getting API deployed first?
3. **Beta user key distribution** - Manual or need basic key gen endpoint?
