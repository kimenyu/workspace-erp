# workspace-erp

Monorepo ERP platform built with NestJS, Prisma, and pnpm workspaces.

## Structure

```
apps/api       — NestJS REST API
apps/worker    — Background job processor
packages/shared — Shared types, constants, errors
infra/         — Docker Compose & DB init scripts
```

## Quick Start

```bash
cp .env.example .env
pnpm install
cd apps/api && pnpm prisma migrate dev
pnpm dev
```
