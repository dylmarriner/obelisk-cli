# @obelisk-ai/core

<p align="center">
  <img src="https://img.shields.io/npm/v/@obelisk-ai/core?style=flat-square" alt="npm version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/effect-4.0.0--beta.83-8b5cf6?style=flat-square" alt="Effect" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-drizzle-2277cc?style=flat-square" alt="Drizzle ORM" />
</p>

**The obelisk runtime core** -- a composable, Effect-ts-powered library that provides the agent runtime, tool system, configuration schemas, session lifecycle management, and LLM provider integrations. This package is the engine behind the obelisk CLI and can be embedded in custom applications.

---

## Features

- **Agent Runtime** -- Full lifecycle for AI agent sessions: prompt construction, LLM interaction, tool execution, message streaming, and compaction.
- **Tool System** -- Built-in tools for file I/O, shell execution, code search (ripgrep), web fetching, glob matching, and more. Custom tool registration via the plugin system.
- **Session Management** -- Persistent sessions with SQLite storage, message history, snapshots, branching, and the ability to attach/replay.
- **LLM Providers** -- 30+ provider implementations via the AI SDK ecosystem: Anthropic, OpenAI, Google, AWS Bedrock, Azure, Groq, Mistral, Perplexity, xAI, Together AI, Cerebras, DeepInfra, OpenRouter, and more.
- **Configuration** -- JSON Schema-backed configuration with file-based loading, migration, and sub-config modules for providers, plugins, MCP servers, and more.
- **Plugin System Host** -- Load and manage plugins (v1 and v2), including provider hooks, tool definitions, auth integrations, and event listeners.
- **Effect-ts Foundation** -- Built on Effect-ts for structured concurrency, dependency injection, error handling, and observability.
- **Observability** -- Structured logging, OTLP tracing, and OpenTelemetry integration.
- **Cross-Platform** -- Bun and Node.js runtimes supported via conditional imports for SQLite, PTY, and filesystem operations.

## Quick Start

```bash
bun add @obelisk-ai/core
```

```ts
import { Config } from "@obelisk-ai/core/config"
import { SessionV2 } from "@obelisk-ai/core/session"

// Load configuration
const config = await Config.load()

// Create and run a session
const session = await SessionV2.create({
  config,
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
})

for await (const event of session.run("explain this project")) {
  console.log(event)
}
```

## API Overview

### Session Management

```ts
import { SessionV2 } from "@obelisk-ai/core/session"
```

The session module handles the full lifecycle: creation, message handling, LLM interaction, tool execution, compaction, history, and persistence. Sessions are stored in a SQLite database and support snapshots, branching, and replay.

### Configuration

```ts
import { Config } from "@obelisk-ai/core/config"
```

Config is loaded from `obelisk.config.jsonc` (or `.json`, `.json5`, `.yaml`, `.toml`) with automatic migration from v1 schemas. Sub-config modules cover: agent behavior, attachments, commands, compaction, experimental features, formatting, LSP, MCP servers, markdown rendering, plugins, providers, references, tool output, and file watchers.

### Tool System

```ts
import { ToolRegistry } from "@obelisk-ai/core/tool"
```

The tool registry manages built-in and plugin-registered tools:

| Tool | Description |
|------|-------------|
| `bash` | Shell command execution with sandboxing |
| `read` | Read files from the filesystem |
| `write` | Write/create files |
| `edit` | Surgical text replacement in files |
| `grep` | Regular expression search (ripgrep) |
| `glob` | File pattern matching |
| `web_fetch` | Fetch and process web content |
| `web_search` | Web search via Tavily/Exa |
| `skill` | Skill invocation |
| `todo` | Task list management |
| `question` | Interactive user questions |
| `apply_patch` | Patch file application |
| `tool_output` | Store and retrieve tool outputs |

### LLM Providers

```ts
import { ProviderCatalog } from "@obelisk-ai/core/provider"
```

30+ providers are available through the AI SDK integration layer. Providers are resolved via the catalog and can be customized, overridden, or extended by plugins.

### Plugin System

```ts
import { PluginV2 } from "@obelisk-ai/core/plugin"
```

The core hosts the plugin runtime, loading plugins from configuration and managing their lifecycle. Plugins can register hooks across all domains: agent, catalog, command, integration, reference, and skill.

### Event System

```ts
import { EventBus } from "@obelisk-ai/core/event"
```

Typed event bus for session events, tool execution events, plugin events, and lifecycle events.

### Permission System

```ts
import { Permission } from "@obelisk-ai/core/permission"
```

Granular permission model for tool execution, shell commands, file access, and network requests. Supports saved rules and policy-based approval.

## Architecture

```
@obelisk-ai/core
  |
  |-- session/         -- Session lifecycle, runner, messages, store,
  |                       compaction, prompts, context epochs
  |-- tool/            -- Tool registry, definition, materialization,
  |                       built-in tools (bash, file, grep, web, etc.)
  |-- config/          -- Configuration loading, JSON Schema, flags,
  |                       sub-config modules
  |-- plugin/          -- Plugin host (v1 + v2), 30+ provider impls
  |-- provider/        -- Provider catalog and model resolution
  |-- event/           -- Typed event bus
  |-- permission/      -- Permission system and policy engine
  |-- database/        -- SQLite database setup, migrations (30+)
  |-- effect/          -- Effect-ts utilities, layer composition
  |-- filesystem/      -- File operations, watchers, ignore patterns
  |-- pty/             -- PTY management (Bun/Node conditional)
  |-- system-context/  -- System prompt context and builtins
  |-- skill/           -- Skill discovery and guidance
  |-- observability/   -- Structured logging, OTLP tracing
  |-- v1/              -- Backward compatibility layer
  |-- util/            -- Shared utilities
```

## Session Runner

The `SessionRunner` is the main execution loop. Each drain processes one provider turn:

```
load session --> resolve model --> materialize tools --> build request
  --> stream LLM --> settle tools --> repeat
```

## Exports

The package uses wildcard export mapping. Import specific modules:

```ts
import { ... } from "@obelisk-ai/core/config"
import { ... } from "@obelisk-ai/core/session"
import { ... } from "@obelisk-ai/core/tool"
import { ... } from "@obelisk-ai/core/plugin"
import { ... } from "@obelisk-ai/core/provider"
import { ... } from "@obelisk-ai/core/event"
import { ... } from "@obelisk-ai/core/permission"
import { ... } from "@obelisk-ai/core/session/runner"
import { ... } from "@obelisk-ai/core/system-context"
import { ... } from "@obelisk-ai/core/effect/layer-node"
import { ... } from "@obelisk-ai/core/effect/app-node"
```

## Links

- [CLI (`obelisk`)](../obelisk/README.md)
- [Plugin SDK (`@obelisk-ai/plugin`)](../plugin/README.md)
- [SDK (`@obelisk-ai/sdk`)](../sdk/README.md)
- [Contributing](../../CONTRIBUTING.md)
- [License](../../LICENSE)

## License

MIT