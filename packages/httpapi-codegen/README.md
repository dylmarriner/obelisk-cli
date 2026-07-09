# @obelisk-ai/httpapi-codegen

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Private](https://img.shields.io/badge/status-private-red.svg)]()
[![Effect](https://img.shields.io/badge/Effect-4.0.0--beta.83-8B5CF6)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)]()

Build-time source generation for domain-oriented Promise and Effect APIs derived directly from `HttpApi` and Effect Schema contracts. Generates type-safe, production-ready TypeScript client SDKs from a single authoritative API definition.

---

## Features

- **Three-Phase Pipeline** -- Pure `compile()`, independent `emit*()` phases, and `write()` for clean separation of concerns
- **Dual Emitters** -- Generate either a rich Effect client (decoded values, runtime schemas) or a zero-Effect Promise client (plain `fetch`, no runtime)
- **Portable Output** -- Self-contained modules per `HttpApiGroup` with no external runtime dependencies
- **Stale File Management** -- Tracks generated files in a manifest (`.httpapi-codegen.json`) for clean regeneration
- **Prettier Formatting** -- All output is formatted with Prettier before writing
- **Compile-Time Safety** -- Rejects ambiguous contracts (duplicate fields, multiple success types, unsupported transformations)

---

## Quick Start

```bash
# Install
bun add @obelisk-ai/httpapi-codegen

# Run tests
bun --filter @obelisk-ai/httpapi-codegen test

# Type-check
bun --filter @obelisk-ai/httpapi-codegen typecheck
```

### Basic Usage

```typescript
import { compile, emitEffect, write } from "@obelisk-ai/httpapi-codegen"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

// 1. Compile an HttpApi into a shared contract
const contract = compile(MyApi)

// 2. Emit a portable Effect client
const output = emitEffect(contract)

// 3. Write to disk (formats with Prettier, manages stale files)
Effect.runPromise(
  write(output, "./generated").pipe(Effect.provide(FileSystem.layer))
)
```

### All-in-One

```typescript
import { generate } from "@obelisk-ai/httpapi-codegen"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

Effect.runPromise(
  generate(MyApi, { directory: "./generated" }).pipe(
    Effect.provide(FileSystem.layer)
  )
)
```

---

## API Reference

### `compile(api, options?)`

Reflects an `HttpApi` into a shared `Contract`. Pure, synchronous.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `api` | `HttpApi` | -- | The API to reflect |
| `options.groupNames` | `string[]` | all | Filter to specific groups |
| `options.endpointNames` | `string[]` | all | Filter to specific endpoints |
| `options.omitEndpoints` | `string[]` | `[]` | Endpoints to exclude |

Returns: `Contract` -- an intermediate representation with `{ groups: Group[] }`.

### `emitEffect(contract)`

Emits a portable Effect-native client. Requires all schemas to be portable.

**Output files:**
- `{group}.ts` -- One module per `HttpApiGroup` with group definition and adapter
- `client-error.ts` -- `ClientError` class (Schema.TaggedError)
- `client.ts` -- `make(options?)` factory using `HttpApiClient`
- `index.ts` -- Barrel re-export

### `emitEffectImported(contract, options)`

Emits an Effect client that imports an authoritative API by module+api, module+group, or module+endpoint projection.

### `emitPromise(contract, options?)`

Emits a zero-Effect Promise client using direct `fetch`. No runtime structural validation.

**Output files:**
- `types.ts` -- Structural wire types for all inputs, outputs, and errors
- `client-error.ts` -- `ClientError` class with `ClientErrorReason` union
- `client.ts` -- `make(options)` factory with `fetch`-based client
- `index.ts` -- Barrel re-export

### `write(output, directory)`

Effect that writes generated files to disk.

| Parameter | Type | Description |
|---|---|---|
| `output` | `Output` | Result from `emit*()` |
| `directory` | `string` | Output directory |

Manages `.httpapi-codegen.json` manifest to track owned files and remove stale ones on regeneration.

### `generate(api, { directory })`

All-in-one: `compile()` -> `emitEffect()` -> `write()`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│              Three-Phase Pipeline                        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Phase 1: compile(Api)                             │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Reflects HttpApi into a shared Contract      │  │  │
│  │  │  - Pure, synchronous                          │  │  │
│  │  │  - Schema-aware reflection                    │  │  │
│  │  │  - Rejects ambiguous contracts                │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                           │                               │
│                           ▼                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Phase 2: emit*(contract)                         │  │
│  │  ┌──────────────────┐  ┌────────────────────────┐  │  │
│  │  │  emitEffect()    │  │  emitPromise()         │  │  │
│  │  │  - Effect-native │  │  - Plain fetch         │  │  │
│  │  │  - Decoded types │  │  - Structural types    │  │  │
│  │  │  - Runtime       │  │  - No Effect runtime   │  │  │
│  │  │    validation    │  │  - No validation       │  │  │
│  │  └──────────────────┘  └────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                           │                               │
│                           ▼                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Phase 3: write(output, directory)                 │  │
│  │  - Prettier formatting                            │  │
│  │  - Manifest management (.httpapi-codegen.json)     │  │
│  │  - Stale file removal                             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Design Rules

| Rule | Description |
|---|---|
| **Input flattening** | Path, query, header, and payload fields are merged into one input object per endpoint |
| **Duplicate rejection** | Endpoints with duplicate field names across input channels are rejected at compile time |
| **Zero-field endpoints** | No argument emitted for zero fields; optional object when all fields are optional |
| **Success envelope unwrapping** | Exact `{ data: A }` success envelopes are unwrapped to `A` |
| **No-content** | `NoContent` status maps to `void` |
| **Streaming** | SSE streams return as `Stream` (Effect) or `AsyncIterable` (Promise) |
| **Error mapping** | Transport, unexpected-status, and decoding errors map to a single `ClientError` |
| **Portability** | Each generated group module is self-contained and portable |
| **Reviewability** | Generated source is committed for review; CI regenerates and fails on worktree changes |

---

## Generated Client Example

### Effect Client

```typescript
// Generated: client.ts
import { HttpApiClient } from "@effect/platform"
import * as Session from "./session.js"

export const make = (options?: { baseUrl?: string }) => {
  const client = HttpApiClient.make(MyApi, options)
  return {
    session: {
      health: Session.health(client),
      list: Session.list(client),
      get: Session.get(client),
      interrupt: Session.interrupt(client),
    },
    event: {
      subscribe: Event.subscribe(client),
    },
  }
}
```

### Promise Client

```typescript
// Generated: client.ts
export const make = (options?: { baseUrl?: string }) => {
  const base = options?.baseUrl ?? ""
  return {
    session: {
      health: () => fetch(`${base}/health`).then(r => r.json()),
      list: (query?: { limit?: number }) =>
        fetch(`${base}/session?${queryParams(query)}`).then(r => r.json()),
      // ...
    },
  }
}
```

---

## Testing

The package uses synthetic `HttpApi` fixtures (no real Obelisk Core dependency):

```bash
bun --filter @obelisk-ai/httpapi-codegen test
```

The test suite covers:
- `compile()` with group/endpoint filtering
- `emitEffect()` and `emitPromise()` output correctness
- `write()` file I/O and manifest management
- Generated consumer type-checking (the `generated-consumer.ts` file imports the generated output)
- Import boundary validation

---

## Project Structure

```
packages/httpapi-codegen/
├── src/
│   └── index.ts                   # Main source (compile, emit*, write, generate)
├── test/
│   ├── fixture.ts                 # Synthetic HttpApi fixture
│   ├── effect.ts                  # Test helpers
│   ├── generate.test.ts           # Compile/emit tests
│   ├── write.test.ts              # File I/O tests
│   ├── generated-consumer.ts      # Type-check consumer
│   └── generated/                 # Test-generated output
├── package.json
└── tsconfig.json
```