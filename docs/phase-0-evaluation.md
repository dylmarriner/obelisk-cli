# Phase 0 — Repo Evaluation Report

**Date:** 2026-07-09
**Project:** Obelisk CLI (fork of anomalyco/opencode)
**Evaluator:** AI agent

---

## 1. CLI Command Registration

**Framework:** Yargs v18.0.0

**Key files:**
- `packages/obelisk/src/index.ts` — Main entry point, registers all commands
- `packages/obelisk/src/cli/cmd/cmd.ts` — `cmd()` typed wrapper around `yargs.CommandModule`
- `packages/obelisk/src/cli/effect-cmd.ts` — `effectCmd()` Effect-native builder with InstanceContext lifecycle
- `packages/obelisk/src/cli/cmd/` — One file per command (run, serve, models, mcp, etc.)

**Pattern for adding commands:**
1. Create file in `packages/obelisk/src/cli/cmd/nexus.ts`
2. Use `effectCmd()` with `command`, `describe`, `builder`, `handler`
3. Set `instance: false` for commands that don't need project state
4. Import and `.command(NexusCommand)` in `index.ts`

**Status:** ✅ Ready for new commands (nexus, memory, search, ast, semantic, budget)

---

## 2. Config Loading System

**Formats:** JSON / JSONC (via `jsonc-parser`)

**File names:** `obelisk.jsonc`, `obelisk.json`, `config.json` (legacy)

**Resolution order** (lowest → highest priority):
1. Managed/platform config (`/etc/obelisk/`)
2. macOS MDM managed preferences
3. Global config (`~/.config/obelisk/`)
4. Remote config (well-known URLs)
5. `OBELISK_CONFIG` env var
6. Project config files (walking up from cwd)
7. `.obelisk/` directories (walking up from cwd)
8. `OBELISK_CONFIG_CONTENT` env var
9. `OBELISK_PERMISSION` env var

**Key files:**
- `packages/obelisk/src/config/config.ts` — Main orchestrator
- `packages/obelisk/src/config/paths.ts` — File discovery
- `packages/obelisk/src/config/parse.ts` — JSONC parsing + schema validation
- `packages/core/src/v1/config/config.ts` — ConfigV1 schema definition

**To add `obelisk.config.jsonc` support:**
- Add `"obelisk.config"` name to `ConfigPaths.files()` calls in `config.ts`
- Add to `tui-migrate.ts` and `mcp.ts` hardcoded lists

**Status:** ✅ Understood, schema is strict about unrecognized keys

---

## 3. Tool & Plugin System

### Tool System

**Core definition:** `Tool.make({ description, input, output, execute })` → `Tool.Definition`
**Registration:** `Tools.Service.register({ name: tool })` via `Layer.effectDiscard`
**Registry:** `ToolRegistry.Service` — scope-managed, supports stacked registrations
**Materialization:** `registry.materialize(permissions)` → `{ definitions, settle }`
**Built-in tools:** bash, read, glob, grep, edit, write, task, fetch, todo, search, skill, patch, question, lsp, plan, execute

**Key files:**
- `packages/core/src/tool/tool.ts` — Tool definition type
- `packages/core/src/tool/registry.ts` — Central registry
- `packages/core/src/tool/builtins.ts` — Built-in tool composition
- `packages/obelisk/src/tool/registry.ts` — Session-level tool registry

### Plugin System

**Type:** `Plugin = (input: PluginInput) => Promise<Hooks>`
**Hooks:** dispose, event, config, tool, auth, provider, chat.*, permission.*, command.*, tool.*, shell.*, experimental.*
**Loading:** Internal plugins (built-in auth) → External plugins (npm packages)
**Key files:**
- `packages/plugin/src/index.ts` — Plugin/Hooks types
- `packages/obelisk/src/plugin/index.ts` — Plugin.Service runtime
- `packages/obelisk/src/plugin/loader.ts` — PluginLoader (resolve → install → load)

### MCP Integration

**Service:** `MCP.Service` — connect/disconnect, tool/resource discovery, OAuth
**Connection types:** Local (stdio) and Remote (StreamableHTTP / SSE)
**Tool conversion:** `McpCatalog.convertTool()` → AI SDK tool format
**Key files:**
- `packages/obelisk/src/mcp/index.ts` — MCP service
- `packages/obelisk/src/mcp/catalog.ts` — Tool conversion
- `packages/obelisk/src/mcp/auth.ts` — OAuth token storage

### Permission System

**Service:** `Permission.Service` — ask/reply/list
**Rules:** `allow` / `deny` / `ask` with wildcard matching
**Key files:**
- `packages/obelisk/src/permission/index.ts`

**Status:** ✅ Well-structured, plugin hooks provide clear insertion points

---

## 4. Model Provider Abstraction

**Architecture:** `@obelisk-ai/llm` package with `Route` composite

**Route = Protocol + Endpoint + Auth + Transport**
- **Protocol:** Body schema, streaming event parsing (openai-chat, anthropic-messages, gemini, etc.)
- **Endpoint:** URL construction
- **Auth:** API key, bearer token, OAuth
- **Transport:** HTTP SSE, WebSocket

**Provider definitions:** `packages/llm/src/providers/` — OpenAI, Anthropic, Google, Azure, Bedrock, OpenRouter, Cloudflare, xAI, and 8+ OpenAI-compatible profiles

**Model call pipeline:**
```
LLMRequest → Route.body.from() → Transport.frames() → Protocol.stream.step() → LLMEvent[]
```

**Key files:**
- `packages/llm/src/llm.ts` — High-level API (generate, stream)
- `packages/llm/src/route/client.ts` — LLMClient, compile(), prepare(), stream(), generate()
- `packages/llm/src/providers/` — Provider definitions
- `packages/llm/src/protocols/` — Wire format implementations
- `packages/obelisk/src/session/llm/` — Session integration

**Best Obelisk Core insertion point:** `compile()` in `packages/llm/src/route/client.ts` — single chokepoint for all model calls.

**Status:** ✅ Clean abstraction, clear insertion point for token/policy layer

---

## 5. Session Lifecycle

### V2 (Current, event-sourced)

```
Created → Input Admitted → Input Promoted → Runner Loop → Compaction → Completion
```

**Runner loop:** `SessionRunner.run()` — one provider turn per iteration, tool settlement, continuation detection, overflow recovery

**Key files:**
- `packages/core/src/session.ts` — Session service
- `packages/core/src/session/runner/llm.ts` — Main runner loop
- `packages/core/src/session/runner/model.ts` — Model resolution
- `packages/core/src/session/input.ts` — Input admission/promotion
- `packages/core/src/session/compaction.ts` — LLM-based compaction
- `packages/core/src/session/history.ts` — History loading
- `packages/core/src/session/context-epoch.ts` — System context management

### V1 (Legacy, still active)

- Separate processor in `packages/obelisk/src/session/processor.ts`
- State machine: Idle → Running → Shell → ShellThenRun

**Status:** ✅ Both V1 and V2 understood. V2 is the target for Obelisk integration.

---

## 6. Licensing

| Aspect | Status |
|--------|--------|
| License type | **MIT** |
| File | `/LICENSE` — Full MIT text |
| package.json | `"license": "MIT"` |
| Source file headers | ❌ None — no SPDX headers in source files |
| Third-party | `webview-zoom.ts` (Tauri, Apache-2.0/MIT), `proxy-env.ts` (MIT adapted) |

**Status:** ✅ MIT license confirmed. Adding SPDX headers to source files is optional but recommended for enterprise standards.

---

## 7. Running from Source

| Requirement | Status |
|-------------|--------|
| Runtime | `bun` >= 1.3 — **not installed** on this system |
| Node.js | v24.18.0 available |
| Alternative | `bin/obelisk` is a binary downloader, not a source runner |
| Outcome | ❌ Cannot run from source — `bun` not available |

**To run from source:** Install bun (`curl -fsSL https://bun.sh/install | bash`) then `bun run dev`

---

## 8. Summary

| System | Architecture | Quality | Ready for Obelisk Integration? |
|--------|-------------|---------|-------------------------------|
| CLI Commands | Yargs + Effect | Excellent | ✅ Yes — add files to `cmd/` |
| Config | JSONC + merge | Excellent | ✅ Yes — extend schema |
| Tools | Layered registry | Excellent | ✅ Yes — add adapters |
| Plugins | Hook-based | Excellent | ✅ Yes — plugin hooks |
| MCP | First-class | Excellent | ✅ Yes — auto-discovered |
| Models | Route composite | Excellent | ✅ Yes — intercept at `compile()` |
| Sessions | Event-sourced V2 | Excellent | ✅ Yes — extend runner |
| Licensing | MIT | Good | ✅ Confirmed |

**Verdict:** OpenCode is an excellent fork base. The architecture is clean, well-layered, and provides clear extension points for all Obelisk components.