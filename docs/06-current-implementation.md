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
Supabase Auth + Postgres (public.gp_settings, auth.users)
```

---

## Routes

| Path | Purpose | Notes |
|------|---------|-------|
| `/welcome` | Public entry (Login / Register) | |
| `/login` | Email/password sign-in | |
| `/signup` | Email/password registration | Open signup |
| `/` | Wine price calculator | Client session check |
| `/gp-setup` | Pricing rule editor | Primary rule UX |
| `/gp-setup/custom` | Alternate multi-step wizard | **Unlinked/orphaned** — reachable by URL only; not intended architecture |

Auth protection is per-page `supabase.auth.getSession()` only.

---

## Current Financial Implementation

**Authoritative pricing domain:** `src/lib/pricing/` (pure TypeScript; no React/Supabase).

The calculator (`src/app/page.tsx`) collects inputs and displays results; it calls `resolveTargetGp` / `priceWithGp` rather than embedding formula logic.

Canonical rule types: `src/types/rules.ts`. UI input helpers: `src/lib/gpRules.ts`. Default commercial policy: `DEFAULT_PRICING_POLICY` in `src/lib/pricing/defaults.ts`.

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

### Pricing policy (Stage-2 defaults; not yet user-configurable UI)

| Field | Default |
|-------|---------|
| `vatRate` | `0.2` (20%) |
| `btgBottleDiscount` | `0.05` (5%) |
| `bottleRoundingIncrement` | `1` (£1) |
| `pourRoundingIncrement` | `0.5` (£0.50) |

### BTG, scaling, rounding

| Step | Behaviour |
|------|-----------|
| BTG bottle | Discount applies only to displayed full-bottle line |
| Pours | Scale from **undiscounted** bottle-equivalent raw price |
| Rounding | `roundToIncrement` with policy increments |

Bottle sizes: 375 / 750 / 1500 / custom positive ml. **Invalid custom volume fails** in the pricing domain (no silent 750ml fallback).

Pour catalogues remain hardcoded `WINE_SIZES` (Sparkling includes 125ml and 150ml) until Stage 3.

### Remaining Stage-3 gaps (not Stage-2 defects)

- User-configurable pricing-policy persistence/UI
- User-configurable serving sizes
- Pricing configuration versioning
- Setup-page `validateRules` still duplicated vs `gpRules.ts` (editor UX; engine has `validateRuleSetForPricing`)

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

Primary UX on `/gp-setup`:

- Overlap check blocks intersecting ranges (touching edges OK).
- Gap analysis can offer to insert missing `between` rules.
- Contiguity is a UI convention; DB does not enforce it.

### Duplication / drift risks

- Calculator imports `@/types/rules`; orphan `/gp-setup/custom` still has inline Rule copies.
- `/gp-setup` save path uses `validateRuleSetForPricing` as the authoritative final check; page retains UX-only overlap/gap helpers.
- `src/lib/gpRules.validateRules` performs field completeness then delegates structural checks to the pricing domain.
- Emoji-prefixed unused rule form duplicates under `src/components/rules/`.

---

## Current Database

Verified against live Supabase project `jcylgbtifwpcjncnnfok` (` wine-gp-calculator`):

### Entities

| Entity | Role |
|--------|------|
| `auth.users` | Supabase Auth identities |
| `public.gp_settings` | One JSONB rule document per user |

**No** sales, scenario, import, or pricing-version tables.

### `public.gp_settings`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` UNIQUE NOT NULL | Logical owner; **no FK** to `auth.users` |
| `rules` | `jsonb` nullable | Rule array |
| `created_at` | `timestamp` | Default `now()` |

- **RLS:** enabled; policy allows ALL where `auth.uid() = user_id`.
- **Migrations:** none in repository; remote migration history empty (`list_migrations` = `[]`).

Row counts are volatile point-in-time observations and are not architectural facts.

---

## Authentication / Authorization

| Concern | Current state |
|---------|---------------|
| Auth provider | Supabase Auth email/password |
| Signup / login / logout | Implemented client-side |
| Session gates | Per-page `getSession()`; redirect to `/welcome` |
| RLS boundary | `gp_settings` owned by `auth.uid()` |
| Login defect | Failed-login path queries `public.users` — table **does not exist** (only `auth.users`). Lookup always fails; messaging can mislead |
| Leaked-password protection | Supabase security advisor: **disabled** (WARN) — still current |

---

## Configuration

| Item | Reality |
|------|---------|
| Supabase URL + anon key | **Hardcoded** in `src/lib/supabaseClient.ts` |
| `process.env` / `NEXT_PUBLIC_*` | Not used by application code |
| `.env*` | Ignored by git; unused by app today |
| Deploy evidence | Standard Next app; README Vercel boilerplate; no `vercel.json` / CI / Docker in repo |

Assumption: production is a Next.js host (often Vercel) plus hosted Supabase — confirm with owner if different.

---

## Testing

| Area | Reality |
|------|---------|
| Automated financial tests | **Vitest** domain suite in `src/lib/pricing/pricing.test.ts` |
| Scripts | `dev`, `build`, `start`, `lint`, `test`, `test:watch` |
| Manual validation | Still expected for calculator UX smoke (auth, rule setup, BTG display) |

---

## Database Development Workflow

- No migration baseline in the repository.
- Live hosted schema is the source of truth today.
- Schema changes are performed outside git (dashboard / external tooling).
- Migration workflow is **not yet established**.

Establishing source-controlled migrations is an intended prerequisite before sales schema expansion ([`05-project-architecture.md`](./05-project-architecture.md)), not current practice.

---

## Security State (after Phase 0)

| Item | Status |
|------|--------|
| Next.js | Upgraded to **`15.5.28`** |
| Critical React Flight RCE advisory motivating Phase 0 | **Cleared** (`npm audit` critical count = 0 as of verification) |
| Remaining `npm audit` findings | Still present (high/moderate/low; total 26 at verification) — not claimed cleared |
| Supabase / runtime dependency hygiene | Future-scoped work |
| Hardcoded client config, open signup, no import trust boundary | Unchanged |

**Do not claim complete security clearance.**

---

## Technical Debt / Known Defects

Prioritised for orientation (not exhaustive assessment dump):

1. Pricing policy / serving sizes still default/hardcoded in UI (Stage 3 configurability).
2. Orphan `/gp-setup/custom`.
3. Unused emoji-prefixed rule form duplicates.
4. Broken `public.users` login lookup.
5. Hardcoded Supabase configuration.
6. Absent schema migrations in source control.
7. Persisted rule sets that historically relied on silent 70% gap behaviour will now surface explicit calculator errors until rules are fixed.

---

## Current Feature Status

| Capability | Status |
|------------|--------|
| Auth (signup / login / logout) | **Implemented** |
| Individual wine calculator | **Implemented** (uses shared engine) |
| Pricing rule editing + GP persistence | **Implemented** |
| Shared deterministic pricing engine | **Implemented** (`src/lib/pricing`) |
| 750ml reference-cost rule matching | **Implemented** |
| Full-precision GP through final rounding | **Implemented** |
| Explicit failure on uncovered rules | **Implemented** |
| Automated financial tests | **Implemented** (Vitest) |
| Explicit pricing-policy type + defaults | **Implemented** (UI config Stage 3) |
| User-configurable pricing policy UI | **Not implemented** |
| User-configurable serving sizes | **Not implemented** (hardcoded `WINE_SIZES`) |
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
