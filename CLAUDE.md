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
N+3. Deploy to Cloudflare
       ↓
   DONE ✓
```

---

*Core comes first. Always.*
