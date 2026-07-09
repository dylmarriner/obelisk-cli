# @obelisk-ai/enterprise

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Private](https://img.shields.io/badge/status-private-red.svg)]()
[![SolidStart](https://img.shields.io/badge/framework-SolidStart-2c4f7c.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)]()

The **Enterprise** package is a hosted sharing platform for Obelisk AI coding sessions. It provides a secure, SSO-integrated web application for sharing, reviewing, and collaborating on AI session transcripts with full audit trail and compliance support.

---

## Features

- **Session Sharing** -- Create, sync, and retrieve publicly shareable snapshots of AI coding sessions
- **SSO / SAML / SCIM** -- Enterprise-grade authentication and identity provider integration
- **Team Management** -- Role-based access controls for team-based collaboration
- **Audit Logging** -- Full audit trail of all share operations with immutable storage
- **Compliance** -- Supports SOC 2, GDPR, and data retention policies out of the box
- **OpenAPI Documentation** -- Auto-generated API documentation via Hono OpenAPI
- **Cloudflare Native** -- Deploys to Cloudflare Workers for global edge delivery

---

## Quick Start

```bash
# Install dependencies (from monorepo root)
bun install

# Start the development server (port 3002)
bun --filter @obelisk-ai/enterprise dev

# Type-check
bun --filter @obelisk-ai/enterprise typecheck

# Build for production
bun --filter @obelisk-ai/enterprise build

# Build for Cloudflare Workers
OBELISK_DEPLOYMENT_TARGET=cloudflare bun --filter @obelisk-ai/enterprise build:cloudflare
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OBELISK_STORAGE_BUCKET` | Yes | S3 or R2 bucket name for share storage |
| `OBELISK_STORAGE_REGION` | Yes | AWS region (e.g., `us-east-1`) |
| `OBELISK_STORAGE_ACCESS_KEY_ID` | Yes | Storage access key |
| `OBELISK_STORAGE_SECRET_ACCESS_KEY` | Yes | Storage secret key |
| `OBELISK_STORAGE_ACCOUNT_ID` | R2 only | Cloudflare R2 account ID |
| `OBELISK_STORAGE_ADAPTER` | No | `"s3"` or `"r2"` (default: `"s3"`) |
| `OBELISK_BASE_URL` | No | Custom base URL for the deployment |
| `SUPPORT_API_KEY` | Yes | Bearer token for admin share removal |

---

## API Endpoints

All routes are mounted under `/api` and served by a Hono server with CORS enabled.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/doc` | Auto-generated OpenAPI documentation page |
| `POST` | `/api/share` | Create a share from a `sessionID` |
| `POST` | `/api/share/:shareID/sync` | Sync data to an existing share |
| `GET` | `/api/share/:shareID/data` | Retrieve share data (cached) |
| `DELETE` | `/api/share/:shareID` | Remove a share (requires `secret`) |
| `DELETE` | `/api/support/actions/remove-share` | Admin-only share removal (requires `SUPPORT_API_KEY`) |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Enterprise App                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  SolidStart SSR (SolidJS + @solidjs/start)      │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │ │
│  │  │  Routes   │  │  API     │  │  Share View   │  │ │
│  │  │ (File)    │  │ (Hono)   │  │  (Session     │  │ │
│  │  │           │  │          │  │   Turn/Review)│  │ │
│  │  └──────────┘  └──────────┘  └───────────────┘  │ │
│  └─────────────────────────────────────────────────┘ │
│                           │                           │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Core Services                                   │ │
│  │  ┌────────────┐  ┌───────────────┐              │ │
│  │  │  Share     │  │  Storage      │              │ │
│  │  │  (Lifecycle│  │  (S3 / R2     │              │ │
│  │  │   Mgmt)    │  │   Adapter)    │              │ │
│  │  └────────────┘  └───────────────┘              │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Key Modules

- **`src/core/share.ts`** -- `Share` namespace managing the full lifecycle of session shares (create, get, sync, data retrieval, remove). Supports snapshot compaction and legacy event migration.
- **`src/core/storage.ts`** -- `Storage` namespace with an adapter interface abstracting over S3 and Cloudflare R2. Supports read, write, remove, list, and atomic read-modify-write updates.
- **`src/routes/api/[...path].ts`** -- Hono REST API with OpenAPI documentation, CORS, and all share endpoints.
- **`src/routes/share/[shareID].tsx`** -- Session share view page rendering conversation turns, file diffs, and model metadata with responsive layout.

### Data Model

Shares store a snapshot of AI session data as a discriminated union of five types:

- `session` -- Session metadata
- `message` -- User/AI message content
- `part` -- Individual message parts (text, tool calls, etc.)
- `session_diff` -- File diffs associated with the session
- `model` -- Model/provider information

Data is compacted into a single JSON snapshot file (`share_snapshot/{shareID}.json`) with deduplication by key.

---

## Storage Backends

The storage layer supports two backends selected via the `OBELISK_STORAGE_ADAPTER` environment variable:

- **S3** -- Standard AWS S3-compatible object storage
- **R2** -- Cloudflare R2 with reduced egress costs

Both use `aws4fetch` for signed request authentication.

---

## Deployment

Deployed via **SST** (Serverless Stack) with Cloudflare Workers as the primary target:

```bash
# Deploy to production
bun --filter @obelisk-ai/enterprise shell-prod

# Build for Cloudflare
OBELISK_DEPLOYMENT_TARGET=cloudflare bun --filter @obelisk-ai/enterprise build:cloudflare
```

The Nitro engine is configured with `cloudflare-module` preset and `nodeCompat: true` for maximum compatibility.

---

## Project Structure

```
packages/enterprise/
├── src/
│   ├── app.tsx                  # Root application component
│   ├── entry-client.tsx         # Client hydration entry
│   ├── entry-server.tsx         # SSR entry (locale detection)
│   ├── core/
│   │   ├── share.ts             # Share lifecycle management
│   │   └── storage.ts           # S3/R2 storage adapter
│   └── routes/
│       ├── index.tsx            # Home page
│       ├── share.tsx            # Share layout wrapper
│       ├── share/[shareID].tsx  # Session share view
│       ├── api/[...path].ts     # Hono REST API
│       └── [...404].tsx         # Catch-all 404
├── test/
│   ├── core/share.test.ts       # Share unit tests
│   └── core/storage.test.ts     # Storage unit tests
├── public/                      # Static assets (favicons, icons)
└── vite.config.ts               # Vite + SolidStart + Nitro config
```