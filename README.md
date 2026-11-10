# Fedistack

Fedistack is a free and open-source, self-hostable federated publishing and newsletter platform licensed under `AGPL-3.0-or-later`.

## Monorepo Structure (MVP 0.1 — Phase 1)

```text
fedistack/
├── apps/
│   ├── api/                    # Hono REST API (passwordless auth, sessions, CSRF & health)
│   └── web/                    # Next.js App Router frontend (sign-in, magic link verification, workspace)
├── packages/
│   ├── database/               # Drizzle ORM schema, PostgreSQL client, and version-controlled SQL migrations
│   ├── auth/                   # Passwordless magic links, server-side sessions, CSRF, rate limiting, and RBAC
│   └── ui/                     # Shared accessible React UI components (Tailwind CSS)
├── deploy/
│   └── docker-compose.yml      # Local PostgreSQL 16 and Mailpit (local SMTP server)
├── tests/                      # End-to-end PostgreSQL & API integration test suites
└── .env.example                # Documented environment variable template
```

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
