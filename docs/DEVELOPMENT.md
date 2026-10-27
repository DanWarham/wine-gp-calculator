# Development Guide — Wine GP Calculator

Practical setup and workflow notes derived from the repository as it exists today.

**Documentation authority:** Repository evidence determines current tooling. Canonical intended architecture: [`05-project-architecture.md`](./05-project-architecture.md). Canonical current overview: [`06-current-implementation.md`](./06-current-implementation.md). This file provides supporting setup/workflow detail. If sources materially disagree, investigate rather than silently reconciling them.

---

## Local Setup

### Prerequisites

- **Node.js 22 LTS** (required). `package.json` `engines.node` is `>=22`; `.nvmrc` pins `22`. `@supabase/supabase-js` `2.118+` does not support Node 20. Use fnm/nvm (or equivalent) so `node --version` reports 22.x before install/dev.
- **npm** (lockfile is `package-lock.json`; yarn/pnpm/bun mentioned only in stock README).
- Access to the project’s **Supabase** instance (browser-safe URL + anon/publishable key).

### Steps

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env.local` and fill in the project’s browser-safe values:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000).

Missing either env var causes a clear configuration error (no hardcoded fallback).

**Assumption:** Local development uses the shared remote Supabase project (project ref `jcylgbtifwpcjncnnfok`). A `supabase/` directory with config and migrations exists for schema governance. A full local Supabase Docker stack is **not** required for day-to-day app work.

**Accounts:** Public self-registration is disabled. New users are created by an administrator through Supabase’s supported Auth admin/manual mechanisms.

---

## Commands

Only scripts defined in `package.json`:

| Command | Script | Purpose |
|---------|--------|---------|
| Install | `npm install` | Install dependencies from lockfile |
| Dev server | `npm run dev` | `next dev` |
| Production build | `npm run build` | `next build` |
| Start production | `npm run start` | `next start` (after build) |
| Lint | `npm run lint` | `eslint .` (ESLint CLI; `next lint` deprecated from Next 15.5) |
| Test | `npm test` | `vitest run` (pricing domain financial suite) |
| Test watch | `npm run test:watch` | `vitest` |

**Not present in `package.json`:** typecheck script, DB migrate, seed, format, storybook, etc.

---

## Environment Variables

### Browser-safe (required)

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Read by `src/lib/supabaseEnv.ts` / `src/lib/supabaseClient.ts`. Placeholders live in committed `.env.example`. Real values belong in ignored `.env.local` (and host env for deploys).

### Server-only (if introduced later — never `NEXT_PUBLIC_*`)

```text
SUPABASE_SERVICE_ROLE_KEY
database URLs / passwords
management API tokens
other privileged credentials
```

Never commit service-role keys or other privileged credentials. Never paste real credentials into documentation.

---

## Database Workflow

### Schema authority

| Layer | Role |
|-------|------|
| `supabase/migrations/` | Source-controlled history of intended/applied application schema evolution |
| Live Supabase | Actual deployed database state |
| [`DATA_MODEL.md`](./DATA_MODEL.md) / [`06-current-implementation.md`](./06-current-implementation.md) | Human-readable documentation |

If migrations and live state disagree, investigate the drift before changing either.

### Current baseline (Stage 3A)

| Item | Status |
|------|--------|
| Migration directory | `supabase/migrations/` |
| Baseline file | `20261019134900_baseline_current_schema.sql` |
| What it represents | Existing `public.gp_settings` (columns, constraints, RLS, grants, comment) |
| Live schema change in 3A | **None** — baseline describes reality; it must not be re-executed against the existing live DB |
| Remote history | Baseline `20261019134900` marked applied via `migration repair`; Stage 3B `20261019223922_create_pricing_policy` applied with `db push`. |

Application schema expectations (current, Stage 5):

- Runtime: `pricing_configurations`, `pricing_configuration_snapshots`, `pricing_current_events`, `serving_sizes`
- Legacy reference (unused by app): `gp_settings`, `pricing_policy`
- RLS: `auth.uid() = user_id`; clients cannot set `user_id` / `is_current` on configurations
- Controlled RPCs for ensure-Current, snapshot capture, Make Current
- Supabase Auth enabled for email/password; public signup disabled (Stage 4B1)
- Stage 4B2 tightened grants and `postgres` default privileges (see below)

### Future migration process

1. Understand the required schema change.
2. Create a new source-controlled migration (`npx supabase migration new <name>`).
3. Review: schema impact, data impact, RLS/security, grants, compatibility with application code.
4. Apply the migration to the appropriate linked Supabase environment (`npx supabase db push` or equivalent CI).
5. Verify: migration recorded as applied; expected schema/RLS/grants present; application behaviour remains valid.
6. Commit the migration with the related implementation.

Principles:

- Migrations are authoritative for application schema evolution.
- Dashboard-only schema edits should not be normal development practice.
- Emergency/manual remote changes must subsequently be reconciled with migrations (`db pull` / repair as appropriate).
- Every new user-owned table requires **RLS + explicit SQL grants** (do not rely on default privileges).
- Application code and migrations that depend on one another should be reviewed/deployed coherently.

### Grants convention (Stage 4B2+)

After Stage 4B2, creating a new `public` table as role `postgres` no longer automatically grants broad table rights to `anon` / `authenticated`. Future migrations must explicitly:

```sql
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
CREATE POLICY ...;
REVOKE ALL ON TABLE ... FROM anon;
GRANT SELECT, INSERT, UPDATE [, DELETE] ON TABLE ... TO authenticated;
```

Use only the operations the application actually needs. RLS remains mandatory and is still the row-security authority.

### CLI notes

```bash
# Create an empty migration file
npx supabase migration new <descriptive_name>

# Mark an already-present remote schema migration as applied (history only — no DDL)
npx supabase migration repair --status applied <timestamp> --project-ref jcylgbtifwpcjncnnfok

# Apply *new* migrations that are not yet on the remote (never use this to re-run the Stage 3A baseline against live)
npx supabase db push

# Compare local vs remote migration status
npx supabase migration list
```

Requires Supabase CLI auth (`npx supabase login` or `SUPABASE_ACCESS_TOKEN`). Linking may also require the database password.

### Stage 3B / 3C provisioning notes

Pricing Configurations are owned per user. New authenticated users are provisioned by `getOrCreateCurrentPricingConfiguration` → RPC `ensure_current_pricing_configuration` (Main Pricing Current, empty rules, default policy). First-use also seeds Serving Sizes. Existing users were migrated from `gp_settings` + `pricing_policy` into **Main Pricing** in Stage 5 (exact parity; no initial snapshot/event).

`serving_sizes` rows are seeded for existing users in Stage 3C migration `20261022104800`. For **future** users, default serving sizes are inserted only when Pricing Policy is first created (same helper). An intentionally empty serving-size configuration is never silently reseeded just because the table is empty.

After schema changes, update [`DATA_MODEL.md`](./DATA_MODEL.md) / [`06-current-implementation.md`](./06-current-implementation.md) and verify client queries still match.

To inspect live schema (operators with project access): Supabase dashboard SQL editor, MCP, or `supabase` CLI against the project.

---

## Deployment

**From repository evidence:**

1. Build with `npm run build`.
2. Run with `npm run start`, **or** deploy as a standard Next.js app on a platform such as Vercel (README boilerplate points here).
3. Ensure the host provides `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Not in repo:** `vercel.json`, Docker, CI workflows.

**Assumption:** Production hosting is Vercel or equivalent Node host. Confirm with the owner.

---

## Dependencies / security hygiene

| Item | Current practice |
|------|------------------|
| Node runtime | **22 LTS** required (`engines.node` `>=22`, `.nvmrc`); do not develop on Node 20 |
| Direct runtime client | `@supabase/supabase-js` stable v2 (`2.118.0` as of Stage 4B3) |
| Framework | Next.js **`15.5.28`** — do not jump to Next 16 solely for audit silence |
| Prohibited | `npm audit fix --force`; unsupported child-package overrides; canary supabase builds |
| Residual audit | Development/toolchain and Next-pinned `postcss` findings may remain; see [`06-current-implementation.md`](./06-current-implementation.md) residual register |

Schema/auth/RLS are unchanged by Stage 4B3 (dependency-only).

---

## Testing

| Area | Status |
|------|--------|
| Pricing domain unit tests | **Vitest** — `src/lib/pricing/pricing.test.ts` |
| Test scripts | `npm test`, `npm run test:watch` |
| E2E / UI tests | Not present |
| Manual QA focus | Calculator UX, auth redirects, empty-rules modal, BTG display, custom bottle error path |

Any change to `src/lib/pricing` must update/extend the Vitest suite and pass `npm test`.

Suggested manual smoke checklist after calculator/UI changes:

1. Universal GP → known cost → expected bottle price.
2. Between-rule interpolation retains fractional GP in pricing.
3. BTG: pours visible; bottle discounted; pours use undiscounted basis.
4. Bottle rounds to whole £; pours to `x.00` or `x.50`.
5. Dry/Sweet/Sparkling size lists (Sparkling 125 + 150).
6. Half / Magnum / valid custom ml; invalid custom ml shows error (no silent 750).
7. Uncovered rule cost shows explicit error (no 70% fallback).

---

## Coding Conventions (observed)

Patterns already present — prefer consistency over inventing a new style guide.

| Topic | Convention in repo |
|-------|--------------------|
| Language | TypeScript, `strict: true` |
| Components | Function components; interactive pages marked `'use client'` |
| Exports | Default export for pages and rule forms; named exports for UI primitives / helpers |
| Paths | `@/` imports for app code |
| UI | shadcn-style `Button` / `Card` / `Input`; Tailwind utility classes; occasional raw `<select>` |
| Forms | Local `useState`; controlled inputs; sanitize via `gpRules` helpers on calculator/rule forms |
| Feedback | Toasts for auth; inline red text for field/setup errors; `confirm()` for destructive actions |
| Naming | `camelCase` vars; DB/JSON fields sometimes `snake_case` (`start_gp`, `user_id`, `less_than`) |
| Comments | Sparse; some UX comments in setup page |
| File layout | Route = `src/app/<route>/page.tsx`; shared UI under `src/components`; domain helpers under `src/lib` |

### Prefer

- Reuse `@/types/rules` and `@/lib/gpRules` rather than copying types or input helpers.
- Keep money math in `src/lib/pricing` only. Final rule-set validity is `validateRuleSetForPricing`.
- Rule editors live in `src/components/rules/`.

### Avoid (unless explicitly requested)

- Adding service-role Supabase keys to the client.
- Changing VAT rate, rounding, or GP formula without product confirmation.
- Expanding scope into inventory/catalogue features without design agreement.

---

## Related docs

- [`05-project-architecture.md`](./05-project-architecture.md) — canonical intended architecture  
- [`06-current-implementation.md`](./06-current-implementation.md) — canonical current technical overview  
- [`AI_CONTEXT.md`](./AI_CONTEXT.md) — detailed product + business logic orientation  
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — detailed system structure  
- [`DATA_MODEL.md`](./DATA_MODEL.md) — schema and types  
- Root [`README.md`](../README.md) — still create-next-app boilerplate  
