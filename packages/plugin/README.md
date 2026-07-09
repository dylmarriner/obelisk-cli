# @obelisk-ai/plugin

<p align="center">
  <img src="https://img.shields.io/npm/v/@obelisk-ai/plugin?style=flat-square" alt="npm version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/effect-4.0.0--beta.83-8b5cf6?style=flat-square" alt="Effect" />
  <img src="https://img.shields.io/badge/zod-4.1-3068b7?style=flat-square" alt="Zod" />
</p>

**The obelisk plugin SDK** -- defines the `Plugin`, `Hooks`, and `ToolDefinition` type contracts that enable extensibility across the obelisk ecosystem. Supports two generations of plugin APIs: a classic v1 callback-based API, and a next-generation v2 API with Effect-ts and Promise variants.

---

## Features

- **Two Plugin Generations** -- v1 for simple callback-based hooks, v2 for typed domain hooks with transform/reload lifecycle.
- **Tool Registration** -- Register custom tools with Zod schema validation and typed execution context.
- **Auth Hooks** -- OAuth and API key provider integrations.
- **Provider Hooks** -- Register custom LLM model providers.
- **Event Hooks** -- Intercept messages, modify LLM params, wrap tool execution, augment shell environment.
- **TUI Plugins** -- Extend the terminal UI with custom routes, keymaps, dialogs, sidebars, and themes.
- **Effect-ts API** -- v2 Effect plugin API with structured concurrency, resource safety, and scoped registrations.
- **Promise API** -- v2 Promise plugin API for async/await-based plugin development.
- **Transform/Reload** -- Stateful domain hooks that rebuild on registration changes.

## Quick Start

```bash
bun add @obelisk-ai/plugin
```

### v1 Plugin (callback-based)

```ts
import type { Plugin } from "@obelisk-ai/plugin"

const myPlugin: Plugin = (input) => {
  return {
    tool: {
      echo: {
        description: "Echo back a message",
        args: { message: String },
        execute: async ({ message }) => `Echo: ${message}`,
      },
    },
    dispose: async () => {
      console.log("Plugin cleaned up")
    },
  }
}

export default { server: myPlugin }
```

### v2 Promise Plugin

```ts
import { define } from "@obelisk-ai/plugin/v2/promise"

export const Plugin = define({
  id: "my-plugin",
  setup: async (ctx) => {
    // Register a transform hook on the catalog
    await ctx.catalog.transform((catalog) => {
      catalog.provider.update("my-provider", (p) => {
        p.name = "My Custom Provider"
      })
    })

    // Register a runtime hook on AI SDK
    await ctx.aisdk.sdk(async (event) => {
      if (event.package !== "@ai-sdk/my-provider") return
      const mod = await import("@ai-sdk/my-provider")
      event.sdk = mod.createProvider(event.options)
    })
  },
})
```

### v2 Effect Plugin

```ts
import { define } from "@obelisk-ai/plugin/v2/effect"
import { Effect } from "effect"

export const Plugin = define({
  id: "my-plugin",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update("my-provider", (p) => {
        p.name = "My Custom Provider"
      })
    })
  }),
})
```

## API Overview

### v1 Plugin API

The original plugin system. A plugin is a function `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`.

| Hook | Type | Description |
|------|------|-------------|
| `tool` | `Record<string, ToolDefinition>` | Register custom tools |
| `auth` | `AuthHook` | OAuth or API key auth provider |
| `provider` | `ProviderHook` | Model provider registration |
| `chat.message` | `(msg) => void` | Intercept chat messages |
| `chat.params` | `(params) => void` | Modify LLM request parameters |
| `chat.headers` | `(headers) => void` | Modify LLM request headers |
| `permission.ask` | `(req) => PermissionResult` | Intercept permission requests |
| `tool.execute.before` | `(ctx) => void` | Pre-execution hook |
| `tool.execute.after` | `(ctx, result) => void` | Post-execution hook |
| `shell.env` | `() => Record<string, string>` | Augment shell environment |
| `command.execute.before` | `(cmd) => void` | Pre-command hook |
| `dispose` | `() => Promise<void>` | Cleanup on unload |

### v2 Plugin API

The next-generation plugin system provides two variants (Effect and Promise) with identical domain surfaces.

**PluginContext domains:**

| Domain | Description |
|--------|-------------|
| `agent` | Agent configuration hooks (transform, reload) |
| `catalog` | Provider/model catalog hooks (transform, reload) |
| `command` | Command definition hooks (transform, reload) |
| `integration` | Integration hooks (OAuth, API key, env methods) |
| `reference` | Reference hooks (transform, reload) |
| `skill` | Skill hooks (transform, reload) |
| `aisdk` | Runtime hooks (sdk, language) |
| `plugin` | Plugin domain (add, remove) |
| `event` | Event stream subscription |
| `filesystem` | File read, list, find, glob |
| `location` | Directory and project location |
| `npm` | NPM package operations |
| `path` | System paths (home, data, cache, config, state, temp) |

### Tool API

```ts
import { tool } from "@obelisk-ai/plugin/tool"
import { z } from "zod"

const myTool = tool({
  description: "Search documentation",
  args: z.object({
    query: z.string(),
    limit: z.number().optional(),
  }),
  execute: async (args, ctx) => {
    // ctx: ToolContext with sessionID, directory, worktree, abort signal
    return `Search results for: ${args.query}`
  },
})
```

### TUI Plugin API

```ts
import type { TuiPlugin } from "@obelisk-ai/plugin/tui"

const plugin: TuiPlugin = (api, options, meta) => {
  api.route.add({
    path: "/my-plugin",
    component: () => <div>Hello from plugin</div>,
  })

  api.keymap.bind("ctrl+p", "/my-plugin")
}
```

TUI plugins get access to: app info, routes, keymaps, themes, UI components (Dialog, Toast, Prompt, Slot), reactive state, attention/notifications, the event bus, and a key-value store.

## Exports

| Path | Description |
|------|-------------|
| `@obelisk-ai/plugin` | v1 Plugin API (Plugin, Hooks, Config, PluginInput) |
| `@obelisk-ai/plugin/tool` | Tool definition helper (`tool()`, ToolContext, ToolDefinition) |
| `@obelisk-ai/plugin/tui` | TUI Plugin API (TuiPlugin, TuiPluginApi, TUI types) |
| `@obelisk-ai/plugin/v2/effect` | v2 Effect plugin API (define, PluginContext, domains) |
| `@obelisk-ai/plugin/v2/effect/integration` | v2 Effect integration hooks |
| `@obelisk-ai/plugin/v2/effect/plugin` | v2 Effect plugin domain |
| `@obelisk-ai/plugin/v2/promise` | v2 Promise plugin API (define, PluginContext, domains) |

## Loading

Plugins are loaded from the obelisk configuration (`obelisk.config.jsonc`):

```jsonc
{
  "plugin": [
    {
      "package": "@my-org/audit-plugin",
      "config": {
        "endpoint": "https://audit.example.com"
      }
    }
  ]
}
```

Or installed via the CLI:

```bash
obelisk plugin add @my-org/audit-plugin
```

## Links

- [v2 Effect Plugin API](src/v2/effect/README.md)
- [v2 Promise Plugin API](src/v2/promise/README.md)
- [CLI (`obelisk`)](../obelisk/README.md)
- [Core Runtime (`@obelisk-ai/core`)](../core/README.md)
- [Contributing](../../CONTRIBUTING.md)
- [License](../../LICENSE)

## License

MIT