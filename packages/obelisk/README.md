# @obelisk-ai/obelisk

<p align="center">
  <img src="https://img.shields.io/badge/version-1.17.15-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/bun-1.3.14-fbbf24?style=flat-square&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
</p>

**The obelisk CLI** -- the entry point for the obelisk AI-powered development tool. It provides a full-featured command-line interface, a terminal UI (TUI), built-in MCP server management, a plugin system, session management, and 40+ subcommands for AI-assisted development workflows.

---

## Features

- **Interactive AI Sessions** -- Run `obelisk` to start an interactive agent session with LLM-powered code generation, file editing, shell execution, and tool usage.
- **Terminal UI** -- Rich TUI powered by [OpenTUI](https://github.com/opentui) with tabs, keymaps, themes, and workspace management.
- **Multi-Provider** -- Native support for 20+ LLM providers (Anthropic, OpenAI, Google, AWS Bedrock, Azure, Groq, Mistral, Perplexity, xAI, and more).
- **MCP Server** -- Built-in Model Context Protocol server for tool-augmented agent interactions.
- **Plugin System** -- Extend obelisk with custom tools, providers, auth hooks, and UI components via the plugin API.
- **Session Management** -- Persistent sessions with history, snapshots, branching, and export/import.
- **Git Integration** -- Automatic worktree management, PR creation, commit hooks, and repository-aware context.
- **Agent Client Protocol** -- ACP support for interoperable agent-to-agent communication.
- **Self-Upgrade** -- Built-in `obelisk upgrade` and `obelisk uninstall` commands.

## Quick Start

```bash
# Install the CLI
bun add -g obelisk

# Start an interactive session
obelisk

# Run a one-shot prompt
obelisk run "explain this codebase to me"

# List available providers
obelisk providers

# Install a plugin
obelisk plugin add @obelisk-ai/plugin-github
```

## Commands

| Command | Description |
|---------|-------------|
| `obelisk` | Default interactive session (alias for `run`) |
| `obelisk run <prompt>` | Start an interactive or one-shot session |
| `obelisk attach` | Attach to an existing session |
| `obelisk tui` | Launch the terminal UI |
| `obelisk serve` | Start the HTTP API server |
| `obelisk web` | Launch the web UI |
| `obelisk mcp` | Manage MCP servers (add, remove, list, start) |
| `obelisk plugin` / `plug` | Manage plugins (install, remove, list) |
| `obelisk provider` | Manage LLM providers |
| `obelisk agent` | Manage agent configurations |
| `obelisk config` | View and edit configuration |
| `obelisk session` | List, inspect, and manage sessions |
| `obelisk models` | List available models |
| `obelisk generate` | Generate code from a prompt |
| `obelisk github` | GitHub integration |
| `obelisk pr` | Pull request management |
| `obelisk export` / `import` | Export/import sessions |
| `obelisk memory` | Memory management |
| `obelisk search` / `index` | Semantic search and indexing |
| `obelisk worktree` / `task` | Worktree and task management |
| `obelisk upgrade` | Self-upgrade |
| `obelisk uninstall` | Self-uninstall |
| `obelisk doctor` | Diagnostics and health check |
| `obelisk completion` | Generate shell completion scripts |
| `obelisk debug` | Debug subcommands |
| `obelisk stats` | Usage statistics |
| `obelisk budget` / `policy` | Budget and policy management |
| `obelisk nexus` | Nexus memory operations |
| `obelisk acp` | Agent Client Protocol |

## Architecture

The obelisk CLI is the top-level application in a layered monorepo:

```
obelisk (CLI + TUI + Server)
  |
  |-- @obelisk-ai/core     -- Runtime engine, session lifecycle, tool system, config, providers
  |-- @obelisk-ai/plugin   -- Plugin SDK (v1 + v2 Effect/Promise APIs)
  |-- @obelisk-ai/sdk      -- Shared SDK types
  |-- @obelisk-ai/schema   -- Schema definitions
  |-- @obelisk-ai/protocol -- Wire protocol definitions
  |-- @obelisk-ai/tui      -- TUI component library
  |-- @obelisk-ai/server   -- HTTP server
  |-- @obelisk-ai/llm      -- LLM abstraction layer
  |-- @obelisk-ai/codemode -- Code mode integrations
```

## Configuration

Obelisk loads configuration from `obelisk.config.jsonc` (or `.json`, `.json5`, `.yaml`, `.toml`) in the project root. Global options:

```bash
obelisk --print-logs        # Stream logs to stdout
obelisk --log-level debug   # Set log level
obelisk --pure              # Disable interactive features
```

## Plugin System

Obelisk supports two generations of plugin APIs:

- **v1 (callback-based)** -- Simple `Plugin(hooks) => Hooks` pattern for tools, auth, providers, and event hooks.
- **v2 (Effect/Promise)** -- Next-generation plugin system with typed domain hooks, transform/reload lifecycle, and Effect-ts or async/await APIs.

```ts
// v2 Promise plugin example
import { define } from "@obelisk-ai/plugin/v2/promise"

export const Plugin = define({
  id: "my-plugin",
  setup: async (ctx) => {
    await ctx.catalog.transform((catalog) => {
      catalog.provider.update("my-provider", (p) => {
        p.name = "My Custom Provider"
      })
    })
  },
})
```

See [@obelisk-ai/plugin](https://github.com/dylmarriner/obelisk-cli/tree/main/packages/plugin) for full documentation.

## Links

- [Core Runtime (`@obelisk-ai/core`)](../core/README.md)
- [Plugin SDK (`@obelisk-ai/plugin`)](../plugin/README.md)
- [SDK (`@obelisk-ai/sdk`)](../sdk/README.md)
- [Contributing](../../CONTRIBUTING.md)
- [Code of Conduct](../../CODE_OF_CONDUCT.md)
- [License](../../LICENSE)

## License

MIT