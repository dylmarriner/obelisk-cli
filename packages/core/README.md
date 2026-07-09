# @obelisk-ai/core

<p align="left">
  <a href="https://www.npmjs.com/package/@obelisk-ai/core"><img src="https://img.shields.io/npm/v/@obelisk-ai/core" alt="npm version"></a>
  <a href="https://github.com/dylmarriner/obelisk-cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

Core runtime package for Obelisk CLI. Provides the agent runtime, tool system, config schemas, session lifecycle, and session runner.

## Installation

```bash
bun add @obelisk-ai/core
```

## Architecture

The core package is organized into these subsystems:

| Module | Purpose |
|--------|---------|
| `session/` | Session lifecycle, runner, history, compaction, context epochs |
| `tool/` | Tool definition, registry, materialization, built-in tools |
| `config/` | Config schemas, flags, permissions |
| `effect/` | Effect runtime utilities, layer composition |
| `util/` | Shared utilities (filesystem, npm, flock, etc.) |

## Key Concepts

### Session Runner

The `SessionRunner` is the main execution loop. Each session drain processes one provider turn at a time:

```text
load session → resolve model → materialize tools → build request → stream LLM → settle tools → repeat
```

### Tool System

Tools are defined using `Tool.make({ description, input, output, execute })` and registered via `Tools.Service`.

### Config Schema

Configuration is defined using Effect Schema with strict validation of top-level keys.

## Usage

```typescript
import { ToolRegistry } from "@obelisk-ai/core/tool/registry"
import { Tool } from "@obelisk-ai/core/tool/tool"
import { Schema } from "effect"

const MyTool = Tool.make({
  description: "Example tool",
  input: Schema.String,
  output: Schema.String,
  execute: (input) => Effect.succeed(`Hello, ${input}!`),
})
```

## License

MIT