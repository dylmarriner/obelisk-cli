# @obelisk-ai/plugin

<p align="left">
  <a href="https://www.npmjs.com/package/@obelisk-ai/plugin"><img src="https://img.shields.io/npm/v/@obelisk-ai/plugin" alt="npm version"></a>
  <a href="https://github.com/dylmarriner/obelisk-cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

Plugin system package for Obelisk CLI. Defines the `Plugin`, `Hooks`, and `ToolDefinition` type contracts that enable extensibility.

## Installation

```bash
bun add @obelisk-ai/plugin
```

## Plugin Interface

A plugin is a function that receives a `PluginInput` and returns a `Hooks` object:

```typescript
import type { Plugin, Hooks } from "@obelisk-ai/plugin"

const myPlugin: Plugin = (input) => {
  return {
    tool: {
      my_tool: {
        description: "My custom tool",
        args: { message: String },
        execute: async ({ message }) => `Echo: ${message}`,
      },
    },
  }
}
```

## Available Hooks

| Hook | Purpose |
|------|---------|
| `tool` | Register custom tools |
| `auth` | Provide auth providers (OAuth, API key) |
| `provider` | Add model providers |
| `chat.message()` | Intercept messages |
| `chat.params()` | Modify LLM parameters |
| `chat.headers()` | Modify LLM request headers |
| `permission.ask()` | Intercept permission requests |
| `tool.execute.before/after()` | Wrap tool execution |
| `shell.env()` | Augment shell environment |
| `dispose()` | Cleanup on unload |

## Loading

Plugins are loaded from `.obelisk/plugins/` or configured via `obelisk.jsonc`:

```jsonc
{
  "plugin": [{ "package": "@my-org/audit-plugin" }]
}
```

## License

MIT