# Fedistack — Architecture & Agent Instructions

## 1. Project Overview

**Project Name:** Fedistack  
**Repository:** `fedistack`  
**License:** AGPL-3.0-or-later  
**Category:** Free and open-source federated publishing and newsletter platform

Fedistack is an open-source, self-hostable alternative to Substack that enables independent writers, journalists, publishers, and organizations to publish content, cultivate audiences, federate across the open social web, and monetize publications without vendor lock-in or dependence on a single payment processor.

### Core Capabilities

1. **Publication & Content Management:** Multi-publication administration, organization-level ownership, and editorial workflows.
2. **Rich-Text Article Editing:** Structured document authoring and safe, high-fidelity content rendering.
3. **Reader Memberships:** Free, paid, tiered, and complimentary reader memberships.
4. **Premium Content Access Control:** Server-enforced entitlement checks for subscriber-only articles.
5. **Email Newsletters:** Verified email subscriptions, publication-specific lists, and durable delivery pipelines.
6. **ActivityPub Federation:** Native social web distribution, WebFinger discovery, and remote actor interactions.
7. **Provider-Neutral Billing & Subscriptions:** Built-in subscription lifecycle, invoicing, checkout orchestration, and reconciliation.
8. **Installable Payment Processor Plugins:** Extensible gateway architecture with zero preinstalled or hardcoded processors.
9. **Multi-Publication Administration:** Explicit tenant boundaries supporting multiple organizations and publications per deployment.
10. **Data Portability:** Full ownership and exportability of content, subscriber lists, and membership records.

### Distribution Targets

- **Primary Target:** Self-hosted installations operable independently by individuals, collectives, or organizations.
- **Secondary Target:** Future managed multi-tenant hosting built from the exact same shared codebase.

---

## 2. Mandatory Architectural Decisions

### Unified Single-Repository Monolith

- **Single Repository:** All Fedistack application code, core domain packages, and official plugin interfaces live in this single unified `fedistack` repository.
- **No Split Repositories:** Any legacy or prior concept of separating the project into `fedistack-core` and `fedistack-payments` repositories is **permanently superseded and prohibited**. There is no standalone external payments service required to run Fedistack.
- **Modular Monolith:** Fedistack uses a modular monolith architecture with strict internal domain boundaries. Logical modularity does not require deploying separate microservices or independent processes unless a concrete runtime workload (such as background queue workers) requires it.

### Core Logical Modules

The system is partitioned into independent logical modules with explicit responsibilities:

- **Authentication & Identity (`auth`):** User accounts, server-side sessions, passwordless magic links, CSRF protection, and role-based access control (RBAC).
- **Organizations & Publications (`publishing` / `membership` / core tenant model):** Multi-tenant hierarchy, organization roles, publication settings, and tenant isolation.
- **Publishing & Editorial Workflows (`publishing`):** Articles, drafts, structured documents, slug management, and public/premium content rendering.
- **Reader Memberships (`membership`):** Free and paid reader relationships, membership tiers, complimentary access, and time-bounded content entitlements.
- **Billing & Subscriptions (`payments`):** Provider-neutral pricing, billing intervals, subscription state machines, invoices, transactions, checkout orchestration, and payment plugin management.
- **Payment Processor Plugins (`plugins/payment-processors`):** Optional, installable adapters that translate between external payment gateways and Fedistack's normalized payment events.
- **ActivityPub Federation (`federation`):** Publication actors, WebFinger discovery, inbox/outbox processing, and federated content distribution.
- **Newsletter Delivery (`newsletter`):** Mailing lists, subscription verification, consent tracking, bounce/suppression handling, and email dispatch.
- **Media Storage (`storage`):** S3-compatible object storage abstractions for uploaded images and publication assets.
- **Administration:** Instance-level and organization-level management interfaces and audit logging.

---

## 3. Technology Stack

All engineering work must adhere to the planned technology stack:

| Layer | Technology | Notes & Constraints |
| :--- | :--- | :--- |
| **Language** | TypeScript | Strict typechecking enabled (`strict: true`). Avoid unjustified `any`. |
| **Runtime** | Node.js | Primary target for initial production deployments. |
| **Package Manager** | Bun | Used for package management, workspace orchestration, and local development. |
| **Web Frontend** | Next.js (App Router) & React | Server and client components; keep business logic out of React components. |
| **Backend API** | Hono | Lightweight, type-safe REST APIs. |
| **Validation** | Zod | Mandatory runtime validation for all untrusted inputs, API payloads, and configs. |
| **Styling** | Tailwind CSS | Accessible, responsive UI patterns. |
| **Database** | PostgreSQL | Primary relational datastore. |
| **ORM & Migrations** | Drizzle ORM | Schema definitions, type-safe queries, and version-controlled SQL migrations. |
| **Content Editor** | TipTap / ProseMirror | Structured JSON document storage and sanitized server-side/client-side rendering. |
| **Federation** | ActivityPub & Fedify | Native federation framework with WebFinger account discovery. |
| **Operations** | Docker Compose | Initial self-hosted deployment target with environment-based configuration. |
| **Email & Storage** | SMTP & S3-Compatible Object Storage | Configurable transactional/newsletter email providers and media asset storage. |
| **Background Jobs** | Durable Queues | Asynchronous, retryable job processing for webhooks, federation, and emails. |
| **Testing** | Vitest & Playwright | Vitest for unit/integration suites; Playwright for browser end-to-end tests. |

**Dependency Policy:**
- Use stable, supported dependency versions and verify against official documentation.
- Do **not** install dependencies prematurely simply because they appear in the architectural roadmap. Only add packages when implementing the concrete feature that requires them.

---

## 4. Repository Organization

The target monorepo layout is structured as follows:

```text
fedistack/
├── AGENTS.md
├── apps/
│   ├── web/                    # Next.js App Router frontend & SSR
│   ├── api/                    # Hono REST API & webhook endpoints
│   └── worker/                 # Background job worker (queues, email, federation)
├── packages/
│   ├── database/               # Drizzle schemas, client, and SQL migrations
│   ├── auth/                   # Authentication, sessions, and RBAC
│   ├── publishing/             # Organizations, publications, articles, and editor rendering
│   ├── membership/             # Reader memberships, tiers, and content entitlements
│   ├── payments/               # Built-in provider-neutral billing & plugin host framework
│   ├── federation/             # ActivityPub actors, WebFinger, and Fedify integration
│   ├── newsletter/             # Email subscription management and delivery pipelines
│   ├── storage/                # S3-compatible media upload and asset management
│   └── ui/                     # Shared accessible React UI components
├── plugins/
│   └── payment-processors/     # Optional, separately installable payment gateway plugins
├── deploy/                     # Docker Compose and self-hosting deployment assets
├── docs/                       # Architecture, operator, and plugin developer documentation
├── tests/                      # Cross-cutting integration and E2E test suites
├── LICENSE.md                  # AGPL-3.0-or-later license
├── .env.example                # Documented environment variable template
└── README.md                   # Project overview and quickstart
```

### Structural Rules

- **Incremental Creation:** This directory tree is architectural guidance. Do **not** scaffold empty placeholder packages or empty plugin directories ahead of time. Create workspaces only when their functionality is actively being implemented.
- **Core vs. Plugins:** `packages/payments` is a core, built-in module of the unified Fedistack application. `plugins/payment-processors` holds optional provider adapters.
- **No Implicit Activation:** A plugin existing in `plugins/payment-processors` within the source repository must **never** imply that the plugin is installed, loaded, configured, or active in a running Fedistack deployment.

---

## 5. Payment & Monetization Architecture (CRITICAL)

Fedistack includes a **built-in, provider-neutral payment and subscription management framework** (`packages/payments`), while delegating all external payment gateway communication to **separately installable payment processor plugins**.

**MANDATORY RULE:** **No payment processor plugin is preinstalled or enabled by default.**

### 5.1 Built-In Payment Framework (`packages/payments`)

The core Fedistack application natively manages:
- Membership tiers, pricing models, and billing intervals.
- Subscription lifecycle state machines, cancellations, and renewal policies.
- Invoice records and payment transaction ledgers.
- Checkout session orchestration and redirect lifecycle.
- Payment processor plugin discovery, registration, and configuration schemas.
- Normalized payment event ingestion and idempotent state reconciliation.
- Refund, chargeback, and dispute state representation.
- Hand-off of verified billing state to the `membership` module to grant or revoke content entitlements.

**Strict Gateway Neutrality:** No specific payment gateway (e.g., Stripe, Midtrans, Xendit) may ever be hardcoded into core billing tables, domain models, or business logic.

### 5.2 Installable Payment Processor Plugins

Actual payment execution is handled through modular plugins conforming to a versioned Fedistack Plugin API.

- **Official First-Party Plugin Target:** **Midtrans** is the sole payment processor plugin developed and maintained by the core project. Even as the sole first-party plugin, Midtrans must be built strictly as an optional, separately installable plugin under `plugins/payment-processors` (never preinstalled/enabled by default, and never leaking Midtrans-specific logic into `packages/payments`).
- **Community-Maintained Integrations:** Other payment gateways (such as Xendit, Stripe, Paystack, Mollie, Razorpay, etc.) will **not** be built by the core project; supporting those gateways is the responsibility of third-party/community plugin developers using the public Fedistack Plugin API.
- **Plugin Responsibilities:**
  - Merchant credential authentication and connection validation.
  - Hosted checkout session creation and payment method discovery.
  - Payment status queries and provider-managed recurring billing (when supported).
  - Refund execution (when supported).
  - Cryptographic webhook signature verification.
  - Translation of provider-specific payloads into normalized Fedistack payment events.
- **SDK Isolation:** Provider SDKs and raw HTTP calls must remain strictly encapsulated inside their respective plugin package. Never import payment gateway SDKs into `publishing`, `membership`, `payments`, or `apps/*`.

### 5.3 Plugin Installation & Merchant Configuration Workflow

Plugin installation (instance-level) and merchant account configuration (publication-level) are distinct operations with separate authorization boundaries:

1. An instance administrator deploys Fedistack; zero payment processor plugins are installed or active.
2. An administrator or publisher creates an organization and publication.
3. Opening **Monetization Settings** reveals options to install or configure a payment processor plugin.
4. An **instance administrator** installs and enables a compatible payment processor plugin.
5. An authorized **publication administrator** configures their merchant credentials for that publication.
6. Fedistack validates the merchant connection via the plugin.
7. The publisher defines paid membership tiers and pricing.
8. Readers purchase subscriptions using the publication's configured gateway.

In managed multi-tenant hosting, instance administrators may centrally install vetted plugins for publishers to configure with their own merchant accounts, without permitting publishers to upload or execute arbitrary code.

### 5.4 Versioned Plugin Contract & Capability Adaptation

Each payment plugin must export a manifest and implementation declaring:
- Unique plugin identifier and semantic version.
- Compatible Fedistack Plugin API version range.
- Display name and Zod-validated configuration schema.
- Declared capabilities and supported payment operations (e.g., one-time payments, automatic recurring billing, invoice-based manual renewals, refunds, cancellations, status polling, payment method tokenization).

**Capability Variance:**
- Do not assume every payment processor supports identical capabilities (e.g., native recurring subscriptions vs. invoice-driven renewals).
- Do not assume every merchant account can use all capabilities advertised by its gateway; availability varies by country, currency, merchant category, and underwriting approval.
- The core billing framework must inspect declared/active capabilities and adapt workflows dynamically without provider-specific `if/else` branches in core code.

### 5.5 Plugin Security & Trust Controls

Because payment plugins execute code and handle financial state, strict security controls apply:
- **Explicit Authorization:** No automatic downloading or execution of arbitrary third-party code. Plugin installation requires explicit instance administrator authorization.
- **Credential Protection:** Encrypt sensitive merchant credentials and webhook signing secrets at rest. Never expose payment credentials or secret keys to client browsers or logs.
- **Webhook Integrity:** Verify cryptographic webhook signatures inside the plugin before emitting normalized events.
- **Idempotency:** Handle duplicate, delayed, and out-of-order webhook deliveries idempotently using provider event IDs and state transitions.
- **Auditability:** Record immutable audit logs for plugin installation, updates, activation, deactivation, and merchant credential changes.
- **In-Process Awareness:** Do not assume in-process JavaScript plugins are sandboxed; initially restrict installation to officially maintained or administrator-vetted plugins.

### 5.6 Gateway Independence & Processor Portability

- Publishers must be free to install and use any compatible first-party or community-developed gateway plugin suited to their legal entity and jurisdiction (e.g., the official Midtrans plugin in Indonesia, or community-maintained plugins for gateways like Xendit, Paystack, Mollie, Razorpay, or Stripe).
- Gateway selection must never be inferred from or restricted by the physical geographic location of the hosting server.
- Switching payment processors for a publication must preserve:
  - Reader identities and accounts.
  - Membership tiers and historical subscription/invoice records.
  - Active membership entitlements through their paid period.
- Do **not** promise automatic migration of underlying card tokens, mandates, or provider-managed recurring billing schedules between unrelated payment gateways.

---

## 6. Logical Separation of Publishing, Memberships, and Billing

Publishing must **never** depend on a payment processor being installed or configured.

### Free-Only Operating Mode

Out of the box—with zero payment plugins installed—a Fedistack deployment must fully support:
- Creating and managing organizations and publications.
- Authoring, saving drafts, publishing, and unpublishing articles.
- Federating public content over ActivityPub.
- Registering and managing free members.
- Sending email newsletters to authorized subscribers.
- Granting complimentary memberships and non-payment-based access entitlements.

### Strict Domain Boundaries

1. **`payments` module:** Tracks verified billing state (invoices, transactions, gateway events).
2. **`membership` module:** Translates verified billing state or administrative grants into time-bounded reader **entitlements**.
3. **`publishing` module:** Enforces content access control solely by querying `membership` entitlements.

**Critical Security Rules:**
- Publishing and content-rendering code must never inspect raw provider payment statuses or gateway tables.
- **Never** grant paid content access or activate a membership merely because a user was redirected back from a checkout success URL. Access must only be granted after cryptographic webhook verification or authenticated server-to-server payment status confirmation.

---

## 7. Organizations, Multi-Tenancy, and Isolation

Fedistack is inherently multi-tenant from day one. Never assume an installation hosts only a single organization or single publication.

### Tenant Hierarchy

- **Deployment:** A single running instance of Fedistack.
- **Organization:** A tenant boundary that owns and manages one or more publications.
- **Publication:** A distinct publishing identity containing articles, membership tiers, subscribers, newsletter lists, ActivityPub actor state, and merchant configurations.
- **User:** An individual account that may hold role-based memberships across multiple organizations and reader subscriptions across multiple publications.

### Multi-Tenant Security Rules

- Every publication must belong to an organization.
- Every private query and mutation must enforce server-side authorization and explicit organization/publication scoping.
- **Never** trust client-supplied `organizationId` or `publicationId` parameters without verifying the authenticated user's role and permissions for that specific tenant.
- Strictly prevent cross-organization data leakage and cross-publication credential access.
- Isolate merchant connections, webhook secrets, and financial records per publication/organization so that hosted deployments never commingle financial data across publishers.

---

## 8. Publishing System

The `publishing` module is the authoritative owner of editorial content:
- Articles, drafts, and publication lifecycle statuses (`draft`, `published`, `unpublished`, etc.).
- TipTap / ProseMirror structured JSON documents and article metadata.
- Public and subscriber-only article rendering.

### Editorial & Content Rules

- **Privacy by Default:** Drafts and unpublished articles are strictly private to authorized editorial members of the publication.
- **Public Access:** Published public articles are accessible anonymously without authentication.
- **Identifiers & Routing:** Maintain immutable internal UUID/ULID identifiers for articles; enforce slug uniqueness per publication.
- **Server-Side Validation & Sanitization:** Validate structured editor documents on the server using Zod. Render structured content deterministically and safely; never trust or inject unsanitized raw HTML.
- **Leakage Prevention:** When serving premium articles to unauthenticated or unentitled readers, strip restricted document body nodes on the server before serialization—never rely on CSS hiding or client-side gating.
- **Protocol Independence:** Keep canonical article storage independent of ActivityPub formatting or email HTML rendering.
- **Extensibility:** Design schemas cleanly so future capabilities (e.g., revision history, scheduled publishing) can be added without breaking changes, but do not build speculative placeholder features until scheduled.

---

## 9. ActivityPub Federation

ActivityPub federation (`packages/federation`, powered by Fedify) is an optional, native distribution channel for publications.

### Planned Capabilities

- Publication-level ActivityPub actors and WebFinger discovery (`acct:publication@domain`).
- Remote follow/unfollow workflows and follower collection management.
- Outbound federation of published public articles and public previews/teasers of premium articles.
- Federated article updates and deletions.
- Inbound handling of compatible likes, boosts (announces), and replies, alongside instance/publication moderation and domain/actor blocking.

### Federation Security & Architecture Boundaries

- **Stable Actor IDs:** ActivityPub actor URIs and keypairs must remain stable across publication renames where feasible.
- **Premium Content Protection:** ActivityPub is a public/semi-public distribution protocol, **not** an entitlement enforcement mechanism. **Never federate full premium article bodies** to remote servers, and never assume remote instances can enforce Fedistack paywalls. Only federate public articles or explicit public previews of subscriber-only posts.
- **Zero Billing Coupling:** Federation must operate independently of billing and payment plugins.
- **Untrusted Remote Input:** Treat all inbound ActivityPub payloads as untrusted. Strictly sanitize remote HTML, validate JSON-LD/ActivityStreams schemas, verify HTTP Signatures / Object Integrity proofs, and defend against Server-Side Request Forgery (SSRF) when dereferencing remote URIs.
- **Resilient Delivery:** Execute outbound federation deliveries via durable, retryable background queues so slow or unreachable remote servers never block local publishing actions.

---

## 10. Authentication, Memberships, and Privacy

### Authentication & Sessions (`packages/auth`)

- Identity and session management belong natively to Fedistack.
- Support secure server-side sessions backed by PostgreSQL.
- Initial administrator and reader authentication uses passwordless email magic links:
  - Generate cryptographically random, short-lived, single-use tokens.
  - Store only cryptographic hashes of authentication tokens in the database.
  - Issue `HttpOnly`, `Secure`, appropriately scoped `SameSite` session cookies.
  - Enforce CSRF protection on state-changing endpoints and rate limiting on authentication routes.
  - Support immediate session invalidation on logout or security events.
  - Enforce Role-Based Access Control (RBAC) across instance, organization, and publication scopes.
  - **Never** ship default administrator passwords or log raw tokens, magic links, session IDs, or passwords.

### Memberships & Privacy (`packages/membership`)

- Support free memberships, paid tiered memberships, complimentary memberships, and time-bounded entitlements with clean cancellation and expiration handling.
- Treat reader email addresses, subscription statuses, and personal data as confidential.
- **Never** expose subscriber email lists or private membership rosters via public APIs or ActivityPub collections.

---

## 11. Newsletter Architecture

The `newsletter` module provides built-in email distribution for publications:
- Double opt-in / verified email subscriptions and explicit consent records.
- Publication-scoped mailing lists and one-click RFC-compliant unsubscribe links.
- Configurable SMTP and transactional email provider adapters.
- Durable background delivery jobs with exponential backoff, bounce handling, complaint suppression, and idempotency keys to prevent duplicate email dispatches.
- **Entitlement Enforcement:** Email delivery pipelines must verify each recipient's current membership entitlement before dispatching subscriber-only newsletter issues.
- **Gateway Independence:** Newsletter delivery must function regardless of whether any payment processor plugin is installed or available.

---

## 12. Engineering & Development Standards

All coding agents and contributors must uphold these engineering standards:

1. **Strict TypeScript:** Enable and respect strict compiler checks. Do not use `any`, `@ts-ignore`, or unsafe type assertions without documented justification.
2. **Input Validation:** Validate all external inputs (HTTP bodies, query params, headers, webhooks, environment variables, plugin configs) at the boundary using Zod.
3. **Database Hygiene:** Use Drizzle ORM for schema definitions and queries. Generate and commit version-controlled SQL migrations; never rely on unversioned schema pushes in production workflows.
4. **Separation of Concerns:** Keep domain logic, authorization checks, and database queries inside domain packages (`packages/*`), separate from Next.js React components and thin Hono route handlers.
5. **Module Boundaries:** Enforce unidirectional dependencies between packages. Avoid circular dependencies across workspaces.
6. **Simplicity Over Speculation:** Write clear, maintainable code for current requirements. Avoid premature abstractions or speculative scaffolding for future milestones.
7. **UI Quality:** Build accessible (WCAG-compliant), semantic, keyboard-navigable, and responsive interfaces with Tailwind CSS.
8. **Configuration & Secrets:** Document all required and optional environment variables in `.env.example`. Never hardcode URLs, ports, or credentials, and never commit real secrets.
9. **Observability & Error Handling:** Use structured logging (redacting sensitive fields) and explicit, typed error handling.

---

## 13. Testing & Quality Assurance

Use **Vitest** for unit and integration testing and **Playwright** for end-to-end browser testing.

### Required Test Coverage by Domain

- **Core & Publishing:** Unit tests for domain logic, API integration tests, database migration/query tests, RBAC authorization tests, and multi-tenant isolation tests (verifying Organization A cannot read/write Organization B's resources).
- **Security Regressions:** SSRF prevention, HTML sanitization, draft/premium content leakage prevention, and CSRF/auth token validation.
- **Payments & Billing (when implemented):**
  - Duplicate and reordered webhook idempotency.
  - Invalid webhook signature rejection.
  - Failed payment handling, refunds, and disputes.
  - Subscription renewals and entitlement expiration.
  - Graceful degradation when a payment plugin is unavailable or unconfigured.
  - Strict tenant isolation of merchant credentials and financial records.
- **Federation (when implemented):** Protocol conformance and delivery resilience against simulated or local ActivityPub test actors.

### Verification Protocol

Before declaring any engineering task complete, agents **must**:
1. Run all applicable unit, integration, and E2E test suites.
2. Run workspace-wide TypeScript typechecking (`tsc --noEmit`).
3. Run linting and formatting checks.
4. Report any test or build failures transparently.
5. Explicitly list any scenarios or edge cases that could not be tested.

**Never claim tests or checks passed without actually executing them.**

---

## 14. Agent Workflow

All coding agents operating in this repository must follow this three-phase workflow:

### 1. Before Coding
- Read this `AGENTS.md` specification thoroughly.
- Inspect existing workspace files, package configurations, and database schemas.
- Identify which logical domain modules (`auth`, `publishing`, `membership`, `payments`, etc.) are affected.
- Verify existing code conventions and patterns.
- For substantial features or architectural changes, propose a concise implementation plan before writing code.

### 2. During Coding
- Make focused, minimal changes scoped strictly to the assigned task.
- Preserve existing working functionality and tests.
- Respect module boundaries and tenant isolation rules.
- Avoid unrelated refactoring or formatting churn.
- Maintain backward compatibility where feasible.
- Do not run destructive shell or database commands without explicit user approval.
- Update documentation and `.env.example` whenever behavior or configuration changes.
- **Complete the Implementation:** Do not stop at empty scaffolding, stub functions, or mock UI when real implementation is requested. Never represent placeholders as completed features.

### 3. After Coding
- Execute all relevant tests, typechecks, and linters.
- Provide a clear summary of changes and architectural decisions made.
- List all created or modified files.
- Report exact command outputs / test results.
- Provide clear instructions on how to run and verify the new functionality locally.
- Highlight any remaining open questions or follow-up items.

---

## 15. Current Development Status & Roadmap Context

- **Current Stage:** Initial repository setup (`AGENTS.md` architecture baseline established; application code not yet bootstrapped).
- **Next Planned Milestone — Fedistack MVP 0.1 (Publishing Foundation):**
  - Monorepo workspace bootstrap (Bun, TypeScript, Next.js, Hono, Drizzle).
  - PostgreSQL database setup and initial core migrations.
  - Administrator passwordless authentication and session management.
  - Organizations and multi-publication management.
  - Rich-text article editing (TipTap), draft persistence, and publish/unpublish workflows.
  - Public article rendering and publication pages.
  - Local development environment (`docker-compose` / `.env.example`) and foundational automated tests.
- **Subsequent Milestones:** ActivityPub federation (`packages/federation`), reader memberships (`packages/membership`), newsletter delivery (`packages/newsletter`), the built-in payment framework (`packages/payments`), and the initial optional installable payment processor plugin (**Midtrans** under `plugins/payment-processors`, as the sole payment gateway supported for the MVP) will be implemented in dedicated follow-up phases after MVP 0.1.
