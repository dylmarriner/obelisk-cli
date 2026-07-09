# @obelisk-ai/http-recorder

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-1.17.15-blue)]()
[![Effect](https://img.shields.io/badge/Effect-4.0.0--beta.83-8B5CF6)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)]()

Record and replay Effect HTTP client traffic with deterministic cassettes. Enables reliable, offline testing of HTTP-dependent code without mocking or hitting real services.

---

## Features

- **Deterministic Replay** -- Record real HTTP interactions once, replay them identically forever
- **Cassette-Based** -- Portable JSON cassette files that are commit-friendly and reviewable
- **Sequential Matching** -- Strict sequential interaction matching correctly models retries, polling, and idempotent sequences
- **Redaction Engine** -- Built-in header, URL, body, and JSON field redaction with secret detection
- **CI-Safe Mode** -- `CI=true` forces replay mode; missing cassettes fail fast instead of hitting real services
- **WebSocket Support** -- Record and replay WebSocket sessions alongside HTTP interactions
- **Effect-Native** -- Integrates seamlessly with Effect's `HttpClient`, `Socket`, `Layer`, and `Scope`

---

## Quick Start

```bash
# Install
bun add @obelisk-ai/http-recorder

# Record HTTP traffic
# Run your tests with CI=false to record new cassettes
CI=false bun test

# Replay (CI mode -- fails if cassette is missing)
CI=true bun test
```

### Basic Usage

```typescript
import { HttpRecorder } from "@obelisk-ai/http-recorder"
import { HttpClient } from "@effect/platform"
import { Layer, Effect } from "effect"

// Wrap your HTTP client with a recorder layer
const TestLayer = Layer.provide(
  HttpClient.layer,
  HttpRecorder.http("my-api", {
    directory: "./test/recordings",
  })
)

// Use the recorded client -- first run records, subsequent runs replay
const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://api.example.com/health")
  return yield* response.text
})

Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
```

---

## API Reference

### `HttpRecorder.http(name, options?)`

Creates a `Layer<HttpClient>` that records or replays HTTP traffic.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | -- | Unique cassette name (used as filename) |
| `options.directory` | `string` | `"./recordings"` | Directory for cassette files |
| `options.metadata` | `Record<string, unknown>` | `{}` | Custom metadata stored in the cassette |
| `options.redact` | `RedactOptions` | (defaults) | Redaction configuration |
| `options.match` | `RequestMatcher` | `defaultMatcher` | Custom request matching function |
| `options.mode` | `"auto" \| "record" \| "replay"` | `"auto"` | Force recording or replay mode |

### `HttpRecorder.socket(name, options?)`

Creates a `Layer<Socket.Socket>` that records or replays WebSocket traffic. Same options as `http()`.

### `RedactOptions`

```typescript
type RedactOptions = {
  headers?: {
    allow?: string[]       // Headers to keep as-is
    redact?: string[]      // Headers to redact (value -> "[REDACTED]")
  }
  query?: {
    allow?: string[]       // Query params to keep as-is
    redact?: string[]      // Query params to redact
  }
  jsonFields?: {
    allow?: string[]       // JSON fields to keep as-is
    redact?: string[]      // JSON fields to redact
  }
  url?: (url: string) => string  // Custom URL transform
}
```

---

## Cassette Format

Cassettes are JSON files stored on disk, one per named interaction:

```json
{
  "version": 1,
  "metadata": {
    "name": "my-api",
    "recordedAt": "2026-07-09T12:00:00.000Z"
  },
  "interactions": [
    {
      "transport": "http",
      "request": {
        "method": "POST",
        "url": "https://api.example.com/echo",
        "headers": { "content-type": "application/json" },
        "body": "{\"hello\":\"world\"}"
      },
      "response": {
        "status": 200,
        "headers": { "content-type": "application/json" },
        "body": "{\"reply\":\"ok\"}"
      }
    }
  ]
}
```

WebSocket cassettes use `transport: "websocket"` with `open` + `events[]` instead of request/response pairs.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    HttpRecorder                           │
│                                                          │
│  ┌──────────┐   ┌───────────┐   ┌────────────────────┐  │
│  │ Recorder │   │ Cassette  │   │     Matcher        │  │
│  │ (Mode    │──▶│ Service   │──▶│ (Sequential /      │  │
│  │  Resolve)│   │ (FS/Mem)  │   │  Custom)           │  │
│  └──────────┘   └───────────┘   └────────────────────┘  │
│       │               │                   │              │
│       ▼               ▼                   ▼              │
│  ┌──────────┐   ┌───────────┐   ┌────────────────────┐  │
│  │ Redactor │   │  Schema   │   │   Diff Diagnostics │  │
│  │ (Headers │   │ Validator │   │   (Mismatch        │  │
│  │  /URL/   │   │           │   │    Reporting)      │  │
│  │  Body)   │   │           │   │                    │  │
│  └──────────┘   └───────────┘   └────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Mode Resolution

The recorder operates in three modes:

| Mode | Description |
|---|---|
| `auto` (default) | Replay if cassette exists, record if missing. `CI=true` forces replay-only. |
| `record` | Always record, overwriting existing cassettes (use with caution). |
| `replay` | Always replay. Fails with `CassetteNotFoundError` if cassette is missing. |

### Security: Secret Detection

Before writing any cassette, the recorder scans all interaction data for:

- Bearer tokens and authorization headers
- API keys and access tokens
- AWS credential patterns
- Private key signatures
- Environment variable values

If secrets are detected, the cassette write fails with `UnsafeCassetteError` rather than persisting sensitive data. This is a defense-in-depth layer -- redaction should be configured first.

---

## Testing Best Practices

1. **Commit cassettes to version control** -- Cassette changes are reviewable and provide a record of API behavior over time
2. **Never overwrite cassettes in place** -- Delete the cassette file and rerun to refresh; changes are explicit in git diff
3. **Configure redaction early** -- Add `redact` options before recording to avoid committing sensitive data
4. **Use CI mode in pipelines** -- Set `CI=true` in CI/CD to ensure tests use recorded data and fail fast if cassettes are missing
5. **Name cassettes meaningfully** -- Use descriptive names tied to the test scenario (e.g., `"user-login-success"`, `"rate-limit-error"`)

---

## Project Structure

```
packages/http-recorder/
├── src/
│   ├── index.ts              # Public API: HttpRecorder = { http, socket }
│   ├── internal.ts           # Internal re-exports
│   ├── types.ts              # TypeScript types and interfaces
│   ├── schema.ts             # Effect Schema definitions
│   ├── cassette.ts           # Cassette persistence (FS + memory)
│   ├── recorder.ts           # Mode resolution + replay state machine
│   ├── effect.ts             # HTTP recorder Layer
│   ├── socket.ts             # WebSocket recorder Layer
│   ├── internal-effect.ts    # Core recording/replay logic
│   ├── matching.ts           # Request matching and diff diagnostics
│   ├── redactor.ts           # Redactor composition
│   ├── redaction.ts          # Low-level redaction + secret detection
│   └── websocket.ts          # WebSocket executor
├── test/
│   ├── record-replay.test.ts # Integration test suite
│   └── fixtures/recordings/  # Test cassette fixtures
└── script/
    ├── build.ts              # Build script
    ├── pack.ts               # Pack script
    └── verify-package.ts     # Package verification
```