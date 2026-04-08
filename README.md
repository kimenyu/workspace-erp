# Workspace ERP — Multi-Tenant ERP Backend + Worker

A production-style, multi-tenant ERP backend built in **TypeScript** with **NestJS**, **PostgreSQL**, **Prisma**, **Redis/BullMQ**, and **Google Workspace** integrations (**Sheets**) plus **in-memory PDF generation** and **Gmail SMTP** for invoice delivery. You can find the frontend here:  [Workspace ERP Frontend](https://github.com/kimenyu/workspace-erp-frontend)

Design : clean modular architecture, tenant isolation, RBAC, audit logging, background processing, and real accounting/inventory flows.

---

## Table of Contents

- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Modules](#modules)
- [Multi-Tenancy](#multi-tenancy)
- [Auth & Security](#auth--security)
- [RBAC (Roles & Permissions)](#rbac-roles--permissions)
- [Audit Logging](#audit-logging)
- [Inventory](#inventory)
- [Purchasing](#purchasing)
- [Sales](#sales)
- [FIFO Valuation & COGS](#fifo-valuation--cogs)
- [Accounting (Double-Entry)](#accounting-double-entry)
- [Google Workspace Integrations](#google-workspace-integrations)
- [Background Jobs](#background-jobs)
- [Reports](#reports)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Database Migrations](#database-migrations)
- [Run the System](#run-the-system)
- [Quick API Walkthrough (curl)](#quick-api-walkthrough-curl)
- [Scheduling Nightly Exports](#scheduling-nightly-exports)
- [Deployment Notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

---

## Key Features

### Platform
-  **Multi-tenant architecture** with strict tenant scoping (`tenantId` on all business tables)
-  **JWT auth** (access tokens) + **refresh tokens** stored as DB sessions
-  **RBAC** (roles + permissions) enforced per tenant
-  **Audit logging** for mutating requests (POST/PUT/PATCH/DELETE)
-  **Background jobs** with retries/backoff using **BullMQ**
- **Worker service** for async job processing

### ERP Modules
-  CRM: **Customers**
-  Inventory: **Products**, **Stock Movements**, stock levels
-  Purchasing: **Suppliers**, **Purchase Orders**, approve/receive
-  Sales: **Invoices**, invoice lines, mark SENT/PAID
-  Accounting: **Double-entry ledger** (Chart of Accounts, Journal Entries/Lines)
-  FIFO inventory valuation + COGS on sales

### Integrations
-  **Invoice PDF generation** in-memory using **pdfkit** (no external storage required)
-  **Invoice email delivery** via **Gmail SMTP** (nodemailer + App Password)
-  **Inventory export** to **Google Sheets** via service account

---

## Architecture

```
Clients (Web / Mobile / Internal)
  |
  |  REST API (JWT + Tenant)
  v
NestJS API (apps/api)
  |            \
  |             \ enqueue jobs
  v              v
PostgreSQL     Redis (BullMQ)
  ^              |
  |              v
  +-------- Worker (apps/worker) --------+
           | pdfkit + nodemailer         |
           | Google Sheets               |
           +-----------------------------+
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| API Framework | NestJS |
| Database | PostgreSQL + Prisma v7 |
| Queue | Redis + BullMQ |
| PDF Generation | pdfkit (in-memory) |
| Email | nodemailer (Gmail SMTP) |
| Sheets Export | googleapis (Google Sheets API) |
| Local Infra | Docker Compose |

---

## Repository Structure

```
workspace-erp/
  apps/
    api/                 # NestJS API
      src/
        auth/            # JWT auth + refresh sessions
        tenancy/         # Tenant guard + resolution
        rbac/            # permissions + guard
        audit/           # audit interceptor + service
        users/           # basic user endpoints
        inventory/       # products + stock movements + FIFO
        purchasing/      # suppliers + purchase orders
        sales/           # customers + invoices + payments
        accounting/      # chart of accounts + journal entries
        reports/         # reporting endpoints
        integrations/
          google/        # Sheets integration + job enqueueing
        jobs/            # BullMQ queue producer
      prisma/
        schema.prisma    # single source schema
        prisma.config.ts # Prisma v7 datasource config
    worker/              # BullMQ processors
      src/
        db/
          prisma.ts      # lazy PrismaClient with pg adapter
        env.ts           # loads .env before any imports
        google.auth.ts   # Google service account JWT auth
        google.erp.worker.ts  # PDF gen + email + Sheets export
        main.ts
  infra/
    docker-compose.yml   # postgres + redis
  .env.example
  README.md
```

---

## Modules

### API-side (apps/api)
- `auth`: register/login/refresh/logout
- `tenancy`: resolves tenant via `X-Tenant-Id` header or subdomain
- `rbac`: per-tenant roles + permissions guard
- `audit`: interceptor logs mutating requests
- `inventory`: products, stock movements, FIFO cost layers
- `purchasing`: suppliers, purchase orders (approve/receive)
- `sales`: customers, invoices, payments
- `accounting`: chart of accounts, journal entries/lines
- `reports`: inventory valuation, sales summary
- `integrations/google`: enqueue exports
- `jobs`: BullMQ queue producer

### Worker-side (apps/worker)
- Connects to Postgres via Prisma (using `@prisma/adapter-pg`)
- Processes BullMQ jobs:
    - `invoice.send` — generate PDF in-memory + send via Gmail SMTP
    - `inventory.export` — update Google Sheets inventory report
- Idempotency checks prevent duplicate emails/exports on retries

---

## Multi-Tenancy

Tenant isolation is enforced by:

- A `tenantId` column on all business entities
- Tenant resolved per request via:
    - `X-Tenant-Id` header (dev/test)
    - subdomain on `Host` header (production): `acme.yourapp.com` → slug `acme`

---

## Auth & Security

### JWT Access + Refresh Sessions
- Access tokens are standard JWTs (`Authorization: Bearer <token>`)
- Refresh tokens are random values stored in `Session` table
- Refresh rotates the token in DB (invalidates the old one)

### Worker Secret (optional)
Internal endpoints can be gated by `X-Worker-Secret` for extra hardening.

---

## RBAC (Roles & Permissions)

RBAC is tenant-scoped:

- `Role` belongs to a `tenantId`
- `Permission` is global (e.g. `inventory.write`)
- `RolePermission` ties role ↔ permission
- `UserTenant` ties user ↔ tenant and assigns a role

Example permission keys:
- `inventory.read`, `inventory.write`
- `sales.read`, `sales.write`
- `purchasing.read`, `purchasing.write`
- `reports.read`
- `audit.read`

---

## Audit Logging

Mutating requests are automatically logged via `AuditInterceptor`:

- HTTP method (POST/PUT/PATCH/DELETE)
- URL entity path
- actorId (from JWT)
- tenantId (from request)

Stored in `AuditLog` table.

---

## Inventory

Inventory is event-sourced:

- `Product` is the catalog
- `StockMovement` records IN/OUT/ADJUST events
- Stock level is computed from movements
- FIFO valuation uses cost layers created at PO receipt

---

## Purchasing

1. Create `Supplier`
2. Create `PurchaseOrder` with `PurchaseOrderLine`s
3. Approve PO
4. Receive PO:
    - adds `StockMovement IN` per line
    - creates FIFO `InventoryCostLayer` per line
    - marks PO `RECEIVED`

---

## Sales

1. Create `Customer`
2. Create `Invoice` (DRAFT) with line items
3. Mark invoice **SENT**:
    - creates `StockMovement OUT` per product line
    - consumes FIFO layers and records `CogsEntry` rows
    - enqueues `invoice.send` job
4. Worker processes job:
    - generates PDF in-memory with pdfkit
    - emails PDF to customer via Gmail SMTP
5. Create `Payment`:
    - posts double-entry journal entry (Cash/AR)
    - auto-marks invoice `PAID` when paid >= total

---

## FIFO Valuation & COGS

### FIFO Cost Layers
- Created at PO receipt time
- Stored in `InventoryCostLayer` with `remainingQty` and `unitCost`
- Consumed oldest-first when processing stock OUT on invoicing

### COGS
- Each consumption creates `CogsEntry` rows
- Used for gross profit reporting

---

## Accounting (Double-Entry)

Models:
- `Account` (chart of accounts, seeded on tenant creation)
- `JournalEntry` (transaction header)
- `JournalLine` (debit/credit lines using `Decimal`)

Example: invoice payment
- Debit **Cash** (1000)
- Credit **Accounts Receivable** (1100)

---

## Google Workspace Integrations

### What it does
| Feature | Implementation |
|---------|---------------|
| Invoice PDF | Generated in-memory with **pdfkit** |
| Invoice email | Sent via **Gmail SMTP** (nodemailer + App Password) |
| Inventory export | Written to **Google Sheets** via service account |

### Google Service Account Setup
The worker uses a Google service account for Sheets access only. No domain-wide delegation or impersonation is required.

1. Create a service account in [Google Cloud Console](https://console.cloud.google.com)
2. Download the JSON key file
3. Extract `client_email` and `private_key` into `.env`
4. Share any target Sheets with the service account email

### Gmail Setup (for invoice email)
Since the worker uses a personal Gmail account via SMTP App Password:

1. Enable 2-Step Verification on your Google account
2. Go to Google Account → Security → App passwords
3. Generate a password for "Mail"
4. Add `GMAIL_USER` and `GMAIL_APP_PASSWORD` to `.env`

> **Note:** Gmail App Passwords work with personal Gmail accounts. Domain-wide delegation (Gmail API) requires Google Workspace.

---

## Background Jobs

Queues: `google`

| Job | Trigger | What it does |
|-----|---------|-------------|
| `invoice.send` | Mark invoice SENT | Generate PDF → email to customer |
| `inventory.export` | Manual/scheduled | Write inventory to Google Sheets |

All jobs have:
- Automatic retries with exponential backoff
- Idempotency checks (won't re-send already-sent invoices)

---

## Reports

- `GET /reports/inventory/valuation` — total inventory value (FIFO remaining layers)
- `GET /reports/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` — revenue, COGS, gross profit

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 1. Start Postgres + Redis
```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2. Install dependencies
```bash
pnpm install
```

### 3. Set up environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Copy .env to each app (required for Prisma and runtime)
```bash
cp .env apps/api/.env
cp .env apps/worker/.env
```

### 5. Run migrations
```bash
cd apps/api
pnpm prisma:migrate
pnpm prisma:generate
```

---

## Environment Variables

```env
# App
NODE_ENV=development
API_PORT=4000

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/erp

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_ACCESS_SECRET=change_me
JWT_REFRESH_SECRET=change_me
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=14d

# Gmail SMTP (for invoice emails)
GMAIL_USER=yourname@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

# Google Service Account (for Sheets export)
GOOGLE_CLIENT_EMAIL=your-sa@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Optional
WORKER_SECRET=change_me
```

---

## Database Migrations

From `apps/api`:
```bash
pnpm prisma:migrate        # run migrations
pnpm prisma:generate       # regenerate Prisma client
pnpm prisma:studio         # open Prisma Studio
```

The worker generates its Prisma client from the same schema:
```bash
cd apps/worker
pnpm prisma:generate       # uses --schema ../api/prisma/schema.prisma
```

---

## Run the System

### Terminal 1 — Infra
```bash
docker compose -f infra/docker-compose.yml up -d
```

### Terminal 2 — API
```bash
cd apps/api
pnpm dev
```

### Terminal 3 — Worker
```bash
cd apps/worker
pnpm dev
```

---

## Quick API Walkthrough (curl)

### 1) Register (creates user + tenant + Admin role)
```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@acme.com",
    "password": "Passw0rd!!",
    "fullName": "Acme Admin",
    "tenantName": "Acme Ltd",
    "tenantSlug": "acme"
  }'
```

Copy `tenant.id` → `TENANT_ID` and `tokens.accessToken` → `TOKEN`:
```bash
export TENANT_ID="<tenant_uuid>"
export TOKEN="<access_token>"
```

### 2) Create product
```bash
curl -X POST http://localhost:4000/inventory/products \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sku":"SKU-001","name":"Mouse","price":15}'
```

### 3) Create customer
```bash
curl -X POST http://localhost:4000/sales/customers \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Jane Doe","email":"jane@example.com"}'
```

### 4) Purchasing: supplier → PO → approve → receive
```bash
# Create supplier
curl -X POST http://localhost:4000/purchasing/suppliers \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Supplier Inc","email":"supplier@example.com"}'

# Create PO
curl -X POST http://localhost:4000/purchasing/pos \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "supplierId": "<supplier_id>",
    "lines": [{"productId":"<product_id>","name":"Mouse","qty":10,"unitCost":8}]
  }'

# Approve
curl -X POST http://localhost:4000/purchasing/pos/<po_id>/approve \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"

# Receive (creates StockMovement IN + FIFO cost layer)
curl -X POST http://localhost:4000/purchasing/pos/<po_id>/receive \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### 5) Create invoice (DRAFT)
```bash
curl -X POST http://localhost:4000/sales/invoices \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "customerId": "<customer_id>",
    "lines": [{"productId":"<product_id>","name":"Mouse","qty":2,"unitPrice":15}]
  }'
```

### 6) Mark invoice SENT
```bash
curl -X POST http://localhost:4000/sales/invoices/<invoice_id>/sent \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Worker will:
- Generate invoice PDF in-memory (pdfkit)
- Email PDF to customer via Gmail SMTP

### 7) Record payment
```bash
curl -X POST http://localhost:4000/sales/payments \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"invoiceId":"<invoice_id>","amount":30,"method":"mpesa"}'
```

### 8) Reports
```bash
curl http://localhost:4000/reports/inventory/valuation \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"

curl "http://localhost:4000/reports/sales/summary?from=2026-01-01&to=2026-12-31" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Scheduling Nightly Exports

Trigger a nightly inventory export to Google Sheets:

```bash
curl -X POST http://localhost:4000/google/inventory/schedule-nightly \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Deployment Notes

### Recommended topology
- `api` behind a load balancer
- `worker` as a separate service (scale independently)
- `postgres` managed (RDS / Cloud SQL)
- `redis` managed (Elasticache / MemoryStore)

### Tenant routing
- Subdomains: `tenantSlug.yourdomain.com`
- Preserve `Host` header through your proxy

### Secrets
- Store Google private key in a secret manager (GCP Secret Manager, AWS Secrets Manager)
- Rotate JWT secrets periodically
- Never commit `.env` to version control

### Idempotency
- Invoice email: checked via `invoiceEmailSentAt`
- Inventory export: checked via `inventoryLastExportedAt` (skips if exported within 2 minutes)

---

## Troubleshooting

### "Missing X-Tenant-Id header"
Provide the `X-Tenant-Id` header on all business requests, or configure subdomain routing.

### Gmail send fails
- Verify `GMAIL_USER` and `GMAIL_APP_PASSWORD` are set correctly
- App Password must be generated from Google Account → Security → 2-Step Verification → App passwords
- App Passwords only work if 2FA is enabled

### Google Sheets export fails
- Verify `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` are correct
- Ensure the service account has access to the target spreadsheet (share it with the service account email)

### Worker not processing jobs
- Confirm Redis is running: `docker ps`
- Confirm worker is running and connected to the same `REDIS_URL`
- Check worker logs for job failure details

### Prisma client errors
- Ensure both apps have `.env` copied locally (Prisma reads from the nearest `.env`)
- Re-run `pnpm prisma:generate` after any schema changes
- For Prisma v7: `@prisma/adapter-pg` is required — do not use bare `new PrismaClient()`

---

## Roadmap

- Swagger/OpenAPI docs + request/response schemas
- Multi-tenant rate limiting and per-tenant quotas
- Invoices: taxes, discounts, payment terms, numbering sequences
- Accounting: AR/AP aging, trial balance, financial statements
- Inventory: multi-warehouse, transfers, serial/batch tracking
- Observability: structured logging, tracing, metrics dashboards
- CI/CD: automated migrations, Docker builds, blue/green deploys

---

## License

MIT
