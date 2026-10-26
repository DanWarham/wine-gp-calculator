# AI Context — Wine GP Calculator

Detailed product and domain orientation for AI coding assistants and engineers working on this repository.

**Last reviewed against codebase:** 2026-10-22  
**Scope:** Documentation only. Do not treat this file as executable specification if it drifts from source — prefer the referenced source files.

**Documentation authority:**

- Repository and database evidence determine what is currently implemented.
- [`05-project-architecture.md`](./05-project-architecture.md) is the canonical intended architecture and product/domain direction.
- [`06-current-implementation.md`](./06-current-implementation.md) is the canonical current technical overview.
- This file and the other detailed docs provide supporting implementation/reference detail.
- If these sources materially disagree, investigate rather than silently reconciling them.

---

## Project Purpose

Wine GP Calculator helps hospitality / wine-list operators turn a **cost price (ex VAT)** into **suggested retail selling prices** at a target **gross profit percentage (GP %)**.

Users define **pricing rules** that map cost-price bands to GP targets (fixed or linearly interpolated). The calculator then:

1. Selects a suggested GP % from those rules for a given cost.
2. Optionally lets the user nudge GP ±1%.
3. Outputs rounded selling prices for bottle and (when relevant) pour sizes by wine type.

There is **no wine catalogue / inventory product database** in this app. Each calculation is ephemeral. The user’s GP rules, pricing policy, and serving sizes are persisted.

---

## Users

**Expected users (inferred from UI copy and domain):** restaurant / bar / wine-list managers who price wine by bottle and by the glass.

**Typical workflow (from code):**

1. Land on `/welcome` → Login (`/login`). Public self-registration is disabled; accounts are administrator-controlled.
2. After auth, land on `/` (calculator). If no rules exist in `gp_settings`, a modal forces navigation to `/gp-setup`.
3. On `/gp-setup`, create either a **Universal GP** rule or a **Custom Rule Set** (less-than / between / greater-than bands).
4. Return to `/`, enter cost (ex VAT), wine type, bottle size, bottle vs by-the-glass, review suggested prices.
5. Optionally open **Pricing Rules** (`/gp-setup`) or **Settings** (`/settings`), or logout.

---

## Core Domain Concepts

| Term | Meaning in this app | Evidence |
|------|---------------------|----------|
| **GP / Gross Profit %** | Target margin percentage used to derive selling price. Valid calculation range: `0 < GP < 100`. Display may format; calculation keeps full precision. | `src/lib/pricing`, rule forms |
| **Gross Profit** | Not shown as a £ amount; only GP % is used. | UI shows % only |
| **Cost price** | Purchase cost **excluding VAT**. Label: “Cost Price (ex VAT)”. | `src/app/page.tsx` |
| **Selling price** | Customer-facing price in £, derived from cost + VAT treatment + GP. | `src/lib/pricing` |
| **VAT / tax** | User policy `vatRate` (default `0.2` = 20%). Applied inside the selling-price formula. | `pricing_policy` / Settings |
| **Wine type** | `Dry`, `Sparkling`, or `Sweet` (label: “Sweet / Fortified”). Maps to fixed serving-size categories `dry`, `sparkling`, `sweet_fortified`. | `wineCategories.ts` / `servingSizes.ts` |
| **Bottle pricing** | Price for a full bottle (Half 375ml / Bottle 750ml / Magnum 1500ml / Other custom ml). Rounded with the persisted bottle increment. | Home page + pricing domain |
| **Glass / pour pricing** | Enabled persisted servings when “Selling By the Glass”. Rounded with the persisted pour increment. | Home page + `serving_sizes` |
| **Pour sizes** | User-configured per category (defaults: Dry 125/175/250/500; Sparkling 125/150; Sweet 75). Bottle is separate. | `serving_sizes` / Settings |
| **BTG (By The Glass)** | Toggle `isBTG`. When true, shows pour rows and applies the user’s BTG bottle discount (default 5%) to the bottle line only. | Home page + Settings |
| **Pricing rules** | JSON rules mapping cost bands → GP %. Types: `all_gp`, `less_than`, `between`, `greater_than`. | `src/types/rules.ts` |
| **Universal GP** | Single `all_gp` rule: one GP for all costs. | Setup UI |
| **Custom rule set** | Contiguous cost bands: typically one `less_than`, zero+ `between`, one `greater_than`. Gaps/overlaps are validated. | `src/app/gp-setup/page.tsx` |

### Assumptions (not proven by code)

- Users are primarily **UK** venues (default 20% VAT and £ display). Pricing policy is user-configurable via `/settings` (Stage 3B).
- “GP” here is the hospitality trade meaning: margin as a percentage of **selling price**, rearranged into the formula below — not markup-on-cost.
- The BTG bottle discount is a commercial convention (bottle cheaper than equivalent glass pours); default 5%, configurable in Settings.

---

## Core Business Logic

Authoritative financial math lives in **`src/lib/pricing/`** (pure domain; no React/Supabase). The calculator UI in **`src/app/page.tsx`** calls that domain. Rule form helpers remain in **`src/lib/gpRules.ts`**. Canonical rule shapes: **`src/types/rules.ts`**.

### 1. Suggested GP from rules — `resolveTargetGp`

**Source:** `src/lib/pricing/rules.ts`

| | |
|--|--|
| **Inputs** | `actualCostExVat`, `bottleSizeMl`, `rules` |
| **Reference cost** | `actualCostExVat × 750 / bottleSizeMl` |
| **Outputs** | `{ ok, targetGp, matchedRule, referenceCost750ml }` or explicit error |
| **VAT** | Not applied here; rules match on ex-VAT **reference** cost |

**Logic:**

1. Validate cost, bottle ml (&gt; 0), and rule-set structure.
2. If `all_gp` present → that GP.
3. Else find covering band(s) for the reference cost:
   - `less_than`: `cost < max`
   - `greater_than`: `cost > min`
   - `between`: `min ≤ cost ≤ max`, linear interpolate (full precision)
4. Zero matches → `NO_MATCHING_RULE` (no silent 70% fallback).
5. Conflicting multi-match → `AMBIGUOUS_RULE_MATCH`.

Valid margin GP everywhere: **`0 < GP < 100`**.

---

### 2. Selling price — `priceWithGp` / `priceSale`

**Source:** `src/lib/pricing/pricing.ts`

```text
sellingPriceIncVat =
(actualCostExVat × (1 + vatRate))
/
(1 - gp / 100)
```

Product defaults (`DEFAULT_PRICING_POLICY` / DB column defaults): VAT 20%, BTG bottle discount 5%, bottle round £1, pour round £0.50. Persisted per user in `public.pricing_policy`; Settings at `/settings`.

- BTG discount applies only to the displayed full-bottle line.
- Pours scale from the **undiscounted** bottle-equivalent raw price.
- Commercial rounding via `roundToIncrement` using the loaded policy.
- `gpOverride` prices without re-resolving rules (manual nudge path).

---

### 3. Calculator render path

**Source:** `src/app/page.tsx`

1. After auth, load/ensure Pricing Policy (first-use also seeds default Serving Sizes), load Serving Sizes, and load GP rules.
2. Resolve suggested GP via `resolveTargetGp` (full precision into state; display may format).
3. User may nudge GP ±1% while `0 < GP < 100`.
4. Bottle row always uses `priceWithGp` with persisted policy; when BTG, enabled serving sizes for the selected category are priced in `display_order` (label · ml).
5. Errors (policy load, serving-size load, rule load, uncovered gap, invalid bottle size, invalid GP) surface as messages. The calculator does not invent prices, substitute `DEFAULT_PRICING_POLICY`, or fill in hardcoded pour rows. A category with no enabled serving sizes shows the bottle price and an empty-serving message.

**Bottle-only mode:** when `!isBTG`, only the bottle row is shown.

---

### 4. Bottle volume resolution

| Selection | ml |
|-----------|-----|
| Half | 375 |
| Bottle | 750 |
| Magnum | 1500 |
| Other | parsed custom ml; **invalid/non-positive → pricing error** (no silent 750) |

---

### 5. Input sanitisation / validation helpers

**Source:** `src/lib/gpRules.ts` (UI forms)

| Function | Behaviour |
|----------|-----------|
| `sanitizeInput(value, isGpField)` | Digits + one `.`; GP → 1 decimal place; price → 2 decimal places |
| `validateInput(value, isGpField)` | Empty allowed; GP in **[1, 100)**; prices **≥ 0** |
| `safeParse(value, isGpField)` | `parseFloat` or `undefined` with the same bounds |

Final structural validity is `validateRuleSetForPricing` in `src/lib/pricing/validation.ts`, called from the Pricing Rules save path and from the pricing engine. Incomplete fields are handled by the rule forms (`setHasError`).

---

### 6. Rule gap / overlap logic (setup)

**Source:** `src/app/gp-setup/page.tsx`

- `findOverlappingRules` — blocks save/edit if ranges intersect (touching edges OK).
- `analyzeGaps` / gap modal — can insert missing `between` rules.
- Engine rejects degenerate/ambiguous structures and fails closed on uncovered reference costs at calculation time.

---

## Main Features

| Feature | How it works | Primary files |
|---------|--------------|---------------|
| Welcome / gate | Unauthenticated entry with Login | `src/app/welcome/page.tsx` |
| Login | `auth.signInWithPassword`; generic non-enumerating failures via `mapLoginError` | `src/app/login/page.tsx`, `src/lib/authErrors.ts` |
| Logout | `auth.signOut` → `/welcome` | Home page |
| Account provisioning | Public signup disabled; administrator-controlled via Supabase Auth | Live Auth config |
| Calculator | Cost, wine type, bottle size, BTG, GP nudge, price table | `src/app/page.tsx` + `src/lib/pricing` |
| Force rule setup | Modal if no `gp_settings.rules` | Home page |
| GP rule editor | Universal or custom bands; overlap/gap UX; persist to Supabase | `src/app/gp-setup/page.tsx` + rule form components |
| Settings | Pricing Policy and Serving Sizes | `src/app/settings/page.tsx` |
| Toasts | Success/error messages (login) | `src/components/toast-provider.tsx` |

**Not present:** public `/signup`, wine inventory, multi-venue accounts, user-defined wine categories, server API routes, Next.js middleware auth guards.

---

## Application Architecture

**Client-centric Next.js App Router SPA-style pages** talking directly to **Supabase** (Auth + Postgres) from the browser.

```
Browser (React client pages)
    │  @supabase/supabase-js
    ▼
Supabase Auth (email/password sessions)
Supabase Postgres (public.gp_settings + auth.users)
```

- **No** `src/app/api/**` route handlers.
- **No** React global store (Redux/Zustand); state is local `useState` / `useEffect`.
- **No** server components doing data fetch for business data; interactive pages are `'use client'`.
- UI: Tailwind CSS v4 + shadcn/ui-style primitives under `src/components/ui`.

---

## Tech Stack

| Layer | Choice | Version / notes |
|-------|--------|-----------------|
| Framework | Next.js App Router | `15.5.28` |
| UI | React | `^19` |
| Language | TypeScript | `^5`, `strict: true` |
| Styling | Tailwind CSS | v4 via `@tailwindcss/postcss` |
| Components | shadcn “new-york” + Radix Slot/Toggle | `components.json` |
| Icons | lucide-react | dependency present; limited use |
| Dialogs | `@headlessui/react` | gap modal on GP setup |
| Backend / DB / Auth | Supabase | `@supabase/supabase-js` `^2.49.4` |
| Hosting (assumed) | Vercel-oriented Next app; stock README deploy notes; **no** `vercel.json` in repo | Assumption for deploy target |

---

## Repository Map

```
wine-gp-calculator/
├── package.json              # scripts: dev, build, start, lint, test
├── vitest.config.ts
├── next.config.ts            # empty/default config
├── tsconfig.json             # @/* → ./src/*
├── components.json           # shadcn config
├── README.md                 # create-next-app boilerplate only
├── docs/                     # this documentation set
├── public/                   # default Next SVGs
└── src/
    ├── app/
    │   ├── layout.tsx        # root layout, fonts, ToastProvider
    │   ├── page.tsx          # calculator UI (consumes pricing domain)
    │   ├── globals.css
    │   ├── welcome/page.tsx
    │   ├── login/page.tsx
    │   ├── gp-setup/page.tsx # Pricing Rules editor
    │   └── settings/page.tsx # Pricing Policy + Serving Sizes
    ├── components/
    │   ├── toast-provider.tsx
    │   ├── rules/            # AllGp, LessThan, GreaterThan, Between forms
    │   └── ui/               # button, card, input, toggle
    ├── lib/
    │   ├── pricing/          # deterministic pricing domain + Vitest suite
    │   ├── gpRules.ts        # form input sanitize/validate/parse
    │   ├── pricingPolicyStore.ts
    │   ├── servingSizeStore.ts
    │   ├── servingSizeDefaults.ts  # provisioning defaults only
    │   ├── wineCategories.ts # calculator wine type → category id
    │   ├── supabaseEnv.ts    # required NEXT_PUBLIC_* browser config
    │   ├── supabaseClient.ts # Supabase browser client from env
    │   ├── authErrors.ts     # non-enumerating login error mapping
    │   └── utils.ts          # cn() classname helper
    └── types/
        ├── rules.ts          # canonical Rule union
        └── servingSizes.ts   # category ids, labels, serving-size shape
```

---

## Important Source Files

| File | Role |
|------|------|
| `src/lib/pricing/` | **Authoritative pricing domain** + financial tests |
| `src/app/page.tsx` | Calculator UI, session gate, load rules; consumes pricing domain |
| `src/lib/gpRules.ts` | Form input helpers: `sanitizeInput`, `validateInput`, `safeParse` |
| `src/types/rules.ts` | Canonical rule TypeScript types |
| `src/types/servingSizes.ts` | Canonical category ids (`dry`, `sparkling`, `sweet_fortified`) and labels |
| `src/lib/wineCategories.ts` | Calculator wine-type values mapped onto those categories |
| `src/app/gp-setup/page.tsx` | Pricing Rules UX, gap/overlap messaging, save to `gp_settings` |
| `src/app/settings/page.tsx` | Pricing Policy and Serving Size editor |
| `src/lib/pricingPolicyStore.ts` | Load/create/save persisted pricing policy |
| `src/lib/servingSizeStore.ts` | Serving size CRUD; calculator filtering |
| `src/lib/supabaseEnv.ts` / `supabaseClient.ts` | Env-based Supabase browser client |
| `src/app/login/page.tsx` | Login flow |
| `src/components/rules/*.tsx` | Editable rule field UIs |
| `src/components/toast-provider.tsx` | Toast context |
| `src/components/ui/*` | Shared UI primitives |
| `src/app/layout.tsx` | App shell + metadata |

There is **no** ORM/schema file in-repo. Live schema is in Supabase project `wine-gp-calculator` (see `DATA_MODEL.md`).

---

## Data Flow

1. **Auth:** User signs up/logs in via Supabase Auth → session stored by supabase-js in the browser.
2. **Session check:** Protected pages call `supabase.auth.getSession()`; missing session → redirect `/welcome`.
3. **Load configuration:** persisted pricing policy, serving sizes, and `gp_settings` for `user_id = session.user.id`. A missing rules row opens the setup modal. Any other rules, policy, or serving-size load failure stops pricing.
4. **Calculate:** User edits cost/options → `useEffect` debounces (~200ms) → `resolveTargetGp` → sets `suggestedGp`/`gp` (full precision) → table calls `priceWithGp` per row with the loaded policy and enabled serving sizes.
5. **Persist rules:** Pricing Rules page inserts or updates `gp_settings.rules` JSONB after editor checks and `validateRuleSetForPricing`.
6. **UI feedback:** Toasts on auth and settings; inline errors on setup; success redirect to `/`.

Calculation results are **not** written to the database.

---

## Important Constraints

1. **Financial calculations must go through `src/lib/pricing`** — do not reintroduce page-local formulas.
2. **Runtime pricing policy** is the persisted `pricing_policy` row. `DEFAULT_PRICING_POLICY` (VAT 0.2, BTG discount 0.05, bottle £1, pour £0.50) is for tests and for alignment with database column defaults. It is not a calculator fallback.
3. **Rules JSON shape** must remain compatible with the `Rule` union in `src/types/rules.ts`.
4. **One `gp_settings` row per user** (`user_id` UNIQUE); save paths assume that.
5. **RLS** requires `auth.uid() = user_id` — the client must be authenticated for read/write. Explicit table grants are also required (Stage 4B2); do not rely on default privileges for new tables.
6. **Client-only Supabase key** is the publishable/anon key pattern; never add service-role keys to frontend.
7. Import rule types from `@/types/rules`. Category ids and labels live in `@/types/servingSizes`.
8. BTG affects the bottle-line discount only. It does not change rule-selected GP. Pours use the undiscounted bottle basis.

---

## Known Issues / Technical Debt

Supported by the repository / live DB (not invented):

1. **No Next middleware** — protection is per-page `getSession` only (deferred).
2. **README** is still create-next-app boilerplate.
3. **Legacy rule gaps** that previously fell through to silent 70% fail closed in the calculator until the rule set is corrected.
4. Misleading legacy `gp_settings` RLS policy name (semantics correct; rename deferred).
5. Residual `supabase_admin` default ACL for public tables (migrations use hardened `postgres` defaults).

---

## Current Development State

| Area | State |
|------|--------|
| Auth (login/logout; admin-provisioned accounts) | Implemented; public signup disabled (Stage 4B1) |
| Calculator + shared pricing engine | Implemented (`src/lib/pricing`) |
| Financial Vitest suite | Implemented |
| GP rule editor with gap/overlap UX | Implemented on `/gp-setup` |
| User-configurable pricing policy UI | Implemented (`/settings`, Stage 3B) |
| User-configurable serving sizes UI | Implemented (`/settings`, Stage 3C) |
| Env-based configuration | Implemented (`NEXT_PUBLIC_SUPABASE_*`, Stage 4B1) |
| DB ownership FK + grants hardening | Implemented (Stage 4B2) |
| API layer | Not present (by design currently) |
| Multi-tenant / org features | Not present |

Commit history language (“Final Update”, etc.) suggests the author considered the calculator + rules path largely complete as a prototype/MVP.

---

## Guidance for Future AI Developers

1. **Do not change pricing formulas casually.** Change `src/lib/pricing` and extend `pricing.test.ts`.
2. Keep calculator UI thin; calculation belongs in the pricing domain.
3. Use **`src/types/rules.ts`** as the single source of truth for rule shapes.
4. Use **`src/lib/gpRules.ts`** for form input helpers. Structural checks use `validateRuleSetForPricing`.
5. Keep Pricing Rules separate from Settings. Category labels come from `SERVING_SIZE_CATEGORY_LABELS`.
6. Do not introduce a `service_role` key in client code.
7. After calculation or rule changes, run `npm test` and manually smoke the calculator.
8. Run `npm test`, `npm run lint`, and `npm run build` after substantive edits.
9. Schema changes belong in Supabase (migrations/dashboard), not only TypeScript — keep `DATA_MODEL.md` updated.
10. Never commit real secrets; if moving credentials to env, use placeholders in docs and `.env.example` only.

---

## Related docs

- [`05-project-architecture.md`](./05-project-architecture.md) — canonical intended architecture  
- [`06-current-implementation.md`](./06-current-implementation.md) — canonical current technical overview  
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — detailed system structure  
- [`DATA_MODEL.md`](./DATA_MODEL.md) — schema and types  
- [`DEVELOPMENT.md`](./DEVELOPMENT.md) — local setup and workflow
