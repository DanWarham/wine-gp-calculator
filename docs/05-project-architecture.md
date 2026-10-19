# Project Architecture — Wine GP Calculator

Canonical description of **intended enduring architecture** and established product/domain direction.

**Authority:** This document describes what the product is intended to be. Repository and database evidence determine what is currently implemented — see [`06-current-implementation.md`](./06-current-implementation.md). Detailed references remain in [`AI_CONTEXT.md`](./AI_CONTEXT.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DATA_MODEL.md`](./DATA_MODEL.md), and [`DEVELOPMENT.md`](./DEVELOPMENT.md). If these sources materially disagree, investigate rather than silently reconciling them.

**Test for inclusion here:** if the implementation technology changed significantly, would this statement still describe the intended Wine GP Calculator product/domain?

---

## Project Purpose

Wine GP Calculator helps hospitality and wine-programme operators establish and analyse wine selling prices using acquisition cost, gross-profit (GP) targets, and pricing rules.

The product is evolving from a single-wine calculator toward a deterministic wine-pricing and profitability-analysis tool. The existing individual-wine calculator remains part of that product; it is not being replaced.

---

## Core Product Capabilities

### Individual pricing

A user can calculate suggested wine selling prices from:

- acquisition cost;
- pricing rules;
- relevant pricing policy;
- bottle/pour context.

### Pricing rules

Users define rules that map cost bands to target GP. Rules may include:

- universal GP (one GP for all costs);
- lower/upper bands (`less_than` / `greater_than`);
- interpolated GP ranges (`between`).

Rule cost boundaries are defined on a **750ml-equivalent acquisition cost**. See [Bottle-size rule normalisation](#bottle-size-rule-normalisation).

### Pricing policy and serving sizes

Users configure commercial pricing policy (VAT, BTG bottle discount, rounding increments) and named serving sizes within fixed wine categories (Dry, Sweet/Fortified, Sparkling). Defaults and semantics are established below.

### Historical sales analysis

The product will support importing historical wine-sales data and analysing actual financial performance.

### Counterfactual scenarios

Users will be able to apply alternative pricing rules to historical sales to determine what prices and financial results would have resulted **at the same historic sales quantities**.

> Fixed-volume scenario modelling is a counterfactual calculation, not a demand or sales forecast.

Future demand/elasticity modelling is conceptually separate and must not be mixed into deterministic financial calculation.

---

## Core Domain Principles

### One deterministic pricing engine

All pricing calculations should ultimately use one shared deterministic financial implementation. It must support both:

- individual calculator use;
- batch/scenario calculation.

Independent calculator and scenario formulas must not evolve separately.

### Financial correctness

Pricing calculations must be:

- deterministic;
- reproducible;
- testable;
- explicit about invalid inputs;
- consistent across interfaces.

Financial errors must not silently fall back to plausible-looking prices.

### Pricing rules vs pricing policy

| Concept | Role |
|---------|------|
| **Pricing rules** | Determine target GP according to cost/range (matched on 750ml-equivalent reference cost). |
| **Pricing policy** | Defines other commercial calculation behaviour: VAT treatment, BTG bottle discount, and rounding increments. |

Pricing-policy values are **user-configurable**. Current defaults (VAT 20%, BTG bottle discount 5%, bottle round £1, glass round £0.50) are starting defaults, not permanent hardcoded constants.

### Bottle-size rule normalisation

Pricing-rule cost boundaries are defined on a **750ml-equivalent acquisition cost**.

For rule evaluation:

```text
referenceCost750ml =
actualCostExVat × 750 / bottleSizeMl
```

Examples:

```text
375ml bottle costing £50  → £100 / 750ml equivalent
750ml bottle costing £100 → £100 / 750ml equivalent
1500ml magnum costing £200 → £100 / 750ml equivalent
```

The resulting GP is then applied to the **actual acquisition cost of the actual bottle**, not to the normalised reference cost.

750ml is the canonical reference volume for pricing-rule boundaries. This applies to standard and valid custom bottle sizes.

### GP precision

Rule evaluation and interpolation must retain **full calculation precision**.

Do not round an interpolated GP to a whole percentage before calculating selling price. Commercial price rounding occurs only at the appropriate final pricing stage.

The UI may display GP at reduced precision for readability, but display formatting must not change the calculation input.

### Invalid / uncovered rules

A pricing rule set that cannot resolve a valid GP for a given reference cost is **invalid for that calculation**.

The pricing domain must return an explicit validation/calculation failure rather than silently substituting a plausible GP (including any legacy 70% fallback).

### GP upper bound

GP used in the margin formula must satisfy:

```text
GP < 100%
```

100% is invalid because it creates a zero denominator.

Do not unnecessarily impose a whole-number maximum such as 99%. The accepted maximum is determined by the supported input precision (for example, with one-decimal GP inputs, 99.9% is valid).

### BTG bottle discount semantics

When a wine is offered by the glass:

- the configured BTG bottle discount applies to the displayed **full-bottle price**;
- glass/pour prices derive from the **undiscounted bottle-equivalent price**;
- the BTG discount must not reduce the glass-price calculation basis.

### User-configurable serving sizes

Users may define arbitrary named serving sizes within the existing wine categories:

- Dry;
- Sweet/Fortified;
- Sparkling.

A serving-size configuration conceptually contains at least:

```text
label
volumeMl
enabled
category
displayOrder
```

Users may define different labels and volumes without application-code changes. User-defined wine categories are **not** introduced at this stage.

### Scenario reproducibility

A scenario must pin enough immutable pricing information that reopening or recomputing it later does not silently change because the user’s live rules, pricing policy, or serving-size configuration changed.

The simplest intended model is snapshot/version based. Effective dating is not currently required.

---

## Sales Data Architecture Principles

### Canonical internal representation

Source sales-file layouts must not define the financial-analysis domain.

```text
Source sales data
    ↓
Import / mapping
    ↓
Validation
    ↓
Canonical sales representation
    ↓
Financial analysis / scenarios
```

Financial calculations operate on canonical data, not source-specific spreadsheet columns.

### Initial known format

The first importer will target the Product Owner’s known real sales-data format. Universal import capability is not required initially.

### Future mappings

Later source layouts should be handled by reusable source-to-canonical mappings. Potential AI assistance may suggest mappings in future, but AI output must not become part of deterministic price/GP calculations.

### Data grain

Preserve the finest reliable sales grain available from the source where practical; higher-level aggregation can be derived.

A complete wine catalogue is not required to support sales analysis. Initially, stable external product identifiers (e.g. PLU/SKU) plus source product names may provide sufficient product identity.

---

## Security and Data Ownership Principles

- Supabase remains the backend platform unless future evidence demonstrates a material reason to change.
- User-owned data must be protected by explicit ownership and RLS.
- Initial ownership is **user-scoped**.
- Do not introduce organisation/multi-site tenancy until a demonstrated requirement exists.
- Commercial sales uploads require a trusted server-side processing boundary rather than arbitrary client-side database ingestion.
- Elevated/service credentials must never be exposed to the browser.
- Database schema and RLS changes must be represented in source-controlled migrations before the sales-data model expands materially.

Beyond the current Next.js / Supabase environment, no specific additional server technology is prescribed unless already established.

---

## Architecture Boundaries

```text
User Interfaces
    │
    ├── Calculator
    ├── Pricing Rule Management
    ├── Pricing Policy / Serving Sizes
    ├── Sales Import
    └── Scenario Analysis
             │
             ▼
Deterministic Pricing Domain
    ├── 750ml reference-cost normalisation
    ├── Rule evaluation (full GP precision)
    ├── Pricing policy
    └── Price calculation
             │
             ▼
Application / Analysis Workflows
    ├── Import normalisation
    └── Scenario orchestration
             │
             ▼
Persistent Data
    ├── Users / ownership
    ├── Current pricing rules
    ├── Current pricing policy / serving sizes
    ├── Immutable pricing snapshots
    ├── Imports / canonical sales
    └── Scenario definitions
```

No speculative microservices or unnecessary layers.

---

## Explicit Non-Goals / Deferred Capabilities

The architecture does **not currently require**:

- a full wine catalogue / inventory system;
- multi-site / organisation tenancy;
- arbitrary POS integrations;
- demand elasticity modelling;
- AI inside the financial calculation path;
- effective-dated pricing calendars;
- permanently materialised scenario results;
- a universal importer in the first sales-data phase;
- user-defined wine categories (serving sizes are configurable within fixed categories only).

These can be reconsidered if real requirements emerge.

---

## Established Architecture Decisions

1. Evolve the existing application incrementally; no rewrite is justified.
2. Preserve the useful existing individual-wine calculator.
3. Establish one deterministic pricing engine.
4. Pricing rules and commercial pricing policy are conceptually distinct.
5. Pricing-rule cost boundaries use **750ml-equivalent** reference cost; resolved GP applies to the **actual** bottle acquisition cost.
6. Rule evaluation and interpolation retain **full GP calculation precision**; commercial rounding is final-stage only; UI display formatting must not alter calculation inputs.
7. Uncovered / unresolvable rule sets produce an **explicit calculation failure** — no silent GP fallback.
8. Margin GP must satisfy **GP &lt; 100%**; maximum valid GP follows supported input precision (e.g. 99.9% with one-decimal inputs), not an arbitrary whole-number cap such as 99%.
9. Pricing policy (VAT rate, BTG full-bottle discount, bottle and glass rounding increments) is **user-configurable**, with established defaults.
10. Users may define arbitrary named serving sizes within fixed wine categories (Dry, Sweet/Fortified, Sparkling); categories themselves are not user-defined at this stage.
11. BTG discount applies to the displayed full-bottle price only; glass/pour prices use the undiscounted bottle-equivalent basis.
12. Historical scenario calculations must be reproducible.
13. Scenarios initially hold historic quantities constant.
14. Demand-response modelling is separate and deferred.
15. Sales data is normalised to a canonical representation independent of source layout.
16. First import supports a known source format.
17. Later unknown layouts use reusable mappings.
18. A full wine catalogue is not required initially.
19. Supabase remains the backend.
20. Commercial upload/import processing requires a trusted server boundary.
21. Ownership remains user-scoped initially.
22. Database migrations / RLS definitions should become source-controlled before sales schema expansion.

---

## Domain Invariants

- GP used as a margin in the selling-price calculation must be **strictly below 100%** (`GP < 100`), because 100% makes the denominator zero.
- The maximum allowed GP is the greatest value representable under supported input precision that still satisfies `GP < 100` (for example 99.9% with one-decimal GP inputs). Do not invent a tighter whole-number cap without a separate product decision.
- Financial engine inputs that cannot be validly priced — including uncovered reference costs, GP ≥ 100, or degenerate bands — must produce an explicit validation/calculation failure rather than `Infinity`, `NaN`, or a silent fallback GP.
- Rule matching uses 750ml-equivalent reference cost; the selling-price formula uses actual acquisition cost and the resolved GP.
- Scenario calculations must identify the exact rules/policy (and relevant serving-size) snapshot used.

---

## Open Product Decisions

Unresolved; do not silently resolve in implementation work.

### Registration

Current signup is open. Post-sales-data registration posture remains unresolved.

### Raw import retention

Retention period/policy for uploaded original files remains unresolved.

### Exact first-party sales-file semantics

Must be established from a real anonymised sample before Stage-1 importer design is finalised.

---

## Related Documents

| Document | Role |
|----------|------|
| [`06-current-implementation.md`](./06-current-implementation.md) | Canonical current technical reality |
| [`AI_CONTEXT.md`](./AI_CONTEXT.md) | Detailed product/domain orientation |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Detailed system structure |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | Schema and types detail |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | Local setup and workflow |
| [`ARCHITECTURE_BASELINE_ASSESSMENT.md`](./ARCHITECTURE_BASELINE_ASSESSMENT.md) | Assessment evidence (historical snapshot) |
