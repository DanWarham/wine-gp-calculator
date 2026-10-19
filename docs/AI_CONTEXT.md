# AI Context — Wine GP Calculator

Primary orientation document for AI coding assistants and engineers working on this repository.

**Last reviewed against codebase:** 2026-10-19  
**Scope:** Documentation only. Do not treat this file as executable specification if it drifts from source — prefer the referenced source files.

---

## Project Purpose

Wine GP Calculator helps hospitality / wine-list operators turn a **cost price (ex VAT)** into **suggested retail selling prices** at a target **gross profit percentage (GP %)**.

Users define **pricing rules** that map cost-price bands to GP targets (fixed or linearly interpolated). The calculator then:

1. Selects a suggested GP % from those rules for a given cost.
2. Optionally lets the user nudge GP ±1%.
3. Outputs rounded selling prices for bottle and (when relevant) pour sizes by wine type.

There is **no wine catalogue / inventory product database** in this app. Each calculation is ephemeral: cost and options are entered on the home screen; only the user’s rule set is persisted.

---

## Users

**Expected users (inferred from UI copy and domain):** restaurant / bar / wine-list managers who price wine by bottle and by the glass.

**Typical workflow (from code):**

1. Land on `/welcome` → Login (`/login`) or Register (`/signup`).
2. After auth, land on `/` (calculator). If no rules exist in `gp_settings`, a modal forces navigation to `/gp-setup`.
3. On `/gp-setup`, create either a **Universal GP** rule or a **Custom Rule Set** (less-than / between / greater-than bands).
4. Return to `/`, enter cost (ex VAT), wine type, bottle size, bottle vs by-the-glass, review suggested prices.
5. Optionally edit rules via “Edit GP Rules”, or logout.

---

## Core Domain Concepts

| Term | Meaning in this app | Evidence |
|------|---------------------|----------|
| **GP / Gross Profit %** | Target margin percentage used to derive selling price. Stored and edited as a number typically 1–100. Displayed as `GP: {n}%`. | `src/app/page.tsx`, rule forms |
| **Gross Profit** | Not shown as a £ amount; only GP % is used. | UI shows % only |
| **Cost price** | Purchase cost **excluding VAT**. Label: “Cost Price (ex VAT)”. | `src/app/page.tsx` |
| **Selling price** | Customer-facing price in £, derived from cost + VAT treatment + GP. | `calculatePrice` on home page |
| **VAT / tax** | Fixed rate `VAT_RATE = 0.2` (20%). Applied by multiplying cost by `(1 + VAT_RATE)` inside the selling-price formula. | `src/app/page.tsx` |
| **Wine type** | `Dry`, `Sweet` (UI: “Sweet/Fortified”), or `Sparkling`. Controls which pour sizes are offered. | `WINE_SIZES` in `src/app/page.tsx` |
| **Bottle pricing** | Price for a full bottle (Half 375ml / Bottle 750ml / Magnum 1500ml / Other custom ml). Rounded to nearest £. | Home page |
| **Glass / pour pricing** | ml-based servings when “Selling By the Glass”. Rounded to nearest 50p. | Home page |
| **Pour sizes** | Dry: 125, 175, 250, 500 ml + Bottle. Sweet: 75 ml + Bottle. Sparkling: 150 ml + Bottle. | `WINE_SIZES` |
| **BTG (By The Glass)** | Toggle `isBTG`. When true, shows pour rows and applies a **5% reduction** to the bottle line (`basePrice * 0.95`). | Home page |
| **Pricing rules** | JSON rules mapping cost bands → GP %. Types: `all_gp`, `less_than`, `between`, `greater_than`. | `src/types/rules.ts` |
| **Universal GP** | Single `all_gp` rule: one GP for all costs. | Setup UI |
| **Custom rule set** | Contiguous cost bands: typically one `less_than`, zero+ `between`, one `greater_than`. Gaps/overlaps are validated. | `src/app/gp-setup/page.tsx` |

### Assumptions (not proven by code)

- Users are primarily **UK** venues (hardcoded 20% VAT and £ display). Currency and VAT rate are not configurable.
- “GP” here is the hospitality trade meaning: margin as a percentage of **selling price**, rearranged into the formula below — not markup-on-cost.
- The 5% bottle discount when BTG is a commercial convention (bottle cheaper than equivalent glass pours); rationale is not documented in-repo.

---

## Core Business Logic

All primary financial math currently lives in **`src/app/page.tsx`** (client component), not in a shared library. Rule validation / input helpers live in **`src/lib/gpRules.ts`**.

### 1. Suggested GP from rules — `calculateGP(cost, isBTG, rules)`

**Source:** `src/app/page.tsx` → `calculateGP`

| | |
|--|--|
| **Inputs** | `cost` (number, ex-VAT cost), `isBTG` (boolean — **accepted but unused**), `rules: Rule[]` |
| **Outputs** | Suggested GP % (number; may be fractional for `between` before rounding) |
| **VAT** | Not applied here; rules match on ex-VAT cost |
| **Rounding** | Caller rounds with `Math.round(suggested)` when applying to UI state |

**Formula / logic:**

1. If `rules` empty → return **70**.
2. If any rule has `type === 'all_gp'` → return that rule’s `gp` (first match via `.find`).
3. Else iterate rules in array order:
   - `less_than`: if `cost < rule.max` → return `rule.gp`
   - `greater_than`: if `cost > rule.min` → return `rule.gp`
   - `between`: if `cost >= rule.min && cost <= rule.max`:
     ```
     proportion = (cost - min) / (max - min)
     gp = start_gp - proportion * (start_gp - end_gp)
     ```
     (linear interpolation from `start_gp` at `min` to `end_gp` at `max`)
4. If no rule matches → return **70**.

**Constraint:** Rule order and boundary semantics matter. Equal boundaries between contiguous rules are expected by setup validation; matching uses `<` / `>` for ends and inclusive `>=`/`<=` for between.

---

### 2. Selling price from cost + GP — `calculatePrice(cost, gp)`

**Source:** `src/app/page.tsx` → `calculatePrice`

| | |
|--|--|
| **Inputs** | `cost` (ex VAT), `gp` (percent 1–100) |
| **Outputs** | Unrounded bottle-equivalent selling price (number) |
| **VAT** | Cost is inflated by 20% before margin maths |
| **Rounding** | None inside this function |

**Formula:**

```
VAT_RATE = 0.2
sellingPrice = (cost * (1 + VAT_RATE)) / (1 - gp / 100)
```

Equivalent hospitality form: treat VAT-inclusive cost as the cost base, then  
`price = vatInclusiveCost / (1 - GP%)`.

---

### 3. Pour / bottle line pricing (render path)

**Source:** `src/app/page.tsx` (table body)

**Inputs:** `costPrice`, `gp`, `isBTG`, `wineType` → `availableSizes`, `baseBottleMl`, selected size.

**Steps per displayed size:**

1. `basePrice = calculatePrice(costPrice, gp)`
2. If `isBTG && size === "Bottle"`: `basePrice *= 0.95`
3. `ml = size === "Bottle" ? baseBottleMl : parseInt(size)`
4. `price = (basePrice / baseBottleMl) * ml`
5. **Rounding / display:**
   - Bottle: `price = Math.round(price)` → `£{price}` (nearest pound, no decimals)
   - Pour: `price = Math.round(price * 2) / 2` → `£{price.toFixed(2)}` (nearest 50p)

**Bottle-only mode:** when `!isBTG`, only the `"Bottle"` size row is shown.

---

### 4. Bottle volume resolution

**Source:** `src/app/page.tsx`

| Selection | ml |
|-----------|-----|
| Half | 375 |
| Bottle | 750 |
| Magnum | 1500 |
| Other | `parseInt(customBottleSizeInput)` or fallback **750** |

---

### 5. Input sanitisation / validation helpers

**Source:** `src/lib/gpRules.ts`

| Function | Behaviour |
|----------|-----------|
| `sanitizeInput(value, isGpField)` | Digits + one `.`; GP → 1 decimal place; price → 2 decimal places |
| `validateInput(value, isGpField)` | Empty allowed; GP must be in **[1, 100]**; prices **≥ 0** |
| `safeParse(value, isGpField)` | `parseFloat` or `undefined` with same bounds |
| `validateNumberField` | `typeof number && !isNaN` |
| `validateRules(rules, setError)` | At least one rule; field completeness; contiguous ranges (no gaps). **Note:** `gp-setup/page.tsx` reimplements its own `validateRules` and does not import this export. |

---

### 6. Rule gap / overlap logic (setup)

**Source:** `src/app/gp-setup/page.tsx`

- `findOverlappingRules` — blocks save/edit if ranges intersect (touching edges OK: overlap if `aMax > bMin && aMin < bMax`).
- `analyzeGaps` / gap modal / `handleAddAllMissingRules` — detects missing between-bands and can insert `between` rules.
- `fillGaps` — auto-inserts between rules using less-than / greater-than GP endpoints (used in a secondary path during save).

Custom wizard at `/gp-setup/custom` has its own gap checks and upserts rules; **nothing in the UI currently links to this route** (orphan page).

---

## Main Features

| Feature | How it works | Primary files |
|---------|--------------|---------------|
| Welcome / gate | Unauthenticated entry with Login / Register | `src/app/welcome/page.tsx` |
| Email/password signup | Supabase `auth.signUp`; client-side password rules (8+, upper, lower, digit) | `src/app/signup/page.tsx` |
| Login | `auth.signInWithPassword`; on failure attempts `.from('users')` email lookup (see Known Issues) | `src/app/login/page.tsx` |
| Logout | `auth.signOut` → `/welcome` | Home page |
| Calculator | Cost, wine type, bottle size, BTG, GP nudge, price table | `src/app/page.tsx` |
| Force rule setup | Modal if no `gp_settings.rules` | Home page |
| GP rule editor | Universal or custom bands; overlap/gap UX; persist to Supabase | `src/app/gp-setup/page.tsx` + rule form components |
| Custom setup wizard | Multi-step less/greater/between | `src/app/gp-setup/custom/page.tsx` (unlinked) |
| Toasts | Success/error messages (login/signup) | `src/components/toast-provider.tsx` |

**Not present:** wine inventory, multi-venue accounts, VAT rate config, currency config, server API routes, automated tests, Next.js middleware auth guards.

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
├── package.json              # scripts: dev, build, start, lint
├── next.config.ts            # empty/default config
├── tsconfig.json             # @/* → ./src/*
├── components.json           # shadcn config
├── README.md                 # create-next-app boilerplate only
├── docs/                     # this documentation set
├── public/                   # default Next SVGs
└── src/
    ├── app/
    │   ├── layout.tsx        # root layout, fonts, ToastProvider
    │   ├── page.tsx          # MAIN CALCULATOR + pricing math
    │   ├── globals.css
    │   ├── welcome/page.tsx
    │   ├── login/page.tsx
    │   ├── signup/page.tsx
    │   └── gp-setup/
    │       ├── page.tsx      # primary rule editor
    │       └── custom/page.tsx  # alternate wizard (unlinked)
    ├── components/
    │   ├── toast-provider.tsx
    │   ├── rules/            # rule edit forms (+ emoji-prefixed duplicates)
    │   └── ui/               # button, card, input, toggle
    ├── lib/
    │   ├── gpRules.ts        # sanitize/validate helpers (+ unused shared validateRules)
    │   ├── supabaseClient.ts # Supabase client (hardcoded URL/anon key)
    │   └── utils.ts          # cn() classname helper
    └── types/
        └── rules.ts          # Rule union types
```

---

## Important Source Files

| File | Role |
|------|------|
| `src/app/page.tsx` | **Primary calculations**, calculator UI, session gate, load rules |
| `src/lib/gpRules.ts` | Input sanitize/validate; shared `validateRules` (partially unused by setup page) |
| `src/types/rules.ts` | Domain rule TypeScript types |
| `src/app/gp-setup/page.tsx` | Rule CRUD UX, gap/overlap, save to `gp_settings` |
| `src/app/gp-setup/custom/page.tsx` | Alternate custom wizard + upsert |
| `src/lib/supabaseClient.ts` | Single Supabase browser client |
| `src/app/login/page.tsx` / `signup/page.tsx` | Auth flows |
| `src/components/rules/*.tsx` | Editable rule field UIs (canonical names without emoji) |
| `src/components/toast-provider.tsx` | Toast context |
| `src/components/ui/*` | Shared UI primitives |
| `src/app/layout.tsx` | App shell + metadata |

There is **no** ORM/schema file in-repo. Live schema is in Supabase project `wine-gp-calculator` (see `DATA_MODEL.md`).

---

## Data Flow

1. **Auth:** User signs up/logs in via Supabase Auth → session stored by supabase-js in the browser.
2. **Session check:** Protected pages call `supabase.auth.getSession()`; missing session → redirect `/welcome`.
3. **Load rules:** `gp_settings` selected where `user_id = session.user.id`.
4. **Calculate:** User edits cost/options → `useEffect` debounces (~200ms) → `calculateGP` → sets `suggestedGp`/`gp` → table recomputes `calculatePrice` + pour scaling + rounding.
5. **Persist rules:** Setup page insert/update (or custom page upsert) `gp_settings.rules` JSONB.
6. **UI feedback:** Toasts on auth; inline errors on setup; success redirect to `/`.

Calculation results are **not** written to the database.

---

## Important Constraints

1. **Financial formula must stay consistent** across any refactor:  
   `(cost * 1.2) / (1 - gp/100)` plus BTG bottle `* 0.95`, pour proportional to ml, bottle round-£ / glass round-50p.
2. **VAT rate is hardcoded** at 0.2 — changing it without product agreement changes all prices.
3. **Rules JSON shape** must remain compatible with `Rule` union and both setup + calculator matchers.
4. **One `gp_settings` row per user** (`user_id` UNIQUE); save paths assume that.
5. **RLS** on `gp_settings` requires `auth.uid() = user_id` — client must be authenticated for read/write.
6. **Client-only Supabase key** is the publishable/anon key pattern; never add service-role keys to frontend.
7. Duplicating `Rule` interfaces in `page.tsx` / custom page instead of importing `@/types/rules` risks type drift.
8. `calculateGP` ignores `isBTG` today; do not assume BTG changes suggested GP unless product adds that behaviour.

---

## Known Issues / Technical Debt

Supported by the repository / live DB (not invented):

1. **Hardcoded Supabase URL and anon key** in `src/lib/supabaseClient.ts` instead of env vars (security/ops smell; anon key is public-by-design but rotation/config is inflexible).
2. **Login “email not found” path queries `.from('users')`**, but **no `public.users` table exists** (only `auth.users`). That lookup cannot succeed as written; error messaging may be wrong.
3. **`isBTG` unused inside `calculateGP`** despite being a parameter and a `useEffect` dependency.
4. **Duplicated rule types** in `src/app/page.tsx` and `src/app/gp-setup/custom/page.tsx` vs `src/types/rules.ts`.
5. **Duplicated `validateRules`**: exported from `gpRules.ts` but GP setup defines a local version; shared export can drift.
6. **Orphan route** `/gp-setup/custom` — no in-app navigation links found.
7. **Emoji-prefixed duplicate components** under `src/components/rules/` (`📄 *.tsx`) — older/simpler variants; imports use the non-emoji filenames. Dead weight / confusion risk.
8. **`safeParse` arity mismatch risk** in emoji duplicates (call without `isGpField`).
9. **No automated tests** for pricing or rule validation despite financial sensitivity.
10. **No Next middleware** — protection is per-page `getSession` only; brief flash / empty render possible.
11. **README** is still create-next-app boilerplate; not product documentation.
12. Live DB showed **0 rows** in `gp_settings` at review time — either unused production data or wiped; does not by itself indicate code bugs.

---

## Current Development State

| Area | State |
|------|--------|
| Auth (signup/login/logout) | Implemented and used |
| Calculator + rounding | Implemented (commits specifically mention 50p / £ rounding) |
| GP rule editor with gap/overlap UX | Implemented on `/gp-setup` |
| Custom multi-step wizard | Code exists; appears unfinished relative to main editor (unlinked) |
| Env-based configuration | Not implemented |
| Tests / CI config in repo | Not present |
| API layer | Not present (by design currently) |
| Multi-tenant / org features | Not present |

Commit history language (“Final Update”, etc.) suggests the author considered the calculator + rules path largely complete as a prototype/MVP.

---

## Guidance for Future AI Developers

1. **Do not change pricing formulas casually.** Any change to `calculatePrice`, BTG bottle discount, pour scaling, or rounding is a product/finance change — add tests if you touch it.
2. Prefer putting shared calculation and rule-matching in **`src/lib/`** (e.g. extract from `page.tsx`) and keep UI thin — but match existing patterns unless asked to refactor.
3. Use **`src/types/rules.ts`** as the single source of truth for rule shapes; avoid new inline copies.
4. Prefer **`src/lib/gpRules.ts`** for validation helpers; wire GP setup to the shared `validateRules` instead of forking logic.
5. Ignore or delete emoji-prefixed `📄` rule files only when explicitly asked; do not import them.
6. Do not introduce a `service_role` key in client code.
7. After calculation or rule changes, manually verify: universal GP, less/between/greater bands, BTG vs bottle, Dry/Sweet/Sparkling pour lists, Half/Magnum/Other ml.
8. Run `npm run lint` and `npm run build` after substantive edits (only scripts that exist).
9. Schema changes belong in Supabase (migrations/dashboard), not only TypeScript — keep `DATA_MODEL.md` updated.
10. Never commit real secrets; if moving credentials to env, use placeholders in docs and `.env.example` only.
