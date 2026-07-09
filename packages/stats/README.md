# @obelisk-ai/stats

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Private](https://img.shields.io/badge/status-private-red.svg)]()
[![SolidStart](https://img.shields.io/badge/framework-SolidStart-2c4f7c.svg)]()
[![Effect](https://img.shields.io/badge/Effect-4.0.0--beta.83-8B5CF6)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)()

Statistics and analytics platform for Obelisk AI. Tracks usage metrics, token consumption, model costs, and generates rich visual reports with geographic breakdowns.

---

## Features

- **Usage Analytics** -- Track sessions, requests, unique users, and token consumption across all dimensions
- **Cost Tracking** -- Per-model and per-provider cost analysis with input/output/reasoning/cache token breakdown
- **Geographic Breakdown** -- World map visualization of usage by country with continent rollups
- **Market Share Analysis** -- Provider and model market share with ranking and trend lines
- **Caching Insights** -- Cache hit ratios and cache read token analysis
- **Multi-Language** -- 19 locales with full i18n support
- **Automated Sync** -- Scheduled Athena-to-database sync pipeline running on 1-hour intervals
- **Real-Time Ingestion** -- Firehose-based event ingestion for low-latency data pipeline

---

## Quick Start

```bash
# Development
bun run dev:stats

# Type-check individual packages
bun run --cwd packages/stats/core typecheck
bun run --cwd packages/stats/app typecheck
bun run --cwd packages/stats/server typecheck

# Database migrations
bun run --cwd packages/stats/core db:generate
bun run --cwd packages/stats/core db:push
```

---

## Architecture

The stats package is organized as a monorepo with three sub-packages:

```
packages/stats/
├── core/          # Effect services, domain logic, database schema, Athena client
├── server/        # HTTP ingest API + scheduled stat sync daemon
└── app/           # SolidStart frontend website
```

### Data Flow

```
┌───────────┐    ┌──────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ Inference  │───▶│ Firehose │───▶│  S3 Data  │───▶│  Athena   │───▶│ Planetscale│
│ Events     │    │ (Ingest) │    │   Lake    │    │ (Queries) │    │  (MySQL)  │
└───────────┘    └──────────┘    └───────────┘    └───────────┘    └─────┬─────┘
                                                                        │
                                                                        ▼
                                                                 ┌───────────┐
                                                                 │ SolidStart │
                                                                 │   Site    │
                                                                 │ (SSR + d3)│
                                                                 └───────────┘
```

### Core (`core/`)

The `@obelisk-ai/stats-core` package provides all shared services and domain logic:

| Module | Description |
|---|---|
| `Athena` | Effect service wrapping AWS SDK Athena client. Runs SQL queries, polls for completion, paginates results. |
| `Database` | Drizzle ORM setup with Planetscale MySQL connection. Provides migration runner. |
| `Database/schema` | Three stat tables: `model_stat`, `provider_stat`, `geo_stat` |
| `Domain/stat` | Core types (`StatGrain`, `StatBaseAggregate`, `StatBaseRow`) and utility functions |
| `Domain/inference` | Athena SQL query builder and aggregate conversion for model/provider/geo dimensions |
| `Domain/model` | `ModelStatRepo` -- per-model stat aggregation and storage |
| `Domain/provider` | `ProviderStatRepo` -- per-provider stat aggregation with market share |
| `Domain/geo` | `GeoStatRepo` -- per-country stat aggregation with continent mapping |
| `Domain/home` | Stats home page data model: usage points, leaderboards, market share, token costs, cache ratios, session costs, country breakdowns |
| `Domain/model-normalization` | Model name normalization rules, author mapping, retired model/provider resolution |
| `StatSync` | Athena-to-Database sync pipeline with configurable lag and start date |
| `Runtime` | Effect layer composition with `ManagedRuntime` |

### Server (`server/`)

The `@obelisk-ai/stats-server` package provides:

- **HTTP Ingest API** -- `POST /` accepts `{ events: [...] }`, authorized via Bearer token, writes to Firehose
- **Health Checks** -- `/health` and `/ready` endpoints with graceful shutdown
- **Stat Sync Daemon** -- Runs `syncStats()` on a 1-hour schedule
- **Concurrency Control** -- Semaphore-limited (max 8) concurrent ingest requests

### App (`app/`)

The `@obelisk-ai/stats-app` package is a SolidStart SSR website with:

| Route | Description |
|---|---|
| `/` | Home page with stacked usage charts, leaderboard, session cost, token cost, cache ratio, market share, d3 world map |
| `/[lab]` | Lab/provider detail page with hero, overview metrics, usage chart, model table |
| `/[lab]/[model]` | Individual model detail page with specs, momentum chart, usage/users/efficiency, geo breakdown, peers |
| `/stats/api/health` | API health endpoint |
| `/stats/api/newsletter` | Newsletter subscription via EmailOctopus |

---

## Database Schema

Three MySQL tables are defined via Drizzle ORM, all sharing common column patterns:

| Table | Unique Index | Dimensions |
|---|---|---|
| `model_stat` | `(grain, period_key, dataset, tier, client, source, provider, model)` | Per-model aggregates |
| `provider_stat` | `(grain, period_key, dataset, tier, client, source, provider)` | Per-provider aggregates |
| `geo_stat` | `(grain, period_key, dataset, tier, client, source, provider, model, country)` | Per-country aggregates |

Each table tracks metrics: `sessions`, `requests`, `unique_users`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `cache_read_tokens`, `total_tokens`, `costs`, and duration/TTFB/TPS percentiles.

---

## Model Normalization

The normalization system maps raw model names to canonical forms:

- **Author mapping** -- `"claude"` -> `"anthropic"`, `"gpt"` -> `"openai"`, `"qwen"` -> `"qwen"`, etc.
- **Suffix stripping** -- Removes `-free` and `:global` suffixes
- **Retired models** -- Configurable sets for excluded and retired model/provider names
- **Route-model patterns** -- Handles special routing patterns like `big-pickle`

---

## Project Structure

```
packages/stats/
├── core/
│   ├── src/
│   │   ├── index.ts               # Namespaced re-exports
│   │   ├── athena.ts              # AWS Athena query client
│   │   ├── config.ts              # App configuration
│   │   ├── database.ts            # Drizzle + Planetscale setup
│   │   ├── database/schema.ts     # MySQL table definitions
│   │   ├── domain/
│   │   │   ├── stat.ts            # Core stat types and utilities
│   │   │   ├── inference.ts       # Athena query builder
│   │   │   ├── model.ts           # Model stat repository
│   │   │   ├── provider.ts        # Provider stat repository
│   │   │   ├── geo.ts             # Geo stat repository
│   │   │   ├── home.ts            # Home page data model
│   │   │   └── model-normalization.ts  # Model name normalization
│   │   ├── stat-sync.ts           # Sync pipeline
│   │   └── runtime.ts             # Effect layer composition
│   └── drizzle/                   # Migration files
├── server/
│   └── src/
│       ├── server.ts              # HTTP server
│       ├── router.ts              # Route definitions
│       ├── ingest.ts              # Firehose ingestion
│       ├── stat-sync.ts           # Scheduled sync daemon
│       └── shutdown.ts            # Graceful shutdown
└── app/
    └── src/
        ├── app.tsx                # Root component
        ├── routes/                # File-based routes
        └── i18n/                  # 19 locale files
```