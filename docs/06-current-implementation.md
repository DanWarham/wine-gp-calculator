# Current Implementation — Wine GP Calculator

Canonical description of **material current technical reality** after Phase 0 (Next.js `15.5.28`) and Stage 4B3 selective dependency remediation (`@supabase/supabase-js` `2.118.0`).

**Authority:** Repository and database evidence determine what is currently implemented. This document describes that reality and should change as it changes. Intended enduring architecture lives in [`05-project-architecture.md`](./05-project-architecture.md). Detailed supporting material remains in [`AI_CONTEXT.md`](./AI_CONTEXT.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DATA_MODEL.md`](./DATA_MODEL.md), and [`DEVELOPMENT.md`](./DEVELOPMENT.md). If these sources materially disagree, investigate rather than silently reconciling them.

Do not treat assessment recommendations or intended architecture as implemented features.

---

## Technology Stack

Resolved from `package.json` / `package-lock.json` (verified Stage 4B3, 2026-10-26):

| Layer | Choice | Version |
|-------|--------|---------|
| Runtime | Node.js | **22 LTS** required (`engines.node` `>=22`, `.nvmrc` `22`) |
| Framework | Next.js (App Router) | `15.5.28` |
| UI | React / React DOM | `19.1.0` |
| Language | TypeScript | `5.8.3` (`strict: true`) |
| Styling | Tailwind CSS | `4.1.4` (via `@tailwindcss/postcss`) |
| Components | shadcn “new-york” style + Radix Slot/Toggle | `components.json` |
| Dialogs | `@headlessui/react` | used on rule-editor gap modal |
| Backend / Auth / DB | Supabase | `@supabase/supabase-js` `^2.118.0` (resolved `2.118.0`) |

Other dependencies exist (e.g. `lucide-react`, `class-variance-authority`); they are not architectural drivers.

---

## Application Structure

- **Router:** Next.js App Router under `src/app`.
- **Rendering:** Interactive pages are `'use client'`. Root `layout.tsx` is a Server Component wrapping fonts + `ToastProvider`.
- **Data access:** Browser talks directly to Supabase via `src/lib/supabaseClient.ts` for configuration/settings reads/writes.
- **API layer:** Trusted Next.js route handlers for commercial pricing-data import only (`/api/pricing-data/validate`, `/api/pricing-data/import`). No service-role key in the browser.
- **Middleware:** No `middleware.ts`.
- **State:** Page-local `useState` / `useEffect`; toast via React Context. No Redux/Zustand/React Query.

```text
Browser (React client pages)
    │  @supabase/supabase-js
    ▼
Supabase Auth + Postgres
  (public.pricing_configurations,
   public.pricing_configuration_snapshots,
   public.pricing_current_events,
   public.serving_sizes,
   auth.users)
```

---

## Routes

| Path | Purpose | Notes |
|------|---------|-------|
| `/welcome` | Public entry (Login) | Public self-registration removed (Stage 4B1) |
| `/login` | Email/password sign-in | Generic non-enumerating failure messages |
| `/` | Wine price calculator | Always loads **Current** Pricing Configuration + Serving Sizes |
| `/pricing-configurations` | Pricing Configurations master/detail | GP Rules + Pricing Policy per named configuration |
| `/settings` | Serving Sizes only | Pricing Policy moved into configurations |
| `/pricing-data` | Pricing source import (Stage 6A) | FnbShop + Micros → immutable snapshot |
| `/pricing-reviews` | Pricing Reviews (Stage 6B/6C) | Cost Change + Full; detail `/pricing-reviews/[id]`; Action Doc `/pricing-reviews/[id]/actions` |

`/signup` and `/gp-setup` are unsupported (404). New accounts are administrator-controlled via Supabase Auth admin/manual provisioning.

Navigation: Calculator · Pricing Configurations · Pricing Data · Pricing Reviews · Settings (`AppNav`).

Auth protection is per-page `supabase.auth.getSession()` only.

---

## Current Financial Implementation

**Authoritative pricing domain:** `src/lib/pricing/` (pure TypeScript; no React/Supabase).

The calculator (`src/app/page.tsx`) collects inputs and displays results; it calls `resolveTargetGp` / `priceWithGp` rather than embedding formula logic.

Canonical rule types: `src/types/rules.ts`. UI input helpers: `src/lib/gpRules.ts` (`sanitizeInput`, `validateInput`, `safeParse` only). Default commercial policy: `DEFAULT_PRICING_POLICY` in `src/lib/pricing/defaults.ts`, used for tests and provisioning semantics, not as a calculator fallback.

Automated financial regression tests: `src/lib/pricing/pricing.test.ts` via Vitest (`npm test`).

### Cost treatment and 750ml rule normalisation

Acquisition cost is **ex-VAT**.

Rule matching uses:

```text
referenceCost750ml = actualCostExVat × 750 / bottleSizeMl
```

Resolved GP is applied to **actualCostExVat** in the selling-price formula.

### Rule resolution

1. Empty / structurally invalid rules → explicit failure (no silent 70% fallback).
2. `all_gp` → that rule’s `gp`.
3. Else unique covering band for the reference cost:
   - `less_than`: `cost < max`
   - `greater_than`: `cost > min`
   - `between`: `min ≤ cost ≤ max`, linear interpolate `start_gp → end_gp` (**full precision**)
4. No match or conflicting multi-match → explicit failure.

### GP precision and validity

- Interpolation and pricing retain full calculation precision (no whole-% round before pricing).
- UI may format GP for display without changing the calculation value.
- Valid margin GP: `0 < GP < 100`. GP ≥ 100 is rejected.
- Manual nudge/override uses the same bounds via `priceWithGp` / `isValidGp`.

### Selling-price formula

```text
sellingPriceIncVat =
(actualCostExVat × (1 + vatRate))
/
(1 - gp / 100)
```

### Pricing Configurations (persisted; Stage 5)

A **Pricing Configuration** combines GP Rules + Pricing Policy (Serving Sizes remain separate).

| Field | Default | Stored as |
|-------|---------|-----------|
| VAT rate | 20% | `vat_rate` `0.20` |
| BTG bottle discount | 5% | `btg_bottle_discount` `0.05` |
| Bottle rounding | £1.00 | `bottle_rounding_increment` `1.00` |
| Pour/glass rounding | £0.50 | `pour_rounding_increment` `0.50` |

- Runtime table: `public.pricing_configurations` (many per user; exactly one `is_current`).
- Migrated legacy Current → named **Main Pricing** (`is_current = true`).
- UI: `/pricing-configurations` master/detail (create from Current / another / blank; archive/restore; Make Current).
- Persistence: `src/lib/pricingConfigurationStore.ts`.
- Calculator always loads Current only (no configuration picker).
- Saving edits does **not** create snapshots. Snapshots are created/reused on Make Current (and future Pricing Review / Scenario).
- Immutable snapshots: `public.pricing_configuration_snapshots` (deduped by `source_configuration_id + content_hash`).
- Promotion history: `public.pricing_current_events` (factual Make Current events; not effective-dating).
- Legacy `gp_settings` / `pricing_policy` have been **dropped** after Stage 5A acceptance.
- Pure engine in `src/lib/pricing/` unchanged in responsibility.

### BTG, scaling, rounding

| Step | Behaviour |
|------|-----------|
| BTG bottle | Discount applies only to displayed full-bottle line |
| Pours | Scale from **undiscounted** bottle-equivalent raw price |
| Rounding | `roundToIncrement` with persisted policy increments |

Bottle sizes: 375 / 750 / 1500 / custom positive ml. **Invalid custom volume fails** in the pricing domain (no silent 750ml fallback).

Pour catalogues are persisted per user in `serving_sizes` (Stage 3C). Provisioning defaults: Dry 125/175/250/500, Sparkling 125/150, Sweet / Fortified 75. Bottle is not a serving-size row. The calculator reads persisted rows only. An empty or fully disabled category shows the bottle line and states that no serving sizes are enabled. It does not invent pour rows.

### Pricing data import (Stage 6A)

- Route `/pricing-data`: upload FnbShop Recipe Detail + three Micros CSVs → validate → complete.
- Server parse/normalise in `/api/pricing-data/*`; persist via `commit_pricing_data_import`.
- Canonical immutable observations support later Cost Change Review; previous-import helper RPC provided.
- V1 source rules are Lime Wood–specific (wine PLU range 5000000–5999999 in the current parser only).

### Cost Change Review (Stage 6B) + Full Pricing Review / Action Document (Stage 6C)

- Route `/pricing-reviews`: create/open Cost Change Reviews or Full Pricing Reviews.
- Imports carry required `data_month` (display e.g. October 2026). Cost Change compares the latest data month with the previous available data month (latest upload within each month). `imported_at` remains audit metadata.
- Captures an immutable Current Pricing Configuration snapshot + GP tolerance (default 1.0 pts).
- Observation/review-item reads paginate past PostgREST `max_rows` (1000); review create appends items in batches.
- Full Review: every eligible full bottle under the latest import; attention when current GP &lt; target GP − tolerance.
- Completed reviews: printable Action Document at `/pricing-reviews/[id]/actions`.
- Pricing Data: month picker, duplicate-month warning, safe Delete Import (blocked when a completed review depends on it; draft reviews referencing the import are removed), issue table + Export Issues CSV.
- Pure domain: `src/lib/pricingReview/`; persistence: `pricing_reviews` / `pricing_review_items`.

### Remaining gaps after Stage 6C

- Scenario Modelling / sales uploads
- User-facing snapshot manager (not required; snapshots are infrastructure)
- User-defined wine categories (explicitly deferred)
- Rule editor keeps overlap messaging and gap assistance. Final structural validity is `validateRuleSetForPricing`.

---

## Current Pricing Rules

### Rule types (JSONB)

| `type` | Fields | Meaning |
|--------|--------|---------|
| `all_gp` | `gp` | Universal GP |
| `less_than` | `max`, `gp` | Cost &lt; max |
| `greater_than` | `min`, `gp` | Cost &gt; min |
| `between` | `min`, `max`, `start_gp`, `end_gp` | Inclusive band; linear GP interpolation |

Canonical TypeScript: `src/types/rules.ts`. No DB-level JSON schema validation.

### Validation / gaps / overlaps

- Active pages import `Rule` from `src/types/rules.ts`.
- Editor overlap check in `RuleSetEditor` blocks intersecting ranges (touching edges are allowed) and explains the clash.
- Gap analysis can offer to insert missing `between` rules. Contiguity is a UI convention; the database does not enforce it.
- Save then calls `validateRuleSetForPricing`. That is the only final structural check.
- Rule field forms are `src/components/rules/{AllGp,LessThan,GreaterThan,Between}RuleForm.tsx`.
- Calculator, Pricing Configurations, and Settings distinguish loading, a loaded configuration, a valid empty serving-size list, and a configuration load error. Load failures do not substitute default policy, hardcoded pour sizes, or a fallback GP.

---

## Current Database

Verified against live Supabase project `jcylgbtifwpcjncnnfok` (` wine-gp-calculator`):

### Entities

| Entity | Role |
|--------|------|
| `auth.users` | Supabase Auth identities |
| `public.pricing_configurations` | Editable Pricing Configurations (rules + policy); one Current per user |
| `public.pricing_configuration_snapshots` | Immutable configuration snapshots (deduped) |
| `public.pricing_current_events` | Make Current promotion history |
| `public.serving_sizes` | User pour/carafe sizes within fixed categories |
| `public.pricing_items` | Persistent PLU identity for pricing imports |
| `public.pricing_data_imports` | Immutable completed pricing import events |
| `public.pricing_observations` | Per-item observed cost/price state per import |
| `public.pricing_import_issues` | Item exceptions / informational import issues |
| `public.pricing_reviews` | Cost Change and Full Pricing Reviews |
| `public.pricing_review_items` | Per-item cost-change calculations and decisions |

**No** sales or scenario tables yet. Categories are not user-configurable. See [`DATA_MODEL.md`](./DATA_MODEL.md) for field-level detail.

### `public.serving_sizes` (unchanged)

| Column | Notes |
|--------|-------|
| `category` | `dry` \| `sparkling` \| `sweet_fortified` |
| `label` / `volume_ml` | Named pour; integer ml `> 0` |
| `enabled` / `display_order` | Calculator shows enabled rows in order |
| `user_id` | FK → `auth.users` ON DELETE CASCADE |

- **Provisioning:** future users seeded only on first Current Pricing Configuration creation.
- **Helpers:** `src/lib/servingSizeStore.ts`, defaults in `src/lib/servingSizeDefaults.ts`.

**Migrations applied through Stage 5:** `20261019134900` … `20261027093617`.

Row counts are volatile point-in-time observations and are not architectural facts.

### Grants vs RLS

| Layer | Role |
|-------|------|
| SQL grants | Which operations a role may attempt |
| RLS | Which rows an authenticated identity may access |

Both are intentional. RLS remains the row-security authority.

---

## Authentication / Authorization

| Concern | Current state |
|---------|---------------|
| Auth provider | Supabase Auth email/password |
| Public signup | **Disabled** (Stage 4B1). Accounts are administrator-controlled |
| Login / logout | Implemented client-side |
| Login failures | Generic “Invalid email or password.” — no account-existence lookup |
| Session gates | Per-page `getSession()`; redirect to `/welcome` |
| RLS boundary | User-owned tables gated by `auth.uid() = user_id` |
| Server password minimum | **8** characters (aligned with former UI policy) |
| Email autoconfirm | Still **enabled** on the live project (deferred; public signup is the required control) |
| Leaked-password protection | Supabase security advisor: **disabled** (WARN) — Free-plan limitation |

---

## Configuration

| Item | Reality |
|------|---------|
| Supabase URL + anon key | From `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` via `src/lib/supabaseEnv.ts` |
| Missing env | Clear configuration error (no hardcoded fallback) |
| `.env.example` | Placeholders only (committed) |
| `.env.local` | Local ignored file for real browser-safe values |
| Privileged credentials | Must never use `NEXT_PUBLIC_*`; none in browser code |
| Deploy evidence | Standard Next app; host must supply the two `NEXT_PUBLIC_*` vars |

Assumption: production is a Next.js host (often Vercel) plus hosted Supabase — confirm with owner if different.

---

## Testing

| Area | Reality |
|------|---------|
| Automated tests | **Vitest**: pricing domain, pricing-configuration store helpers, serving-size helpers, wine-category mapping |
| Scripts | `dev`, `build`, `start`, `lint`, `test`, `test:watch` |
| Manual validation | Still expected for calculator UX smoke (auth, rule setup, BTG display) |

---

## Database Development Workflow

- Source-controlled Supabase migrations exist under `supabase/migrations/`.
- Stages 3A–3C established legacy tables; Stage 4B2 hardened grants; Stage 5 added Pricing Configurations + snapshots + current-events.
- Future application schema changes are **migration-first** with **explicit grants + RLS** (see [`DEVELOPMENT.md`](./DEVELOPMENT.md)).
- Authority: migrations = intended/applied evolution; live Supabase = deployed state; this doc / `DATA_MODEL.md` = human-readable.
- Dashboard-only schema edits should not be normal practice; reconcile any emergency manual changes into migrations.

Local Docker is not required merely to author or review migrations.

---

## Security State (after Phase 0 + Stage 4B1–4B3 + Stage 5)

| Item | Status |
|------|--------|
| Next.js | Remains **`15.5.28`** (patched 15.x; no Next 16 upgrade) |
| Critical React Flight / Image Optimization advisories motivating Phase 0 / 4B3 Next line | Cleared on current 15.5.28 install |
| `@supabase/supabase-js` | Updated to stable **`2.118.0`** (Stage 4B3); no canary; no child-package overrides |
| Node runtime | **Node 22 LTS** required (Stage 4B3 amendment); Node 20 unsupported by supabase-js 2.110+ |
| Env-based client config + closed signup (Stage 4B1) | **Done** |
| `gp_settings` FK + grant/default-privilege hardening (Stage 4B2) | **Done** |
| Pricing Configurations RLS/grants + controlled RPCs (Stage 5) | **Done** |
| Selective dependency remediation (Stage 4B3) | **Done** — targeted runtime update only; no `npm audit fix --force` |
| Residual `npm audit` findings | Accepted where development-only or Next-controlled transitive (see below) |
| Import trust boundary for commercial sales | Later stage |

### Residual accepted audit findings (Stage 4B3)

Post-4B3 `npm audit`: **14** findings (2 critical, 6 high, 4 moderate, 2 low). Count is not clearance. Material residual classes:

| Class | Examples | Production? | Why retained | Revisit when |
|-------|----------|-------------|--------------|--------------|
| Next transitive | `postcss` under `next@15.5.28` | Build/runtime via Next | Upstream pins; fix path proposes Next 16 | Compatible Next 15.x patch or planned Next major |
| Vitest toolchain | `tinypool` (critical), `@vitest/mocker` | Dev/test only | Fix requires Vitest 4 major | Planned tooling refresh |
| ESLint/toolchain | `eslint` / `@eslint/plugin-kit`, `brace-expansion`, `minimatch`, `js-yaml`, `flatted`, `ajv`, `picomatch`, `@humanfs/node` | Dev/lint only | Compatible patches possible later; not production runtime | Compatible minor bumps or ESLint refresh |

`@supabase/auth-js` and `ws` advisories from Stage 4A are **not** present after the 2.118.0 update (`ws` no longer in the tree).

**Do not claim complete security clearance.**

---

## Technical Debt / Known Defects

Prioritised for orientation (not exhaustive assessment dump):

1. Persisted rule sets that historically relied on silent 70% gap behaviour surface explicit calculator errors until rules are fixed.
2. Wine categories remain fixed (not user-configurable).
3. Residual `supabase_admin` default ACL still auto-grants broad public-table rights if objects are created as that role (migrations use `postgres`; postgres defaults hardened).
4. No Next middleware — protection remains per-page `getSession` (deferred).

---

## Current Feature Status

| Capability | Status |
|------------|--------|
| Auth (login / logout; admin-provisioned accounts) | **Implemented** (public signup disabled) |
| Individual wine calculator | **Implemented** (uses shared engine) |
| Pricing Configurations (rules + policy, alternatives, archive) | **Implemented** (`/pricing-configurations`) |
| Current status + Make Current + promotion history | **Implemented** |
| Immutable configuration snapshots (capture/reuse) | **Implemented** (infrastructure; no user manager UI) |
| Shared deterministic pricing engine | **Implemented** (`src/lib/pricing`) |
| Calculator always uses Current | **Implemented** |
| 750ml reference-cost rule matching | **Implemented** |
| Full-precision GP through final rounding | **Implemented** |
| Explicit failure on uncovered rules | **Implemented** |
| Automated financial tests | **Implemented** (Vitest) |
| User-configurable serving sizes | **Implemented** (`serving_sizes`, Settings only) |
| Pricing Review | **Not implemented** |
| Sales import | **Not implemented** |
| Canonical sales model | **Not implemented** |
| Scenario analysis | **Not implemented** |
| Reusable source-to-canonical mappings | **Not implemented** |

---

## Related Documents

| Document | Role |
|----------|------|
| [`05-project-architecture.md`](./05-project-architecture.md) | Intended enduring architecture |
| [`AI_CONTEXT.md`](./AI_CONTEXT.md) | Detailed calculation/domain reference |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Detailed system structure |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | Schema and types |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Setup and commands |
| [`ARCHITECTURE_BASELINE_ASSESSMENT.md`](./ARCHITECTURE_BASELINE_ASSESSMENT.md) | Pre-/peri-Phase-0 assessment evidence (historical) |
