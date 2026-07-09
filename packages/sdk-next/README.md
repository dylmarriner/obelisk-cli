# @obelisk-ai/sdk-next

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Private](https://img.shields.io/badge/status-private-red.svg)]()
[![Effect](https://img.shields.io/badge/Effect-4.0.0--beta.83-8B5CF6)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)]()

Effect-native embedded Obelisk host for in-process applications. The next-generation SDK that executes the entire Obelisk server in-memory -- no network listener, no subprocess, no I/O overhead.

---

## Features

- **Embedded Host** -- Runs the full Obelisk server HTTP router in-process with zero network I/O
- **Effect-Native** -- Built entirely on Effect for composable, type-safe, testable application code
- **Tool Registration** -- Register tools locally via `tools.register(...)` with shared application state
- **Session Management** -- Full session lifecycle: create, list, prompt, interrupt, stream events, switch models
- **Service Layer** -- Available as both a direct `create()` call and a dependency-injected `Layer` via `Obelisk.layer`
- **Drop-in Replacement** -- Same routing, middleware, handlers, codecs, and errors as the network client

---

## Quick Start

```bash
# Install
bun add @obelisk-ai/sdk-next

# Run tests
bun --filter @obelisk-ai/sdk-next test

# Type-check
bun --filter @obelisk-ai/sdk-next typecheck
```

### Basic Usage

```typescript
import { Obelisk, Tool } from "@obelisk-ai/sdk-next"
import { Effect } from "effect"

// Create an embedded host (no network, no subprocess)
const program = Effect.gen(function* () {
  const client = yield* Obelisk.create()

  // Register a tool
  yield* client.tools.register({
    "greet": Tool.make({
      description: "Greet a user",
      input: { name: Tool.String },
      handler: (args) => `Hello, ${args.name}!`,
    }),
  })

  // Create a session and prompt
  const session = yield* client.sessions.create("default")
  const response = yield* client.sessions.prompt(session.id, {
    text: "Say hello to Alice",
  })

  return response
})

Effect.runPromise(program)
```

### Using the Service Layer

```typescript
import { Obelisk } from "@obelisk-ai/sdk-next"
import { Layer, Effect, Context } from "effect"

// Provide the Obelisk service as a Layer
const Program = Effect.gen(function* () {
  const obelisk = yield* Obelisk.Service
  const session = yield* obelisk.sessions.create("default")
  // ...
})

Effect.runPromise(
  Program.pipe(Effect.provide(Obelisk.layer))
)
```

---

## API Reference

### `Obelisk.create()`

Creates an embedded Obelisk host. Returns an `Effect` that resolves to a client object with:

| Field | Type | Description |
|---|---|---|
| `sessions` | `SessionsApi` | Session CRUD, prompting, interrupts, events, model switching |
| `events` | `EventSubscription` | Subscribe to session events |
| `tools.register` | `(tools) => Effect<void>` | Register tools in the shared application registry |

### `Obelisk.Service`

A `Context.Tag` service for Effect-based dependency injection.

### `Obelisk.layer`

A `Layer` that provides `Obelisk.Service` via `Obelisk.create()`.

### `Tool.make(definition)`

Creates a tool definition with input schema and handler.

```typescript
Tool.make({
  description: "Calculate the sum of two numbers",
  input: {
    a: Tool.Number,
    b: Tool.Number,
  },
  handler: ({ a, b }) => a + b,
})
```

### `Tool.Failure`, `Tool.RegistrationError`

Error types for tool execution failures and registration conflicts.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Application Code                       │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │              Obelisk.create()                        ││
│  │                                                      ││
│  │  ┌──────────────────┐    ┌────────────────────────┐  ││
│  │  │  AppNodeBuilder   │    │  ApplicationTools      │  ││
│  │  │  (Core)           │    │  (Tool Registry)       │  ││
│  │  └────────┬─────────┘    └───────────┬────────────┘  ││
│  │           │                          │               ││
│  │           ▼                          ▼               ││
│  │  ┌──────────────────────────────────────────────┐    ││
│  │  │         In-Memory HTTP Router                │    ││
│  │  │  (HttpRouter.toWebHandler from @obelisk-ai/  │    ││
│  │  │   server)                                    │    ││
│  │  └──────────────────┬───────────────────────────┘    ││
│  │                     │                                ││
│  │                     ▼                                ││
│  │  ┌──────────────────────────────────────────────┐    ││
│  │  │         Fake fetch() Dispatch                │    ││
│  │  │  (FetchHttpClient.layer from @obelisk-ai/    │    ││
│  │  │   client)                                    │    ││
│  │  └──────────────────────────────────────────────┘    ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### How It Works

1. **`AppNodeBuilder`** composes the application graph from `ApplicationTools` (tool registry) and `PermissionSaved` (permission store) as LayerNodes.
2. **`HttpRouter.toWebHandler`** creates an in-memory Web handler from the server routes -- no network listener, no I/O.
3. The Web handler is wrapped in a `fetch`-like function that dispatches `Request` objects to the in-memory handler.
4. This fake `fetch` is provided to the Obelisk client via `FetchHttpClient.layer`, making everything look like a standard HTTP client internally.

The result: same routing, same middleware, same handlers, same codecs, same errors -- but everything runs in-process with zero network overhead.

---

## Exports

```typescript
import {
  Obelisk,    // { create, Interface, Service, layer }
  Tool,       // { make, Failure, RegistrationError, types }
  ClientError,
  // Re-exported types from @obelisk-ai/client/effect:
  AbsolutePath, Agent, Location, Model, Prompt, Provider,
  RelativePath, Session, SessionInput, SessionMessage,
  ObeliskEvent,  // (type-only)
} from "@obelisk-ai/sdk-next"
```

---

## Testing

```bash
bun --filter @obelisk-ai/sdk-next test
```

Test coverage includes:
- Full session CRUD lifecycle (create, get, list, active, prompt, context, events, interrupt, message)
- Tool registration and execution
- Event streaming from the embedded host
- Multi-host isolation (independent hosts don't share notifications)
- Layer-based DI via `Obelisk.layer`
- Bundle composition and import boundary validation

---

## Project Structure

```
packages/sdk-next/
├── src/
│   ├── index.ts          # Public API surface
│   ├── obelisk.ts        # Embedded host factory (create, Service, layer)
│   └── tool.ts           # Tool re-exports
├── test/
│   ├── embedded.test.ts  # Integration tests
│   └── import-boundaries.test.ts  # Bundle composition tests
├── package.json
└── tsconfig.json
```