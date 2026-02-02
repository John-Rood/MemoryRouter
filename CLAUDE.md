# CLAUDE.md — MemoryRouter Development Rules

## 🛡️ THE CORE IS SACRED

This codebase contains the **MemoryRouter Core** — the memory engine that must never regress.

**Core Guarantees:**
- Overhead < 100ms (target: < 50ms)
- Memory injection always works
- Buffer syncs to D1
- 100% reliability
- Context-window-aware truncation

---

## ⚠️ MANDATORY: Before ANY Code Changes

### Before You Edit:
1. Understand what the core does
2. Know which files are core vs peripheral
3. Have a plan that preserves the core

### After You Edit:
1. **RUN THE REGRESSION TESTS** — No exceptions
   ```bash
   cd workers && npm run verify
   ```
2. If tests fail → **FIX BEFORE COMMITTING**
3. If tests pass → Safe to proceed

---

## 📋 Commit & Deploy Rules

### During Implementation (Plan in Progress):
- ✅ Make commits for each phase/milestone
- ✅ Run regression tests after each significant change
- ❌ **NO PUSHES** until plan is fully implemented
- ❌ **NO DEPLOYS** until plan is fully implemented

### After Implementation Complete:
- ✅ Run full regression test suite
- ✅ Commit final changes
- ✅ **PUSH to GitHub** (make code live in repo)
- ✅ **DEPLOY to Cloudflare** (make code live in production)

```bash
# Full completion workflow:
npm run verify              # Quick check
npm run test:core           # Full tests (if available)
git add -A
git commit -m "feat: [description]"
git push origin main
npm run deploy
```

---

## 🧪 Regression Tests

### Quick Verification (30 seconds):
```bash
npm run verify
```
Checks: health, latency, memory injection, storage sync

### Full Test Suite (2 minutes):
```bash
npm run test:core
```
Comprehensive tests with benchmarks

### When to Run:
- After editing ANY file in `workers/src/`
- Before every commit
- Before every push
- Before every deploy

---

## 📁 Core Files (Handle With Care)

These files ARE the core — changes require extra caution:

```
workers/src/
├── durable-objects/vault.ts    # DO storage engine
├── services/
│   ├── kronos-do.ts            # Search orchestration
│   ├── d1-search.ts            # D1 fallback
│   └── truncation.ts           # Context management
├── middleware/memory.ts         # Memory injection
└── routes/chat.ts              # Main request flow
```

---

## 🚫 Never Do This

1. **Never deploy without running tests**
2. **Never push incomplete implementations**
3. **Never modify core files without understanding the flow**
4. **Never skip the verification step**
5. **Never ignore test failures**

---

## ✅ Always Do This

1. **Run `npm run verify` after any edit**
2. **Commit incrementally during development**
3. **Push + Deploy only when complete**
4. **Document significant changes**
5. **Keep the core guarantees intact**

---

## 🔄 Development Workflow

```
1. Plan the change
       ↓
2. Implement phase 1
       ↓
3. Run tests → Pass? → Commit
       ↓
4. Implement phase 2
       ↓
5. Run tests → Pass? → Commit
       ↓
   ... (repeat for each phase)
       ↓
N. All phases complete
       ↓
N+1. Final test run
       ↓
N+2. Push to GitHub
       ↓
N+3. Deploy to Staging → Test
       ↓
N+4. Deploy to Production
       ↓
   DONE ✓
```

---

## 🌍 Environments

### Staging
- **Branch:** `staging`
- **URL:** https://memoryrouter-staging.roodbiz.workers.dev
- **D1:** memoryrouter-vectors-staging
- **Queue:** memoryrouter-storage-staging
- **Deploy:** `npm run deploy:staging`
- **Verify:** `npm run verify:staging`

### Production
- **Branch:** `main`
- **URL:** https://api.memoryrouter.ai
- **D1:** memoryrouter-vectors
- **Queue:** memoryrouter-storage
- **Deploy:** `npm run deploy:prod`
- **Verify:** `npm run verify:prod`

### Workflow
1. Make changes on `main` (or feature branch)
2. Test locally: `npm run dev`
3. Deploy to staging: `npm run deploy:staging`
4. Verify staging: `npm run verify:staging`
5. Test in debug/test pages (select "Staging" environment)
6. When ready: `npm run deploy:prod`
7. Verify production: `npm run verify:prod`

---

## 📋 Model List Architecture

**The `/v1/models` endpoint is for UI only** — it shows users what models are available in dropdowns.

**Model names are PASSTHROUGH** — we don't validate or transform model names at runtime. Whatever the user passes, we send to the provider.

### Update Flow
```bash
# 1. Run weekly (or on-demand) to fetch from providers
./scripts/update-models-native.sh

# 2. Commit the updated models-native.json
git add src/config/models-native.json
git commit -m "chore: Update model catalog"

# 3. Deploy
npm run deploy:staging
npm run deploy:prod
```

### Why Passthrough?
- Users know their own model names (including fine-tunes)
- Providers change model names frequently
- Translation tables break constantly
- Less code = fewer bugs

---

## 🧪 Model Validation (MANDATORY)

**Before updating model mappings or the model catalog, ALL models must pass validation.**

### Run Validation Script
```bash
cd workers
./scripts/validate-models.sh staging     # Test against staging
./scripts/validate-models.sh production  # Test against production
```

### What It Does
- Fetches all models from `/v1/models` endpoint
- Pings each chat model with a minimal request
- Reports pass/fail for every model
- **Fails if ANY model doesn't work**

### When to Run
1. **Before deploying model mapping changes** — Validate staging first
2. **After updating `models-native.json`** — Ensure catalog is accurate
3. **After updating model aliases** (e.g., `claude-opus-4.5` → actual model ID)
4. **Periodically** — Providers deprecate models without warning

### Model Naming Rules
- Use **friendly names** in dropdowns: `anthropic/claude-opus-4.5`
- **Never** put date extensions in user-facing names
- Model mappings translate friendly → provider-specific IDs internally

### Validation Must Pass Before:
- ❌ Pushing model mapping changes
- ❌ Deploying to production
- ❌ Updating the model catalog

```bash
# Full model update workflow:
./scripts/update-models-native.sh       # Fetch latest from providers
./scripts/validate-models.sh staging    # Validate ALL models work
git add -A
git commit -m "chore: Update model catalog"
git push origin main
npm run deploy:staging
./scripts/validate-models.sh staging    # Re-validate after deploy
npm run deploy                          # Production
./scripts/validate-models.sh production # Final validation
```

---

*Core comes first. Always.*
