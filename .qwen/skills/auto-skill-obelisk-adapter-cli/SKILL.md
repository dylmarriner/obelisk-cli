---
name: obelisk-adapter-cli
description: Add a new adapter package and CLI command group to the Obelisk CLI (OpenCode fork)
source: auto-skill
extracted_at: '2026-07-09T06:01:06.308Z'
---

# Add a New Adapter Package and CLI Commands

Use this skill when building a new integration for the Obelisk CLI (an OpenCode fork). This covers creating the adapter package, the CLI command files, and registering everything.

## Project Structure

```
obelisk-cli/
  packages/
    <adapter-name>/          # New adapter package
      package.json
      src/
        index.ts             # Exports
        types.ts             # Adapter interface + types
        <adapter>-adapter.ts # Implementation
    obelisk/                 # CLI binary (add commands here)
      src/
        cli/
          cmd/
            <command>.ts     # New CLI command file
        index.ts             # Register commands here
  eval/
    <component>/             # Reference implementation (optional)
```

## Step-by-step Process

### Step 1: Create the adapter package

Create `packages/<name>/package.json`:

```json
{
  "name": "@obelisk-ai/<name>",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

The workspace is auto-discovered via `packages/*` in root `package.json`.

### Step 2: Define types and interface

Create `packages/<name>/src/types.ts` with:

- The adapter interface (e.g. `SearchAdapter`, `StructuralRefactorAdapter`)
- Input/output types for each method
- Default config values if applicable

### Step 3: Implement the adapter

Create `packages/<name>/src/<name>-adapter.ts`:

- Implement the adapter interface
- Use subprocess execution (`child_process.execFile`) for CLI-based tools (Zoekt, ast-grep)
- Use HTTP fetch for remote services (Nexus)
- Use `fs` for local file operations
- Handle binary not found with helpful error messages
- Include `available()` method for checking if the tool is installed
- Re-export the adapter interface at `packages/<name>/src/index.ts`

### Step 4: Create CLI commands

Create `packages/obelisk/src/cli/cmd/<command>.ts`:

For a top-level command group (e.g. `obelisk nexus`), use `cmd()`:

```typescript
export const CommandName = cmd({
  command: "<name>",
  describe: "short description",
  builder: (yargs: Argv) =>
    yargs
      .command(SubCommand1)
      .command(SubCommand2)
      .demandCommand(),
  async handler() {},
})
```

For subcommands, use `effectCmd()`:

```typescript
const SubCommand1 = effectCmd({
  command: "subcommand [args]",
  describe: "description",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("arg", { type: "string", describe: "..." })
      .option("flag", { type: "boolean", describe: "..." }),
  handler: Effect.fn("Cli.<name>.subcommand")(function* (args) {
    // Implementation using Console.log for output
    // Use Effect.promise(() => adapter.method()) for async calls
  }),
})
```

### Step 5: Register commands in the CLI

Edit `packages/obelisk/src/index.ts`:

1. Add import: `import { CommandName } from "./cli/cmd/<command>"`
2. Add `.command(CommandName)` in the yargs chain (before `.fail()`)

### Step 6: Handle edge cases

- **Binary not found**: Throw `Error` with install instructions (e.g. `cargo install`, `go install`, `pip install`)
- **Missing dependencies**: Check with `available()` before operations
- **JSON parsing**: Use `try/catch` around JSON.parse — fall back to text parsing
- **Large outputs**: Set `maxBuffer` in execFile options (10MB default)
- **Timeouts**: Set reasonable timeouts (30s for search, 5min for indexing)
- **Subprocess failures**: Catch `ENOENT` for missing binaries, `ETIMEDOUT` for timeouts

### Step 7: Adapter interface checklist

Each adapter should expose:

| Method | Purpose | Required |
|--------|---------|----------|
| `available()` | Check if tool is installed | Yes |
| Primary operations | e.g. `search()`, `find()`, `health()` | Yes |
| Status/inspection | e.g. `status()`, `inspect()` | Recommended |
| Utility | e.g. `rebuild()`, `sync()` | As needed |

### Step 8: CLI command checklist

Each command group should include:

| Command | Purpose | Example |
|---------|---------|---------|
| Primary operation | Main action | `obelisk search <query>` |
| Status | Check state | `obelisk index status` |
| Config | View settings | `obelisk nexus config` |
| Utility | Management | `obelisk nexus sync` |

### Step 9: Follow the pattern

Existing adapters follow this structure — use them as reference:

| Phase | Package | Binary | Interface |
|-------|---------|--------|-----------|
| 3 | `packages/memory/` | Remote HTTP | `MemoryAdapter` |
| 4 | `packages/obelisk-core/` | Native | `TokenControlAdapter` |
| 5 | `packages/search/` | Zoekt (Go) | `SearchAdapter` |
| 6 | `packages/structural/` | ast-grep (Rust) | `StructuralRefactorAdapter` |