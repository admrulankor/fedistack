# Fedistack

Fedistack is a free and open-source, self-hostable federated publishing and newsletter platform licensed under `AGPL-3.0-or-later`.

## Monorepo Structure (MVP 0.1 — Publishing Foundation)

```text
fedistack/
├── apps/
│   ├── api/                    # Hono REST API (auth, organizations, publications, articles & public feeds)
│   └── web/                    # Next.js App Router frontend (dashboard, article editor, public reader views)
├── packages/
│   ├── database/               # Drizzle ORM schema, PostgreSQL client, and version-controlled SQL migrations
│   ├── auth/                   # Passwordless magic links, server-side sessions, CSRF, rate limiting, and RBAC
│   ├── publishing/             # Organizations, publications, TipTap/ProseMirror structured articles, and sanitized server-side rendering
│   └── ui/                     # Shared accessible React UI components (Tailwind CSS)
├── deploy/
│   └── docker-compose.yml      # Local PostgreSQL 16 and Mailpit (local SMTP server)
├── tests/                      # End-to-end PostgreSQL & API integration test suites
└── .env.example                # Documented environment variable template
```

### Key Application Routes

- **Publisher Workspace:**
  - `/dashboard` — Create and administer organizations and publications
  - `/dashboard/publications/[publicationId]` — Manage publication settings, team roles, and articles
  - `/dashboard/publications/[publicationId]/articles/[articleId]` — Structured article authoring, preview, and publish/unpublish lifecycle
- **Public Reader Routes:**
  - `/p/[publicationSlug]` — Public publication homepage and published article feed
  - `/p/[publicationSlug]/[articleSlug]` — Public article reader with server-side paywall enforcement

## Quickstart

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

### 3. Start Local Services (PostgreSQL & Mailpit)

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d
```

- **PostgreSQL:** `localhost:5433`
- **Mailpit SMTP:** `localhost:1025`
- **Mailpit Web UI (inspect magic-link emails):** `http://localhost:8025`

### 4. Run Database Migrations

```bash
bun run db:migrate
```

### 5. Run Development Servers

```bash
# Terminal 1: Start Backend API (port 4000)
bun run dev:api

# Terminal 2: Start Next.js Web App (port 3000)
bun run dev:web
```

## Verification & Testing

```bash
# Run unit & PostgreSQL integration tests
bun run test

# Run workspace-wide TypeScript typechecking
bun run typecheck

# Build production web bundle
bun run build
```
