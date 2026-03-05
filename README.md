# Workspace ERP (Google Workspace–Integrated, Multi-Tenant ERP) — Backend + Worker

A production-style, multi-tenant ERP backend built in **TypeScript** with **NestJS**, **PostgreSQL**, **Prisma**, **Redis/BullMQ**, and deep **Google Workspace** integrations (**Drive, Docs, Gmail, Sheets**).  
Designed as a **portfolio-grade senior project**: clean modular architecture, tenant isolation, RBAC, audit logging, background processing, and real accounting/inventory flows.

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
- ✅ **Multi-tenant architecture** with strict tenant scoping (`tenantId` on all business tables)
- ✅ **JWT auth** (access tokens) + **refresh tokens** stored as DB sessions
- ✅ **RBAC** (roles + permissions) enforced per tenant
- ✅ **Audit logging** for mutating requests (POST/PUT/PATCH/DELETE)
- ✅ **Background jobs** with retries/backoff using **BullMQ**
- ✅ **Worker service** that processes async jobs and integrates with Google Workspace

### ERP Modules
- ✅ CRM: **Customers**
- ✅ Inventory: **Products**, **Stock Movements**, stock levels
- ✅ Purchasing: **Suppliers**, **Purchase Orders**, approve/receive
- ✅ Sales: **Invoices**, invoice lines, mark SENT/PAID
- ✅ Accounting: **Double-entry ledger** (Chart of Accounts, Journal Entries/Lines)
- ✅ FIFO inventory valuation + COGS on sales

### Google Workspace Integrations
- ✅ Create tenant Drive folder automatically
- ✅ Generate invoices from a **Google Docs template** and export to **PDF**
- ✅ Send invoice emails via **Gmail API** (supports PDF attachments)
- ✅ Export inventory report to **Google Sheets**
- ✅ Optional Drive sharing of invoice PDFs to customer email (configurable)

---

## Architecture

This repo uses a clean split:

- **API (NestJS)**: synchronous business actions + data validation + RBAC + enqueues jobs
- **Worker**: async processing (Google Workspace tasks, exports) with retries and idempotency

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
           | Drive/Docs/Gmail/Sheets     |
           +-----------------------------+
```

---

## Tech Stack

- **TypeScript**
- **NestJS** (API framework)
- **PostgreSQL** (source of truth)
- **Prisma** (schema/migrations, typed data access)
- **Redis + BullMQ** (queues, background jobs)
- **Google APIs** via `googleapis`:
  - Drive API
  - Docs API
  - Gmail API
  - Sheets API
- **Docker Compose** for local Postgres + Redis

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
          google/         # Drive/Docs/Gmail/Sheets integration
        jobs/            # BullMQ queue enqueueing
      prisma/
        schema.prisma    # single source schema
    worker/              # BullMQ processors + Google actions + DB access (Prisma)
      src/
        db/
        google*.ts
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
- `tenancy`: resolves tenant via `X-Tenant-Id` or subdomain
- `rbac`: per-tenant roles + permissions
- `audit`: interceptor logs mutating requests
- `inventory`: products, stock movements, FIFO cost layers
- `purchasing`: suppliers, purchase orders (approve/receive)
- `sales`: customers, invoices, payments
- `accounting`: chart of accounts, journal entries/lines
- `reports`: inventory valuation, sales summary
- `integrations/google`: enqueue exports, Google template processing support
- `jobs`: BullMQ queue producer

### Worker-side (apps/worker)
- Connects to Postgres via Prisma
- Processes BullMQ jobs:
  - `invoice.send`
  - `inventory.export`
- Runs Google Drive/Docs/Gmail/Sheets operations
- Uses idempotency checks to avoid duplicates on retries

---

## Multi-Tenancy

Tenant isolation is enforced by:

- A `tenantId` column on all business entities
- Tenant resolved per request using:
  - `X-Tenant-Id` header (**dev/test**), OR
  - subdomain on `Host` header (**production**): `acme.yourapp.com` → tenant slug `acme`

> Recommendation: in production, prefer subdomains for clean tenant routing and remove `X-Tenant-Id` from public clients.

---

## Auth & Security

### JWT Access + Refresh Sessions
- Access tokens are standard JWTs (`Authorization: Bearer <token>`)
- Refresh tokens are strong random values stored in `Session` table
- Refresh rotates the token in DB (invalidates old token)

### Worker Secret (optional hardening)
Some endpoints can be gated by `X-Worker-Secret` to reduce blast radius.

---

## RBAC (Roles & Permissions)

RBAC is tenant-scoped:

- `Role` belongs to a `tenantId`
- `Permission` is global (`key` string like `inventory.write`)
- `RolePermission` ties role ↔ permission
- `UserTenant` ties user ↔ tenant and assigns a role

Examples:
- `inventory.read`, `inventory.write`
- `sales.read`, `sales.write`
- `purchasing.read`, `purchasing.write`
- `reports.read`
- `audit.read`

---

## Audit Logging

Mutating requests are automatically logged:

- method: POST/PUT/PATCH/DELETE
- entity (derived from controller)
- actorId
- metadata (path, body keys)

Stored in `AuditLog`.

---

## Inventory

Inventory is event-based:

- `Product` is the catalog
- `StockMovement` records IN/OUT/ADJUST
- Stock level can be computed from movements
- FIFO valuation uses **cost layers** created from PO receipts

---

## Purchasing

Purchasing flow:

1. Create `Supplier`
2. Create `PurchaseOrder` with `PurchaseOrderLine`s
3. Approve PO
4. Receive PO:
   - adds `StockMovement IN` for each line
   - adds FIFO `InventoryCostLayer` per received line
   - marks PO `RECEIVED`

---

## Sales

Sales flow:

1. Create `Customer`
2. Create `Invoice` (DRAFT) with line items
3. Mark invoice **SENT**:
   - creates `StockMovement OUT` for product lines
   - consumes FIFO layers and records `CogsEntry`
   - enqueues Google job to generate & send invoice
4. Create `Payment`:
   - posts a double-entry journal entry (Cash/AR)
   - auto-marks invoice `PAID` once paid >= total

---

## FIFO Valuation & COGS

### FIFO Cost Layers
- Created at stock receipt time (PO receiving)
- Stored in `InventoryCostLayer` with `remainingQty` and `unitCost`
- Consumed oldest-first when invoicing stock OUT

### COGS
- Each consumption creates `CogsEntry` rows
- Used for reports and gross profit calculations

---

## Accounting (Double-Entry)

Models:
- `Account` (chart of accounts)
- `JournalEntry` (header)
- `JournalLine` (debit/credit lines)

Example: invoice payment
- Debit **Cash** (1000)
- Credit **Accounts Receivable** (1100)

> This is the foundation for a full accounting engine (GL balances, trial balance, etc.).

---

## Google Workspace Integrations

### What it does
- Creates a Drive folder per tenant (persisted in `Tenant.googleDriveFolderId`)
- Copies a **Google Docs invoice template** per invoice
- Replaces placeholders and exports as PDF
- Uploads PDF to tenant folder (persisted in `Invoice.drivePdfFileId`)
- Emails invoice via Gmail (optionally with PDF attachment)
- Exports inventory report to Sheets (persisted in `Tenant.inventorySheetId`)

### Invoice Template Placeholders
Create a Google Doc template and include these placeholders exactly:

```
INVOICE
Invoice ID: {{INVOICE_ID}}
Date: {{DATE}}
Status: {{STATUS}}

Bill To:
{{CUSTOMER_NAME}}
{{CUSTOMER_EMAIL}}

Items:
{{LINES}}

Total: {{TOTAL}}
```

Set `GOOGLE_INVOICE_TEMPLATE_DOC_ID` to the template file ID.

### Sharing Strategy
- Default: files remain within Workspace (org access policies apply)
- Optional: share invoice PDF to the customer email (`SHARE_INVOICE_PDF_WITH_CUSTOMER=true`)

---

## Background Jobs

Queues:
- `google`

Jobs:
- `invoice.send` — generate invoice PDF + email
- `inventory.export` — update tenant inventory sheet

Jobs use:
- retries
- exponential backoff
- idempotency checks (avoid duplicate emails/PDFs)

---

## Reports

Endpoints:
- `GET /reports/inventory/valuation` — total inventory valuation (FIFO remaining layers)
- `GET /reports/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` — revenue, COGS, gross profit

---

## Local Development Setup

### Prereqs
- Node.js 18+ (or 20+)
- pnpm 9+
- Docker + Docker Compose
- A Google Workspace environment (for full integration) with admin access if using domain-wide delegation

### Start Postgres + Redis
```bash
docker compose -f infra/docker-compose.yml up -d
```

### Install deps
From repo root:
```bash
pnpm -r install
```

---

## Environment Variables

Copy `.env.example` → `.env` and fill values.

Core:
- `API_PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`

Google:
- `GOOGLE_PROJECT_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (use `\n` for newlines)
- `GOOGLE_IMPERSONATE_USER_EMAIL`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` (optional)
- `GOOGLE_INVOICE_TEMPLATE_DOC_ID`

Security flags:
- `WORKER_SECRET` (optional endpoint hardening)
- `SHARE_INVOICE_PDF_WITH_CUSTOMER=false|true`

---

## Database Migrations

From `apps/api`:
```bash
pnpm prisma:generate
pnpm prisma:migrate
```

> The worker generates Prisma client from the same schema using:
> `pnpm prisma:generate --schema ../api/prisma/schema.prisma`

---

## Run the System

### Terminal 1 — API
```bash
cd apps/api
pnpm dev
```

### Terminal 2 — Worker
```bash
cd apps/worker
pnpm dev
```

### Terminal 3 — Infra (if not running)
```bash
docker compose -f infra/docker-compose.yml up -d
```

---

## Quick API Walkthrough (curl)

### 1) Register (creates user + tenant + Admin role)
```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"admin@acme.com",
    "password":"Passw0rd!!",
    "fullName":"Acme Admin",
    "tenantName":"Acme Ltd",
    "tenantSlug":"acme"
  }'
```

Copy:
- `tenant.id` → `TENANT_ID`
- `tokens.accessToken` → `TOKEN`

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

### 4) Purchasing: supplier → PO → approve → receive (creates FIFO layers)
```bash
# supplier
curl -X POST http://localhost:4000/purchasing/suppliers \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Supplier Inc","email":"supplier@example.com"}'

# create PO (replace IDs)
curl -X POST http://localhost:4000/purchasing/pos \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "supplierId":"<supplier_id>",
    "lines":[{"productId":"<product_id>","name":"Mouse","qty":10,"unitCost":8}]
  }'

# approve
curl -X POST http://localhost:4000/purchasing/pos/<po_id>/approve \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"

# receive (adds stock IN + FIFO layer)
curl -X POST http://localhost:4000/purchasing/pos/<po_id>/receive \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### 5) Create invoice (DRAFT) referencing the product
```bash
curl -X POST http://localhost:4000/sales/invoices \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "customerId":"<customer_id>",
    "lines":[{"productId":"<product_id>","name":"Mouse","qty":2,"unitPrice":15}]
  }'
```

### 6) Mark invoice SENT (stock OUT + FIFO consume + enqueue Google send)
```bash
curl -X POST http://localhost:4000/sales/invoices/<invoice_id>/sent \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Worker will:
- generate Docs → PDF
- upload to Drive
- send Gmail (optionally attach PDF)

### 7) Record payment (posts journal entry and may mark PAID)
```bash
curl -X POST http://localhost:4000/sales/payments \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"invoiceId":"<invoice_id>","amount":30,"method":"mpesa"}'
```

### 8) Reports
```bash
curl -X GET http://localhost:4000/reports/inventory/valuation \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"

curl -X GET "http://localhost:4000/reports/sales/summary?from=2026-01-01&to=2026-12-31" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Scheduling Nightly Exports

Schedule nightly inventory export to Google Sheets:

```bash
curl -X POST http://localhost:4000/google/inventory/schedule-nightly \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

> You may want to restrict this endpoint to admin-only permissions.

---

## Deployment Notes

### Recommended production topology
- `api` (NestJS) behind a load balancer
- `worker` (BullMQ processors) as a separate service
- `postgres` managed (RDS/Cloud SQL)
- `redis` managed (Elasticache/MemoryStore)

### Tenant routing
- Use subdomains: `tenantSlug.yourdomain.com`
- Put tenant slug resolution behind a proxy that preserves `Host`

### Secrets
- Store Google keys in a secret manager (GCP Secret Manager, AWS Secrets Manager, etc.)
- Rotate JWT secrets periodically

### Idempotency
- Invoice generation checks `drivePdfFileId`
- Email send checks `invoiceEmailSentAt`
- Inventory export checks recent export timestamps

---

## Troubleshooting

### “Missing X-Tenant-Id header”
- Provide `X-Tenant-Id` in requests, or run behind a subdomain like `acme.localhost`.

### Google errors / permission issues
- Ensure your Workspace admin has approved scopes for domain-wide delegation
- Ensure `GOOGLE_IMPERSONATE_USER_EMAIL` is a real user in the Workspace
- Confirm the template doc ID is correct
- If sharing to external emails fails, it may be blocked by Workspace sharing policies

### Worker not processing jobs
- Confirm Redis is running: `docker ps`
- Confirm worker is running and connected to same `REDIS_URL`
- Check worker logs for job failures

### Prisma client mismatch
- Ensure `apps/worker` runs `pnpm prisma:generate --schema ../api/prisma/schema.prisma`

---

## Roadmap

Potential next upgrades to make this enterprise-grade:
- Swagger/OpenAPI docs + request/response schemas
- Multi-tenant rate limiting and per-tenant quotas
- Invoices: taxes, discounts, payment terms, numbering sequences
- Accounting: AR/AP aging, trial balance, financial statements
- Inventory: multi-warehouse, transfers, serial/batch tracking
- Google: templated PDF emails, customer portal, signed URLs
- Observability: structured logging, tracing, metrics dashboards
- CI/CD: automated migrations, docker builds, blue/green deploys

---

## License

MIT (or replace with your preferred license).
