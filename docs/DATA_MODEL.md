# Data Model — Wine GP Calculator

Documents persistent storage (Supabase) and important in-memory / TypeScript domain structures.

**Schema sources:**

| Authority | Role |
|-----------|------|
| `supabase/migrations/` | Source-controlled history of intended/applied **application** schema evolution |
| Live Supabase project `jcylgbtifwpcjncnnfok` (` wine-gp-calculator`) | Actual deployed database state |
| This file / [`06-current-implementation.md`](./06-current-implementation.md) | Human-readable documentation |

If migrations and live state disagree, **investigate the drift** — do not silently declare either correct without verification.

**Migrations:**

| File | Role |
|------|------|
| `20261019134900_baseline_current_schema.sql` | Baseline of pre-existing `gp_settings` (Stage 3A; did not alter live schema) |
| `20261019223922_create_pricing_policy.sql` | Additive `pricing_policy` table + RLS + seed (Stage 3B) |

**Documentation authority:** Repository/database evidence determines current schema. Canonical intended architecture: [`05-project-architecture.md`](./05-project-architecture.md). Canonical current overview: [`06-current-implementation.md`](./06-current-implementation.md). This file provides supporting schema/type detail. If sources materially disagree, investigate rather than silently reconciling them.

Application tables today: `public.gp_settings`, `public.pricing_policy` (plus Supabase-managed `auth.users`). Sales, scenario, serving-size persistence, and versioning entities from `05` are **not** implemented.

---

## Entity Relationship Overview

```mermaid
erDiagram
  auth_users ||--o| gp_settings : "owns"
  auth_users ||--o| pricing_policy : "owns"
  gp_settings {
    uuid id PK
    uuid user_id UK "not null"
    jsonb rules "nullable"
    timestamp created_at
  }
  pricing_policy {
    uuid id PK
    uuid user_id UK "FK auth.users"
    numeric vat_rate
    numeric btg_bottle_discount
    numeric bottle_rounding_increment
    numeric pour_rounding_increment
    timestamptz created_at
    timestamptz updated_at
  }
  auth_users {
    uuid id PK
    text email
  }
```

Logical relationship: `gp_settings.user_id` corresponds to `auth.users.id`.  
**Fact:** **No foreign-key constraint** from `gp_settings.user_id` to `auth.users` (legacy; unchanged in Stage 3B). Enforcement is application + RLS.

`pricing_policy.user_id` **does** have `REFERENCES auth.users(id) ON DELETE CASCADE` plus `UNIQUE(user_id)`.

---

## Persistent Tables

### `public.gp_settings`

| | |
|--|--|
| **Purpose** | Store each user’s GP pricing rule set |
| **Table comment (DB)** | “User defines their GP Settings” |
| **RLS** | Enabled |
| **Source in app** | Queried/written from `src/app/page.tsx`, `src/app/gp-setup/page.tsx`, `src/app/gp-setup/custom/page.tsx` |

#### Columns

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `user_id` | `uuid` | NO | — | **UNIQUE** (one row per user) |
| `rules` | `jsonb` | YES | — | Array of rule objects (see below) |
| `created_at` | `timestamp` (without time zone) | NO | `now()` | Set on insert; app does not update this field in code |

#### Constraints & indexes

| Name | Definition |
|------|------------|
| `gp_settings_pkey` | PRIMARY KEY (`id`) — unique btree index |
| `gp_settings_user_id_key` | UNIQUE (`user_id`) — unique btree index |

#### RLS policy

| Policy name | Command | USING / WITH CHECK |
|-------------|---------|---------------------|
| `Policy with security definer functions` | ALL | `auth.uid() = user_id` |

Authenticated users can only CRUD their own row. Anon users cannot access rows under this policy.

#### Write patterns in code

| Path | Method |
|------|--------|
| First-time save (`gp-setup`) | `select` by `user_id` → if missing, `insert([{ user_id, rules }])` else `update({ rules })` |
| Custom wizard | `upsert({ user_id, rules }, { onConflict: 'user_id' })` |

---

### `public.pricing_policy`

| | |
|--|--|
| **Purpose** | Store each user’s current commercial pricing policy (VAT, BTG bottle discount, rounding) |
| **Table comment (DB)** | “Current commercial pricing policy per user (VAT, BTG bottle discount, rounding).” |
| **RLS** | Enabled |
| **Source in app** | `src/lib/pricingPolicyStore.ts`; Settings `/settings`; Calculator loads via `getOrCreatePricingPolicy` |

#### Columns

| Column | Type | Nullable | Default | Semantics |
|--------|------|----------|---------|-----------|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `user_id` | `uuid` | NO | — | **UNIQUE**; FK → `auth.users(id)` ON DELETE CASCADE |
| `vat_rate` | `numeric` | NO | `0.20` | Decimal fraction (`0.20` = 20% VAT) |
| `btg_bottle_discount` | `numeric` | NO | `0.05` | Decimal fraction (`0.05` = 5%); bottle line only when BTG |
| `bottle_rounding_increment` | `numeric` | NO | `1.00` | £ increment for bottle prices |
| `pour_rounding_increment` | `numeric` | NO | `0.50` | £ increment for pour/glass prices |
| `created_at` | `timestamptz` | NO | `now()` | |
| `updated_at` | `timestamptz` | NO | `now()` | Set explicitly by app on save |

#### Constraints

| Name | Definition |
|------|------------|
| `pricing_policy_pkey` | PRIMARY KEY (`id`) |
| `pricing_policy_user_id_key` | UNIQUE (`user_id`) |
| `pricing_policy_user_id_fkey` | FK → `auth.users(id)` ON DELETE CASCADE |
| `pricing_policy_vat_rate_check` | `vat_rate >= 0` |
| `pricing_policy_btg_bottle_discount_check` | `btg_bottle_discount >= 0 AND btg_bottle_discount < 1` |
| `pricing_policy_bottle_rounding_increment_check` | `bottle_rounding_increment > 0` |
| `pricing_policy_pour_rounding_increment_check` | `pour_rounding_increment > 0` |

#### RLS policies

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `pricing_policy_select_own` | SELECT | authenticated | `auth.uid() = user_id` |
| `pricing_policy_insert_own` | INSERT | authenticated | `auth.uid() = user_id` |
| `pricing_policy_update_own` | UPDATE | authenticated | `auth.uid() = user_id` |

No DELETE policy (app does not delete policies). Anon has no permissive policy; RLS prevents anonymous row access.

#### Provisioning

- **Existing users:** seeded in migration `20261019223922` via `INSERT … SELECT id FROM auth.users ON CONFLICT DO NOTHING` (column defaults = Stage 2 commercial defaults).
- **New users:** `getOrCreatePricingPolicy(userId)` selects; if missing, inserts `{ user_id }` only (DB defaults); concurrent unique violation → re-select. Load/provision errors are returned — calculator does **not** silently use in-memory defaults.

UI percentages (`20`) convert to rates (`0.20`) in `src/lib/pricingPolicyStore.ts` (`percentToRate` / `rateToPercent`).

---

### `auth.users` (Supabase-managed)

Used indirectly via Auth APIs (`signUp`, `signInWithPassword`, `getSession`).  
The app reads `session.user.id` (and signup/login email). It does **not** define this table.

**Important mismatch:** `src/app/login/page.tsx` queries `supabase.from('users')`, which targets **`public.users`**. That table **does not exist** in the live database (only `auth.users`). Documented as a known defect in `AI_CONTEXT.md`.

---

## JSONB: `gp_settings.rules`

Stored as a JSON array. TypeScript source of truth: `src/types/rules.ts`.

### Discriminated union

```ts
type Rule = LessThanRule | GreaterThanRule | BetweenRule | AllGpRule
```

| `type` | Fields | Meaning |
|--------|--------|---------|
| `all_gp` | `gp: number` | Single GP for all costs |
| `less_than` | `max: number`, `gp: number` | If cost **&lt;** max → GP |
| `greater_than` | `min: number`, `gp: number` | If cost **&gt;** min → GP |
| `between` | `min`, `max`, `start_gp`, `end_gp` | Inclusive cost band; GP linearly interpolates from `start_gp` → `end_gp` |

There is **no DB-level JSON schema validation** observed; invalid shapes would be a client-side concern.

### Example documents

**Universal:**

```json
[{ "type": "all_gp", "gp": 70 }]
```

**Custom bands (illustrative):**

```json
[
  { "type": "less_than", "max": 10, "gp": 75 },
  { "type": "between", "min": 10, "max": 25, "start_gp": 75, "end_gp": 65 },
  { "type": "greater_than", "min": 25, "gp": 65 }
]
```

### Intended contiguity

Setup UX expects custom rules to form a continuous cost axis: `less_than.max` equals the next rule’s `min`, and so on through `greater_than.min`. Overlaps and gaps are checked in `src/app/gp-setup/page.tsx`.

---

## Important Transient / UI State (not persisted)

### Calculator (`src/app/page.tsx`)

| State | Type | Role |
|-------|------|------|
| `costPriceInput` | `string` | Raw cost field |
| `wineType` | `"Dry" \| "Sweet" \| "Sparkling"` | Pour size catalogue key |
| `isBTG` | `boolean` | By-the-glass mode |
| `gp` / `suggestedGp` | `number` | Active / rule-suggested GP % |
| `rules` | `Rule[]` | Loaded from DB |
| `bottleSize` | string enum-like | Half / Bottle / Magnum / Other |
| `customBottleSizeInput` | `string` | Custom ml when Other |
| `showSetupModal` | `boolean` | Force rule creation |

Constants (not state): `VAT_RATE = 0.2`, `WINE_SIZES` map.

### GP setup (`src/app/gp-setup/page.tsx`)

| State | Role |
|-------|------|
| `rules` | Working copy of rule array |
| `editingIndex` / `tempRule` | Inline edit buffer |
| `gaps` / `gapModalOpen` | Missing-band UX |
| `formHasError` | Disables Save while form invalid |

### Auth forms

Email/password strings and local validation error strings only; accounts live in Supabase Auth.

---

## TypeScript Domain Types

**Canonical file:** `src/types/rules.ts`

```ts
export interface BaseRule {
  type: 'less_than' | 'between' | 'greater_than' | 'all_gp'
}
// LessThanRule, GreaterThanRule, BetweenRule, AllGpRule, Rule
```

**Duplicated (drift risk):**

- Inline copies in `src/app/page.tsx`
- Inline copies in `src/app/gp-setup/custom/page.tsx` (subset: no `AllGpRule`)

Prefer importing from `@/types/rules` for new work.

---

## Relationships Summary

| From | To | Cardinality | Mechanism |
|------|----|-------------|-----------|
| Auth user | `gp_settings` | 0..1 | `user_id` unique + app logic (no FK) |
| Auth user | `pricing_policy` | 0..1 | `user_id` unique + FK CASCADE + app provisioning |
| `gp_settings.rules` | Rule objects | 0..n in JSON array | Application convention |

Serving sizes remain hardcoded in the calculator UI until Stage 3C. No sales/scenario entities yet.
