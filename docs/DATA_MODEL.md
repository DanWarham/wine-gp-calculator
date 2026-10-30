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
| `20261019134900_baseline_current_schema.sql` | Baseline of pre-existing `gp_settings` (Stage 3A) |
| `20261019223922_create_pricing_policy.sql` | Additive `pricing_policy` (Stage 3B) |
| `20261022104800_create_serving_sizes.sql` | Additive `serving_sizes` (Stage 3C) |
| `20261026194756_harden_database_access.sql` | FK + grant tightening (Stage 4B2) |
| `20261027092540_create_pricing_configurations.sql` | Pricing Configurations, snapshots, current-events, RPCs, backfill (Stage 5) |
| `20261027093617_revoke_anon_snapshot_hash_execute.sql` | Revoke anon EXECUTE on snapshot hash helper |
| `20261027101302_drop_legacy_gp_settings_pricing_policy.sql` | Drop superseded `gp_settings` + `pricing_policy` |
| `20261029144815_create_pricing_data_import.sql` | Pricing data import tables + commit/previous RPCs (Stage 6A) |
| `20261029161358_create_pricing_reviews.sql` | Cost Change Review tables + commit/complete RPCs (Stage 6B) |
| `20261029223152_extend_pricing_reviews_full_and_actions.sql` | Full Pricing Review type + commit RPC (Stage 6C) |
| `20261030121726_pricing_import_data_month_delete_and_issue_names.sql` | Import `data_month`, safe delete RPC, issue names, review item append |

**Documentation authority:** Repository/database evidence determines current schema. Canonical intended architecture: [`05-project-architecture.md`](./05-project-architecture.md). Canonical current overview: [`06-current-implementation.md`](./06-current-implementation.md).

Runtime application tables: `public.pricing_configurations`, `public.pricing_configuration_snapshots`, `public.pricing_current_events`, `public.serving_sizes`, `public.pricing_items`, `public.pricing_data_imports`, `public.pricing_observations`, `public.pricing_import_issues`, `public.pricing_reviews`, `public.pricing_review_items` (plus `auth.users`). Legacy `gp_settings` / `pricing_policy` have been **dropped**. Sales/scenario entities from `05` remain **not** implemented.

---

## Entity Relationship Overview

```mermaid
erDiagram
  auth_users ||--o{ pricing_configurations : "owns"
  auth_users ||--o{ pricing_configuration_snapshots : "owns"
  auth_users ||--o{ pricing_current_events : "owns"
  auth_users ||--o{ serving_sizes : "owns"
  auth_users ||--o{ pricing_items : "owns"
  auth_users ||--o{ pricing_data_imports : "owns"
  pricing_data_imports ||--o{ pricing_observations : "contains"
  pricing_data_imports ||--o{ pricing_import_issues : "contains"
  pricing_items ||--o{ pricing_observations : "observed as"
  pricing_configurations ||--o{ pricing_configuration_snapshots : "source"
  pricing_configurations ||--o{ pricing_current_events : "previous/new"
  pricing_configuration_snapshots ||--o{ pricing_current_events : "previous/new snap"
  auth_users ||--o{ pricing_reviews : "owns"
  pricing_reviews ||--o{ pricing_review_items : "contains"
  pricing_data_imports ||--o{ pricing_reviews : "current/previous"
  pricing_configuration_snapshots ||--o{ pricing_reviews : "captured config"
  pricing_items ||--o{ pricing_review_items : "reviewed as"

  pricing_configurations {
    uuid id PK
    uuid user_id FK
    text name
    boolean is_current
    text status
    jsonb rules
    numeric vat_rate
    numeric btg_bottle_discount
    numeric bottle_rounding_increment
    numeric pour_rounding_increment
  }
  serving_sizes {
    uuid id PK
    uuid user_id FK
    text category
    text label
    int volume_ml
    boolean enabled
    int display_order
  }
```

Serving Sizes are **not** part of a Pricing Configuration and are **not** snapshotted.

---

## Table grants (Stage 5)

| Table | anon | authenticated |
|-------|------|---------------|
| `pricing_configurations` | none | SELECT; column INSERT (name/rules/policy); column UPDATE (name/status/rules/policy/updated_at) — **not** `user_id` / `is_current`; no DELETE |
| `pricing_configuration_snapshots` | none | SELECT only |
| `pricing_current_events` | none | SELECT only |
| `serving_sizes` | none | SELECT, INSERT, UPDATE, DELETE |
| `pricing_items` | none | SELECT only |
| `pricing_data_imports` | none | SELECT only |
| `pricing_observations` | none | SELECT only |
| `pricing_import_issues` | none | SELECT only |
| `pricing_reviews` | none | SELECT; column UPDATE (`tolerance_gp_points`, `updated_at`) on draft only |
| `pricing_review_items` | none | SELECT; column UPDATE (decision fields / `system_status` / `updated_at`) on draft parent only |
Controlled RPCs (EXECUTE for `authenticated` only; not anon):

- `ensure_current_pricing_configuration()`
- `capture_pricing_configuration_snapshot(uuid)`
- `make_pricing_configuration_current(uuid)`
- `pricing_configuration_snapshot_content_hash(...)` (dedup helper)
- `commit_pricing_data_import(jsonb)` (Stage 6A atomic import write)
- `get_previous_completed_pricing_data_import(uuid)` (Stage 6B foundation)
- `commit_cost_change_review(jsonb)` (Stage 6B draft create)
- `commit_full_pricing_review(jsonb)` (Stage 6C Full Pricing Review draft create)
- `append_pricing_review_items(uuid, jsonb)` (batched review item insert)
- `complete_pricing_review(uuid)` (Stage 6B/6C completion)
- `delete_pricing_data_import(uuid)` (safe import deletion)

---

## `public.pricing_configurations`

Editable working Pricing Configuration: **GP Rules + Pricing Policy**.

| Constraint / index | Meaning |
|--------------------|---------|
| FK `user_id` → `auth.users` ON DELETE CASCADE | User-owned |
| Partial UNIQUE `(user_id) WHERE is_current` | At most one Current |
| UNIQUE `(user_id, lower(trim(name)))` | Case/whitespace-insensitive names across active+archived |
| CHECK status ∈ {active, archived} | |
| CHECK `NOT is_current OR status = 'active'` | Current must be active |
| Policy CHECKs | Same invariants as legacy pricing_policy |

Defaults: `user_id = auth.uid()`, `is_current = false`, `status = 'active'`, blank policy defaults (20% / 5% / £1 / £0.50), `rules = []`.

**Migration:** existing users’ `gp_settings` + `pricing_policy` copied exactly into **Main Pricing** (`is_current = true`). No initial snapshot or promotion event.

**First-use:** `ensure_current_pricing_configuration` creates Main Pricing Current with empty rules + default policy; app seeds Serving Sizes only when `created = true`.

---

## `public.pricing_configuration_snapshots`

Immutable captured configuration state for reproducibility (Make Current today; Pricing Review / Scenario later).

Contains: source configuration id + **captured name** + rules + policy fields + `content_hash` + timestamps. No Serving Sizes.

Dedup: UNIQUE `(source_configuration_id, content_hash)`. Hash is a deterministic fingerprint (SHA-256 of canonical jsonb), not authentication.

Source FK uses `ON DELETE RESTRICT` so physical deletion of a configuration cannot silently destroy historical snapshots. Configurations are archived, not normally deleted.

---

## `public.pricing_current_events`

Immutable Make Current history:

`previous_configuration_id`, `previous_snapshot_id`, `new_configuration_id`, `new_snapshot_id`, `changed_at`.

Records the factual event “this configuration became Current at this time”. **Not** a general effective-dating system.

---

## `public.serving_sizes`

Unchanged from Stage 3C/4. Runtime pour/carafe catalogue per fixed category. Seeded on genuine first Pricing Configuration provisioning only — intentionally empty lists are never reseeded.

---

## Pricing data import (Stage 6A)

Immutable Lime Wood FnbShop + Micros pricing snapshots. Raw commercial uploads are parsed on the Next.js server boundary and discarded after canonical persistence.

### `public.pricing_items`

Persistent external identity for the current source integration: `(user_id, external_plu)` unique. PLU is not a universal application-wide identity beyond this importer.

### `public.pricing_data_imports`

One completed import event per upload. Stores source filenames/metadata and summary counts. Only `status = completed` rows are persisted (structural failures are not stored).

### `public.pricing_observations`

One item’s observed state within one import. Cost authority is FnbShop (`cost_ex_vat`); selling-price authority is Micros (`selling_price_inc_vat`). `included_for_pricing` is false for item exceptions.

### `public.pricing_import_issues`

Persisted item-exception and informational issues for an import (`severity` ∈ `item_exception` | `informational`).

Writes are via SECURITY DEFINER `commit_pricing_data_import(jsonb)` only. Clients have SELECT; no anon access.

---

## Pricing reviews (Stage 6B / 6C)

Cost Change Reviews compare two completed pricing imports. Full Pricing Reviews examine every eligible full bottle in the latest completed import. Both capture a Current Pricing Configuration snapshot and store `tolerance_gp_points` for reproducibility.

### `public.pricing_reviews`

One review event: `review_type` ∈ `cost_change` | `full`, `current_import_id`, optional `previous_import_id` (required for `cost_change`, null for `full`), snapshot FK, stored `tolerance_gp_points`, `status` ∈ `draft` | `completed`, and `presence_summary` JSONB (used by cost-change for new/missing items). At most one draft Cost Change per user+import pair; at most one draft Full Review per user+current import.

### `public.pricing_review_items`

Per reviewed full-bottle row: previous/current cost (Full Review stores current cost in both for NOT NULL columns), current Micros selling price, old/current/target GP, recommended price, system status, optional decision / proposed price / resulting GP, and previous unresolved-action flags. Historical values remain fixed after creation. Completed reviews can generate a printable Action Document in the app (`/pricing-reviews/[id]/actions`) — no separate action-task tables.

Writes: draft create via `commit_cost_change_review(jsonb)` or `commit_full_pricing_review(jsonb)`; completion via `complete_pricing_review(uuid)`; draft decision/tolerance updates via authenticated column UPDATE + RLS.

---

## JSONB: `rules`

Same canonical Rule model (`src/types/rules.ts`): `all_gp`, `less_than`, `between`, `greater_than`. Authoritative calculation validity: `validateRuleSetForPricing`. Blank `[]` is allowed for blank alternatives / new-user Main Pricing, but cannot be made Current or captured until non-empty and valid.

---

## TypeScript domain types

| Type | Location |
|------|----------|
| `Rule` variants | `src/types/rules.ts` |
| `PricingPolicy` | `src/lib/pricing/types.ts` |
| `PricingConfiguration` | `src/types/pricingConfigurations.ts` |
| `ServingSize` | `src/types/servingSizes.ts` |
| Pricing Review (Cost Change + Full) | `src/types/pricingReviews.ts` |
