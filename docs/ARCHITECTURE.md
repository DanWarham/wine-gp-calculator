# Architecture — Wine GP Calculator

Detailed technical architecture reference. Companion to [`AI_CONTEXT.md`](./AI_CONTEXT.md).

**Documentation authority:** Repository/database evidence determines current implementation. Canonical intended architecture: [`05-project-architecture.md`](./05-project-architecture.md). Canonical current overview: [`06-current-implementation.md`](./06-current-implementation.md). This file provides supporting structural detail. If sources materially disagree, investigate rather than silently reconciling them.

This document describes the **current** client/Supabase structure after Stage 5 (Pricing Configurations + snapshots). The shared pricing engine in `src/lib/pricing` is unchanged. Sales import, Pricing Review, and Scenario Modelling remain future work — see `05`.

---

## Application Layers

The app is a thin **Next.js frontend** over **Supabase Auth + Postgres**. There is no custom application server or API route layer in this repository.

| Layer | Responsibility | Location |
|-------|----------------|----------|
| Presentation | Pages, forms, tables, modals, toasts | `src/app/**`, `src/components/**` |
| Pricing domain | Deterministic GP resolution, pricing, rounding, validation | `src/lib/pricing/**` |
| Form helpers | Input sanitize/validate for rule editor | `src/lib/gpRules.ts`, `src/types/rules.ts` |
| Integration | Supabase JS client | `src/lib/supabaseClient.ts` |
| Platform | Auth sessions, RLS, JSONB storage | Supabase project (hosted) |

```mermaid
flowchart TB
  subgraph client ["Browser — Next.js App Router"]
    Pages["Pages\nwelcome / login /\ncalculator / pricing-configurations / settings"]
    UI["UI components\nshadcn + Headless UI"]
    Domain["Pricing domain\nsrc/lib/pricing"]
    SBClient["supabase-js client"]
    Pages --> UI
    Pages --> Domain
    Pages --> SBClient
  end

  subgraph supabase ["Supabase"]
    Auth["Auth\nemail/password"]
    DB["Postgres\npricing_configurations\nsnapshots / current_events\nserving_sizes\nauth.users"]
  end

  SBClient --> Auth
  SBClient --> DB
```

---

## Frontend Architecture

- **Router:** Next.js App Router under `src/app`.
- **Rendering model:** Interactive routes are `'use client'` components. Root `layout.tsx` is a Server Component wrapping children with fonts + `ToastProvider`.
- **Styling:** Tailwind CSS v4 (`src/app/globals.css`, PostCSS plugin). shadcn “new-york” / slate theme via `components.json`.
- **Path alias:** `@/*` → `./src/*` (`tsconfig.json`).
- **Fonts:** Geist / Geist Mono via `next/font/google` in `layout.tsx`.

### Route structure

| Path | File | Auth expectation | Purpose |
|------|------|------------------|---------|
| `/welcome` | `src/app/welcome/page.tsx` | Public | Entry CTA (Login) |
| `/login` | `src/app/login/page.tsx` | Public | Sign in |
| `/` | `src/app/page.tsx` | Session required (client check) | Calculator (Current Pricing only) |
| `/pricing-configurations` | `src/app/pricing-configurations/page.tsx` | Session required | Pricing Configurations |
| `/settings` | `src/app/settings/page.tsx` | Session required | Serving Sizes |
| `/pricing-data` | `src/app/pricing-data/page.tsx` | Session required | Pricing source import |
| `/api/pricing-data/validate` | `src/app/api/pricing-data/validate/route.ts` | Bearer JWT | Parse/validate uploads (no persist) |
| `/api/pricing-data/import` | `src/app/api/pricing-data/import/route.ts` | Bearer JWT | Parse + atomic commit |

`/signup` and `/gp-setup` removed. Public self-registration is disabled; accounts are administrator-controlled.

There is **no** `middleware.ts` for route protection.

---

## Backend Architecture

**No first-party backend code** beyond what Next.js provides for serving the app.

Persistence and auth are entirely **Supabase**:

- Browser creates a singleton client in `src/lib/supabaseClient.ts` from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/lib/supabaseEnv.ts`).
- Missing required env vars fail clearly (no hardcoded fallback). Privileged credentials must never use `NEXT_PUBLIC_*`.
- Data access uses the Supabase REST/Data API via `.from('pricing_configurations')`, `.from('serving_sizes')`, controlled RPCs, and Auth methods. Legacy `gp_settings` / `pricing_policy` have been **dropped**.

### API structure

| Kind | Present? |
|------|----------|
| Next.js Route Handlers (`src/app/api`) | **Yes** — pricing-data validate/import only |
| Server Actions | **No** |
| Edge Functions (in repo) | **No** |
| Supabase client calls from pages | **Yes** (configs/settings); import commits via authenticated RPC after server parse |

Effective “API” surface used by the app:

| Operation | Client call |
|-----------|-------------|
| Sign in | `supabase.auth.signInWithPassword({ email, password })` |
| Sign out | `supabase.auth.signOut()` |
| Session | `supabase.auth.getSession()` |
| Ensure / load Current configuration | `getOrCreateCurrentPricingConfiguration` → RPC `ensure_current_pricing_configuration` |
| List / create / update / archive / restore configs | `src/lib/pricingConfigurationStore.ts` |
| Make Current | RPC `make_pricing_configuration_current` |
| Capture snapshot | RPC `capture_pricing_configuration_snapshot` |
| Serving size CRUD | `src/lib/servingSizeStore.ts` |
| Login failure mapping | `mapLoginError` — generic invalid credentials; no account-existence lookup |

---

## Database Architecture

See [`DATA_MODEL.md`](./DATA_MODEL.md) for field-level detail.

**Summary:**

- Runtime tables: `public.pricing_configurations`, `public.pricing_configuration_snapshots`, `public.pricing_current_events`, `public.serving_sizes`.
- Auth identities: `auth.users` (Supabase-managed).
- Legacy `gp_settings` / `pricing_policy` removed after Stage 5 cutover.
- RLS enabled: users may only access their own rows (`auth.uid() = user_id`).
- Exactly one Current configuration per user (partial unique index on `is_current`).
- Clients cannot set `user_id` / `is_current` (column privileges + defaults + RPCs).
- Snapshots/events are immutable from the client (SELECT only; writes via SECURITY DEFINER RPCs).

```mermaid
erDiagram
  AUTH_USERS ||--o{ PRICING_CONFIGURATIONS : "user_id"
  AUTH_USERS ||--o{ SERVING_SIZES : "user_id"
  PRICING_CONFIGURATIONS ||--o{ SNAPSHOTS : "source"
  PRICING_CONFIGURATIONS ||--o{ CURRENT_EVENTS : "previous/new"
  AUTH_USERS {
    uuid id PK
    string email
  }
  PRICING_CONFIGURATIONS {
    uuid id PK
    uuid user_id FK
    text name
    boolean is_current
    text status
    jsonb rules
  }
```

---

## State Management

- **No** Redux, Zustand, Jotai, React Query, or similar.
- Page-local React state (`useState`) + `useEffect` for:
  - session bootstrap / redirects
  - loading rules
  - debounced GP recalculation (~200ms timeout on home page)
- Cross-cutting UI state: React Context in `ToastProvider` (`showToast`).
- Auth session: managed internally by `supabase-js` (persisted in browser storage by the library).

---

## Authentication Flow

```mermaid
sequenceDiagram
  participant U as User
  participant W as /welcome
  participant L as /login
  participant S as Supabase Auth
  participant H as / (calculator)
  participant DB as pricing_configurations

  U->>W: Open app
  W->>L: Login
  L->>S: signInWithPassword
  S-->>L: session
  L->>H: router.push("/")
  H->>S: getSession()
  alt no session
    H->>W: redirect
  else session
    H->>DB: ensure/load Current configuration
    alt missing / empty rules
      H->>H: show setup modal → /pricing-configurations
    else rules present
      H->>H: enable calculator
    end
  end
```

**Notes:**

- Public signup is disabled on the linked Supabase project. New accounts are created administratively.
- Server-side Auth password minimum is 8 characters. Login failures use a generic non-enumerating message.

---

## External Integrations

| Service | Usage |
|---------|--------|
| **Supabase** | Auth + Postgres Data API |
| **Vercel fonts / Next defaults** | Geist via `next/font`; stock `public/*.svg` from create-next-app |

No payment, email-sending SDK, analytics, or wine data APIs appear in dependencies or source.

---

## Error Handling

| Area | Pattern |
|------|---------|
| Login | Toast messages via `useToast`; `mapLoginError` for generic/network failures |
| Calculator | Inline cost validation errors; empty Current rules → blocking modal |
| Pricing Configurations | Inline errors; Headless UI dialog for gaps; confirms for archive/Make Current |
| Supabase errors | Often `.message` surfaced as text; some paths `console.error` |
| Shared toast | Auto-dismiss after 3s |

There is no global error boundary component in the repo.

---

## Configuration

| Config file | Role |
|-------------|------|
| `next.config.ts` | Default empty Next config object |
| `tsconfig.json` | Strict TS, path aliases |
| `eslint.config.mjs` | `next/core-web-vitals` + `next/typescript` |
| `postcss.config.mjs` | Tailwind v4 PostCSS plugin |
| `components.json` | shadcn generator settings |
| `package.json` | Scripts and dependencies |
| `.gitignore` | Ignores `.env*`, `.next`, `node_modules`, `.vercel` |

**Runtime secrets/config:** browser-safe Supabase values from `NEXT_PUBLIC_*` env vars (see `.env.example`). `.gitignore` ignores `.env*` except `.env.example`.

---

## Deployment Architecture

**Identifiable from repo:**

- Standard Next.js app (`next build` / `next start`).
- README documents Deploy on Vercel (boilerplate).
- `.gitignore` includes `.vercel`.
- **No** `vercel.json`, Dockerfile, GitHub Actions, or other IaC in the repository.

**Assumption:** Production is (or is intended to be) a Vercel (or similar) Node host for Next.js, with Supabase remaining an external managed service. Confirm with the owner if another host is used.

```mermaid
flowchart LR
  User --> CDN["Hosted Next.js app\n(assumed Vercel)"]
  CDN --> Supabase["Supabase Auth + DB"]
```

---

## Dependency Relationships

```mermaid
flowchart LR
  next["next 15"] --> react["react 19"]
  pages["app pages"] --> next
  pages --> supabase["@supabase/supabase-js"]
  pages --> ui["components/ui"]
  pages --> rulesComp["components/rules"]
  pages --> gpRules["lib/gpRules"]
  rulesComp --> gpRules
  rulesComp --> types["types/rules"]
  ui --> cva["class-variance-authority"]
  ui --> radix["@radix-ui/*"]
  ui --> utils["lib/utils cn()"]
  pricingConfigs["pricing-configurations"] --> headless["@headlessui/react"]
```

**Notable absences:** E2E test framework, ORM, form libraries, state libraries, env validation (`zod` + `t3-env`, etc.). Domain unit tests use Vitest.

---

## Main User / Data Flow

```mermaid
flowchart TD
  A[Enter cost ex VAT + options] --> B[Load Current Pricing Configuration]
  B --> C[resolveTargetGp via 750ml reference cost]
  C --> D[User may nudge GP ±1%]
  D --> E[priceWithGp using Current pricing policy]
  E --> F{BTG?}
  F -->|Yes| G[Bottle line discounted; pours undiscounted basis]
  F -->|No| H[Show bottle only]
  G --> I[Round via policy increments]
  H --> I
  I --> J[Display price table or explicit error]
```

Configuration persistence flow:

```mermaid
flowchart TD
  E[Edit rules/policy on /pricing-configurations] --> V[Overlap check]
  V --> G[Gap analysis]
  G -->|gaps| M[Modal: add missing betweens]
  G -->|ok| S[update pricing_configurations]
  M --> E
  S --> H[Stay on editor / return to calculator]
```
