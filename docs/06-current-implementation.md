# Current Implementation — Wine GP Calculator

Canonical description of **material current technical reality** after the accepted Phase 0 dependency security correction (Next.js upgraded to `15.5.28`).

**Authority:** Repository and database evidence determine what is currently implemented. This document describes that reality and should change as it changes. Intended enduring architecture lives in [`05-project-architecture.md`](./05-project-architecture.md). Detailed supporting material remains in [`AI_CONTEXT.md`](./AI_CONTEXT.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DATA_MODEL.md`](./DATA_MODEL.md), and [`DEVELOPMENT.md`](./DEVELOPMENT.md). If these sources materially disagree, investigate rather than silently reconciling them.

Do not treat assessment recommendations or intended architecture as implemented features.

---

## Technology Stack

Resolved from `package.json` / `package-lock.json` (verified 2026-10-19):

| Layer | Choice | Version |
|-------|--------|---------|
| Framework | Next.js (App Router) | `15.5.28` |
| UI | React / React DOM | `19.1.0` |
| Language | TypeScript | `5.8.3` (`strict: true`) |
| Styling | Tailwind CSS | `4.1.4` (via `@tailwindcss/postcss`) |
| Components | shadcn “new-york” style + Radix Slot/Toggle | `components.json` |
| Dialogs | `@headlessui/react` | used on GP setup gap modal |
| Backend / Auth / DB | Supabase | `@supabase/supabase-js` `2.49.4` |

Other dependencies exist (e.g. `lucide-react`, `class-variance-authority`); they are not architectural drivers.

---

## Application Structure

- **Router:** Next.js App Router under `src/app`.
- **Rendering:** Interactive pages are `'use client'`. Root `layout.tsx` is a Server Component wrapping fonts + `ToastProvider`.
- **Data access:** Browser talks directly to Supabase via `src/lib/supabaseClient.ts`.
- **API layer:** No `src/app/api/**` route handlers; no Server Actions for business data.
- **Middleware:** No `middleware.ts`.
- **State:** Page-local `useState` / `useEffect`; toast via React Context. No Redux/Zustand/React Query.

```text
Browser (React client pages)
    │  @supabase/supabase-js
    ▼
Supabase Auth + Postgres
  (public.gp_settings, public.pricing_policy, public.serving_sizes, auth.users)
```

---

## Routes

| Path | Purpose | Notes |
|------|---------|-------|
| `/welcome` | Public entry (Login) | Public self-registration removed (Stage 4B1) |
| `/login` | Email/password sign-in | Generic non-enumerating failure messages |
| `/` | Wine price calculator | Loads persisted rules, pricing policy, and serving sizes |
| `/gp-setup` | Pricing Rules editor | GP bands; separate from Settings |
| `/settings` | Pricing Policy + Serving Sizes | VAT/BTG/rounding; per-category pour sizes |

`/signup` is intentionally unsupported (404). New accounts are administrator-controlled via Supabase Auth admin/manual provisioning.

Navigation on Calculator, Pricing Rules, and Settings names those three destinations and marks the current one. `/gp-setup/custom` has been removed; that URL is a normal 404.

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

### Pricing policy (persisted; Stage 3B)

Defaults (DB column defaults + `DEFAULT_PRICING_POLICY` for tests/provisioning semantics):

| Field | Default | Stored as |
|-------|---------|-----------|
| VAT rate | 20% | `vat_rate` `0.20` |
| BTG bottle discount | 5% | `btg_bottle_discount` `0.05` |
| Bottle rounding | £1.00 | `bottle_rounding_increment` `1.00` |
| Pour/glass rounding | £0.50 | `pour_rounding_increment` `0.50` |

- Table: `public.pricing_policy` (one row per user; FK to `auth.users`).
- Settings UI: `/settings` (separate from Pricing Rules `/gp-setup`).
- Persistence helper: `src/lib/pricingPolicyStore.ts` (`getOrCreatePricingPolicy` / `savePricingPolicy`).
- Calculator loads policy after auth and passes it into `priceWithGp`; does **not** use `DEFAULT_PRICING_POLICY` as operational user policy.
- Pure engine in `src/lib/pricing/` unchanged in responsibility.

### BTG, scaling, rounding

| Step | Behaviour |
|------|-----------|
| BTG bottle | Discount applies only to displayed full-bottle line |
| Pours | Scale from **undiscounted** bottle-equivalent raw price |
| Rounding | `roundToIncrement` with persisted policy increments |

Bottle sizes: 375 / 750 / 1500 / custom positive ml. **Invalid custom volume fails** in the pricing domain (no silent 750ml fallback).

Pour catalogues are persisted per user in `serving_sizes` (Stage 3C). Provisioning defaults: Dry 125/175/250/500, Sparkling 125/150, Sweet / Fortified 75. Bottle is not a serving-size row. The calculator reads persisted rows only. An empty or fully disabled category shows the bottle line and states that no serving sizes are enabled. It does not invent pour rows.

### Remaining gaps after Stage 3D

- Pricing configuration versioning
- User-defined wine categories (explicitly deferred)
- Pricing Rules keeps editor-only overlap messaging and gap assistance on `/gp-setup`. Final structural validity is `validateRuleSetForPricing`.

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
- Editor overlap check on `/gp-setup` blocks intersecting ranges (touching edges are allowed) and explains the clash.
- Gap analysis can offer to insert missing `between` rules. Contiguity is a UI convention; the database does not enforce it.
- Save then calls `validateRuleSetForPricing`. That is the only final structural check.
- Rule field forms are `src/components/rules/{AllGp,LessThan,GreaterThan,Between}RuleForm.tsx`.
- Calculator, Pricing Rules, and Settings distinguish loading, a loaded configuration, a valid empty serving-size list, and a configuration load error. Load failures do not substitute default policy, hardcoded pour sizes, or a fallback GP.

---

## Current Database

Verified against live Supabase project `jcylgbtifwpcjncnnfok` (` wine-gp-calculator`):

### Entities

| Entity | Role |
|--------|------|
| `auth.users` | Supabase Auth identities |
| `public.gp_settings` | One JSONB GP rule document per user |
| `public.pricing_policy` | One commercial pricing-policy row per user |
| `public.serving_sizes` | User pour/carafe sizes within fixed categories |

**No** sales, scenario, import, or pricing-version tables. Categories are not user-configurable.

### `public.gp_settings`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` UNIQUE NOT NULL | Logical owner; **no FK** to `auth.users` |
| `rules` | `jsonb` nullable | Rule array |
| `created_at` | `timestamp` | Default `now()` |

- **RLS:** enabled; policy `"Policy with security definer functions"` allows ALL where `auth.uid() = user_id` (USING + WITH CHECK).

### `public.pricing_policy` (Stage 3B)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `user_id` | `uuid` UNIQUE | FK → `auth.users` ON DELETE CASCADE |
| `vat_rate` | `numeric` | Default `0.20` |
| `btg_bottle_discount` | `numeric` | Default `0.05`; must be `< 1` |
| `bottle_rounding_increment` | `numeric` | Default `1.00`; must be `> 0` |
| `pour_rounding_increment` | `numeric` | Default `0.50`; must be `> 0` |
| `created_at` / `updated_at` | `timestamptz` | |

- **RLS:** select/insert/update own row for `authenticated` only.
- **Migrations:** baseline `20261019134900` + `20261019223922_create_pricing_policy` + `20261022104800_create_serving_sizes` (applied locally and remotely).

### `public.serving_sizes` (Stage 3C)

| Column | Notes |
|--------|-------|
| `category` | `dry` \| `sparkling` \| `sweet_fortified` |
| `label` / `volume_ml` | Named pour; integer ml `> 0` |
| `enabled` / `display_order` | Calculator shows enabled rows in order |
| `user_id` | FK → `auth.users` ON DELETE CASCADE |

- **RLS:** select/insert/update/delete own rows for `authenticated`.
- **Provisioning:** seeded for existing users in migration; future users seeded only on first Pricing Policy creation.
- **Helpers:** `src/lib/servingSizeStore.ts`, defaults in `src/lib/servingSizeDefaults.ts`.

Row counts are volatile point-in-time observations and are not architectural facts.

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
| Automated tests | **Vitest**: pricing domain, pricing-policy store helpers, serving-size helpers, wine-category mapping |
| Scripts | `dev`, `build`, `start`, `lint`, `test`, `test:watch` |
| Manual validation | Still expected for calculator UX smoke (auth, rule setup, BTG display) |

---

## Database Development Workflow

- Source-controlled Supabase migrations exist under `supabase/migrations/`.
- Stage 3A baselined `gp_settings`; Stage 3B added `pricing_policy`; Stage 3C added `serving_sizes`.
- Future application schema changes are **migration-first** (see [`DEVELOPMENT.md`](./DEVELOPMENT.md)).
- Authority: migrations = intended/applied evolution; live Supabase = deployed state; this doc / `DATA_MODEL.md` = human-readable.
- Dashboard-only schema edits should not be normal practice; reconcile any emergency manual changes into migrations.

Local Docker is not required merely to author or review migrations.

---

## Security State (after Phase 0)

| Item | Status |
|------|--------|
| Next.js | Upgraded to **`15.5.28`** |
| Critical React Flight RCE advisory motivating Phase 0 | **Cleared** (`npm audit` critical count = 0 as of verification) |
| Remaining `npm audit` findings | Still present (high/moderate/low; total 26 at verification) — not claimed cleared |
| Supabase / runtime dependency hygiene | Future-scoped work |
| Env-based client config + closed signup (Stage 4B1) | **Done** |
| Remaining grants / `gp_settings` FK / import trust boundary | Stage 4B2+ |

**Do not claim complete security clearance.**

---

## Technical Debt / Known Defects

Prioritised for orientation (not exhaustive assessment dump):

1. Persisted rule sets that historically relied on silent 70% gap behaviour surface explicit calculator errors until rules are fixed.
2. Wine categories remain fixed (not user-configurable).
3. `gp_settings.user_id` still has no foreign key to `auth.users` (Stage 4B2).
4. Broad default/table grants remain; RLS is the effective control (Stage 4B2).
5. No Next middleware — protection remains per-page `getSession` (deferred).

---

## Current Feature Status

| Capability | Status |
|------------|--------|
| Auth (login / logout; admin-provisioned accounts) | **Implemented** (public signup disabled) |
| Individual wine calculator | **Implemented** (uses shared engine) |
| Pricing rule editing + GP persistence | **Implemented** |
| Shared deterministic pricing engine | **Implemented** (`src/lib/pricing`) |
| 750ml reference-cost rule matching | **Implemented** |
| Full-precision GP through final rounding | **Implemented** |
| Explicit failure on uncovered rules | **Implemented** |
| Automated financial tests | **Implemented** (Vitest) |
| Explicit pricing-policy type + defaults | **Implemented** |
| User-configurable pricing policy UI + persistence | **Implemented** (`/settings`, `pricing_policy`) |
| User-configurable serving sizes | **Implemented** (`serving_sizes`, Settings) |
| Pricing rule/policy versioning | **Not implemented** |
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
