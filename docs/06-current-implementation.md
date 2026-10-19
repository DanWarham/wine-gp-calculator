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

Financial logic still lives primarily in **`src/app/page.tsx`** (client component). This is **not** yet the shared deterministic pricing engine described in [`05-project-architecture.md`](./05-project-architecture.md).

Rule input helpers live in `src/lib/gpRules.ts`; canonical rule types in `src/types/rules.ts`.

Where behaviour below differs from established domain decisions in `05`, treat the code as **legacy** until Pricing Engine Stage 2 replaces it. Do not describe Stage-2 behaviour as already implemented.

### Cost treatment

Cost is entered and matched as **ex-VAT**. Rules currently match on that **actual** ex-VAT cost directly.

**Legacy gap vs architecture:** there is **no** 750ml-equivalent reference-cost normalisation before rule evaluation today. Intended behaviour (match on `actualCostExVat × 750 / bottleSizeMl`, apply GP to actual cost) is established in `05` but not implemented.

### Rule selection — `calculateGP(cost, isBTG, rules)`

1. Empty rules → **70** (legacy silent fallback).
2. Any `all_gp` → that rule’s `gp` (first match).
3. Else first matching band in array order:
   - `less_than`: `cost < max`
   - `greater_than`: `cost > min`
   - `between`: `min ≤ cost ≤ max`, linear interpolate `start_gp → end_gp`
4. No match → **70** (legacy silent fallback).
5. **`isBTG` is accepted but unused.**

### Whole-% GP rounding (legacy)

Caller applies `Math.round(suggested)` to both suggested and active GP before pricing.

**Legacy gap vs architecture:** established decision is full calculation precision through to final commercial price rounding; UI may format GP for display without changing the calculation input.

### Selling-price formula — `calculatePrice(cost, gp)`

```text
VAT_RATE = 0.2
sellingPrice = (cost * (1 + VAT_RATE)) / (1 - gp / 100)
```

### VAT, BTG, scaling, rounding

| Step | Current behaviour |
|------|-------------------|
| VAT | Hardcoded 20%; cost inflated inside formula |
| BTG bottle | If BTG and size is Bottle: `basePrice *= 0.95` |
| Scaling | `(basePrice / baseBottleMl) * ml` |
| Bottle round | Nearest £ (`Math.round`) |
| Pour round | Nearest £0.50 (`Math.round(price * 2) / 2`) |

`baseBottleMl`: Half 375 / Bottle 750 / Magnum 1500 / Other `parseInt` else silent **750**.

Pour catalogues are hardcoded `WINE_SIZES` by wine type — **not** user-configurable serving sizes.

**BTG semantics (current code):** the 5% reduction applies only to the Bottle line when BTG is on; pours scale from the undiscounted base. That commercial shape matches the established BTG decision in `05`; what remains legacy is that VAT, discount factor, rounding, and serving sizes are **hardcoded**, not user-configurable policy.

### Fallback behaviour (legacy)

Silent **70%** when rules are empty or no band matches.

**Legacy only.** Established architecture requires an explicit validation/calculation failure for uncovered / unresolvable reference costs — see [`05-project-architecture.md`](./05-project-architecture.md). Document the 70% path here solely as current implementation until Stage 2 removes it.

### Known unsafe edges (current)

| Issue | Behaviour | vs established architecture |
|-------|-----------|------------------------------|
| **GP = 100** | Allowed by validators/nudge (`[1, 100]`). Formula → **`Infinity`**. | Must reject; require `GP < 100`; max follows input precision (e.g. 99.9%). |
| **Degenerate `between`** (`min === max`) | Division by zero → **NaN** GP → NaN prices. | Must fail explicitly. |
| **Precision loss** | Fractional interpolated GP forced to whole % before pricing. | Must retain full calculation precision. |
| **Silent 70% fallback** | Empty/unmatched rules → 70. | Must fail explicitly. |
| **No 750ml normalisation** | Rules match raw bottle cost. | Must match 750ml-equivalent reference cost. |

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

- Inline `Rule` copies in `src/app/page.tsx` and `src/app/gp-setup/custom/page.tsx` vs `@/types/rules`.
- Local `validateRules` on `/gp-setup` shadows unused export in `src/lib/gpRules.ts`.
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
| Automated financial tests | **None** |
| Test runner / `*.test.*` / `*.spec.*` | **Absent** |
| Scripts | `dev`, `build`, `start`, `lint` (`eslint .`) only |
| Manual validation | Expected for pricing, rounding, rule gaps/overlaps, auth |

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

1. Pricing logic embedded in calculator UI (`page.tsx`).
2. No automated financial tests.
3. GP = 100 → `Infinity` (architecture requires `GP < 100`).
4. Degenerate `between` bands → `NaN`.
5. Whole-% rounding of interpolated GP (architecture requires full precision).
6. Silent fallback GP 70 (architecture requires explicit failure).
7. No 750ml-equivalent rule-cost normalisation.
8. Pricing policy and serving sizes hardcoded (architecture: user-configurable).
9. Duplicated rule types / `validateRules`.
10. Orphan `/gp-setup/custom`.
11. Unused emoji-prefixed rule form duplicates.
12. Broken `public.users` login lookup.
13. Hardcoded Supabase configuration.
14. Absent schema migrations in source control.

---

## Current Feature Status

| Capability | Status |
|------------|--------|
| Auth (signup / login / logout) | **Implemented** |
| Individual wine calculator | **Implemented** (legacy financial path) |
| Pricing rule editing + GP persistence | **Implemented** |
| Shared deterministic pricing engine | **Not implemented** |
| 750ml reference-cost rule matching | **Not implemented** |
| Full-precision GP through final rounding | **Not implemented** (legacy whole-% round) |
| Explicit failure on uncovered rules | **Not implemented** (legacy 70% fallback) |
| User-configurable pricing policy | **Not implemented** (hardcoded defaults) |
| User-configurable serving sizes | **Not implemented** (hardcoded `WINE_SIZES`) |
| Automated financial tests | **Not implemented** |
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
