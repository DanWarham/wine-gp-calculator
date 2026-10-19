# Development Guide — Wine GP Calculator

Practical setup and workflow notes derived from the repository as it exists today.

**Documentation authority:** Repository evidence determines current tooling. Canonical intended architecture: [`05-project-architecture.md`](./05-project-architecture.md). Canonical current overview: [`06-current-implementation.md`](./06-current-implementation.md). This file provides supporting setup/workflow detail. If sources materially disagree, investigate rather than silently reconciling them.

---

## Local Setup

### Prerequisites

- **Node.js** compatible with Next.js 15 / React 19 (exact engine not pinned in `package.json`; use a current LTS).
- **npm** (lockfile is `package-lock.json`; yarn/pnpm/bun mentioned only in stock README).
- Access to the project’s **Supabase** instance (URL + anon key currently baked into `src/lib/supabaseClient.ts`).

### Steps

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000).

**Note:** Application code does **not** load `.env` variables today. Creating a `.env.local` will have **no effect** until `supabaseClient.ts` is changed to read `process.env`.

**Assumption:** Local development uses the shared remote Supabase project referenced in `supabaseClient.ts` (project ref `jcylgbtifwpcjncnnfok`). A `supabase/` directory with config and migrations exists for schema governance. A full local Supabase Docker stack is **not** required for day-to-day app work.

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

### Referenced by application code

**None.** Grep of `src/` shows no `process.env` / `NEXT_PUBLIC_*` usage.

Supabase configuration is **hardcoded** in `src/lib/supabaseClient.ts`:

- Project URL
- Anon (publishable) key

### Anticipated by tooling / gitignore

`.gitignore` ignores `.env*`, implying env files may be added later. Recommended shape **if** the client is refactored (placeholders only — do not commit real values):

```bash
# .env.local.example (proposed — not currently in repo)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Never commit service-role keys. Never paste real credentials into documentation.

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
| Remote history | **Pending operator step:** mark baseline applied via repair (history only), not `db push` of the baseline DDL. As of Stage 3A verification, remote `list_migrations` was still `[]`. |

Application expectations for schema (unchanged by Stage 3A):

- Table `public.gp_settings` with `id`, `user_id` (unique), `rules` (jsonb), `created_at`
- RLS: `auth.uid() = user_id` (policy name preserved in baseline)
- Supabase Auth enabled for email/password
- **No** FK from `gp_settings.user_id` to `auth.users` (current reality; improve only via a later explicit migration)

### Future migration process

1. Understand the required schema change.
2. Create a new source-controlled migration (`npx supabase migration new <name>`).
3. Review: schema impact, data impact, RLS/security, compatibility with application code.
4. Apply the migration to the appropriate linked Supabase environment (`npx supabase db push` or equivalent CI).
5. Verify: migration recorded as applied; expected schema/RLS present; application behaviour remains valid.
6. Commit the migration with the related implementation.

Principles:

- Migrations are authoritative for application schema evolution.
- Dashboard-only schema edits should not be normal development practice.
- Emergency/manual remote changes must subsequently be reconciled with migrations (`db pull` / repair as appropriate).
- Every new user-owned table requires explicit RLS consideration.
- Application code and migrations that depend on one another should be reviewed/deployed coherently.

### CLI notes

```bash
# Create an empty migration file
npx supabase migration new <descriptive_name>

# Mark an already-present remote schema migration as applied (history only — no DDL)
npx supabase migration repair --status applied <timestamp> --project-ref jcylgbtifwpcjncnnfok

# Apply *new* migrations that are not yet on the remote (never use this to re-run the Stage 3A baseline against live)
npx supabase db push

# Compare local vs remote migration status
npx supabase migration list --project-ref jcylgbtifwpcjncnnfok
```

Requires Supabase CLI auth (`npx supabase login` or `SUPABASE_ACCESS_TOKEN`). Linking may also require the database password.

After schema changes, update [`DATA_MODEL.md`](./DATA_MODEL.md) / [`06-current-implementation.md`](./06-current-implementation.md) and verify client queries still match.

To inspect live schema (operators with project access): Supabase dashboard SQL editor, MCP, or `supabase` CLI against the project.

---

## Deployment

**From repository evidence:**

1. Build with `npm run build`.
2. Run with `npm run start`, **or** deploy as a standard Next.js app on a platform such as Vercel (README boilerplate points here).
3. Ensure the deployed build can reach the Supabase project (today: hardcoded client config ships with the bundle).

**Not in repo:** `vercel.json`, Docker, CI workflows, environment setup docs beyond create-next-app README.

**Assumption:** Production hosting is Vercel or equivalent Node host. Confirm with the owner.

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

- Reuse `@/types/rules` and `@/lib/gpRules` rather than copying types/validators.
- Keep money math in `src/lib/pricing` only.
- Use non-emoji rule component filenames (`AllGpRuleForm.tsx`, etc.).

### Avoid (unless explicitly requested)

- Importing `📄 *.tsx` duplicates under `src/components/rules/`.
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
