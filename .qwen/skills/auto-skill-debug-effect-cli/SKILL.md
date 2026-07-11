---
name: debug-effect-cli
description: Systematic approach to debugging TypeScript CLIs built with Effect.ts and yargs — fixes silent output, type errors, workspace linking, and generator execution
source: auto-skill
extracted_at: '2026-07-09T08:51:57.909Z'
---

# Debug Effect CLI

Systematic approach to debugging a TypeScript monorepo CLI built with Effect.ts, yargs, and `bun`.

## When to use

- CLI commands are registered (show in `--help`) but produce no output when executed
- Type errors related to `Console.log`, `Effect.fn`, or yargs property access
- Workspace packages not linked after `bun install`
- JSDoc `/* */` closing parent comment prematurely
- Generator functions whose body never executes

## Root Cause Checklist

### 1. `Console.log` vs `console.log` (most common)

Commands using `Effect.fn("...")(function*(args) { ... })` with `Console.log()` inside:

```typescript
// ❌ BROKEN — Console.log returns Effect, not yielded, so output is silently dropped
import { Effect, Console } from "effect"
handler: Effect.fn("Cli.doctor")(function* (args) {
  Console.log("Hello")  // Effect created but never executed
})

// ✅ FIXED — use global console.log (synchronous, works inside generators)
import { Effect } from "effect"
handler: Effect.fn("Cli.doctor")(function* (args) {
  console.log("Hello")  // Executes immediately
})
```

**Fix steps:**
- Replace `Console.log(` with `console.log(` in all CLI command handler files
- Remove `Console` from the `import { Effect, Console } from "effect"` import

### 2. `cmd()` vs `effectCmd()` mismatch

Commands that use `Effect.fn(...)` inside a `cmd()` handler:

```typescript
// ❌ BROKEN — cmd() expects async handler, gets Generator, never iterates it
export const MyCommand = cmd({
  handler: Effect.fn("Cli.my")(function* (args) { ... })
})

// ✅ FIXED — use effectCmd() which wraps the handler properly
export const MyCommand = effectCmd({
  instance: false,  // Add if command doesn't need project context
  handler: Effect.fn("Cli.my")(function* (args) { ... })
})
```

**Check:** `grep -n 'const .* = cmd({' src/cli/cmd/*.ts` — each result should either delegate to subcommands (via `.command()` in builder) or use `effectCmd()`.

### 3. JSDoc `/* */` prematurely closing `/** */`

The `/* */` comment syntax inside a `/** */` JSDoc block closes the outer comment:

```typescript
// ❌ BROKEN — `*/` in `/* */` terminates the `/**` block at line 17
/**
 * L7  Code comment strip         10-40%   //, /* */, #, <!-- -->, REM
 * L8  Import/export compaction   5-15%
 */

// ✅ FIXED — avoid `*/` sequence inside JSDoc
/**
 * L7  Code comment strip         10-40%   //, block comments, #, <!-- -->, REM
 * L8  Import/export compaction   5-15%
 */
```

**Search:** `grep -rn '/\* \*/' src/` to find `/* */` inside JSDoc comments.

### 4. yargs property access — kebab-case vs camelCase

yargs `--kebab-case` options are typed as `args['kebab-case']` (bracket notation), not `args.kebabCase`:

```typescript
// ❌ TYPE ERROR — Property 'ruleText' does not exist on type '...'
const rule = args.ruleText

// ✅ FIXED — use bracket notation
const rule = args['rule-text']
```

### 5. Missing comma in array literals

```typescript
// ❌ SYNTAX ERROR
patterns: [
  /pattern1/i, /pattern2/i   // ← missing trailing comma
  /pattern3/i,
]
```

### 6. Workspace packages not linked by `bun install`

`bun install` only creates symlinks for workspace packages that are depended upon by other packages. New packages with no dependents are skipped:

```bash
# Check if linked
ls -la node_modules/@scope/

# Manually create symlink
ln -sf ../../packages/<name> node_modules/@scope/<name>
```

## Systematic Debug Loop

1. **`bun install`** — ensure all dependencies resolved
2. **Check symlinks** — `ls -la node_modules/@scope/` for missing packages
3. **Run typecheck** — `bun run --cwd packages/<name> typecheck` to find errors
4. **Run CLI help** — `bun run --cwd packages/cli dev --help` to verify command registration
5. **Run command** — `bun run --cwd packages/cli dev <command>` to test output
6. **Run tests** — `bun run --cwd packages/cli test` to check for regressions

## References

- [Effect.ts Console](https://effect.website/docs/guides/logging) — `Console.log` returns `Effect`, must be `yield*` in generators
- [yargs kebab-case](https://github.com/yargs/yargs) — Options with `--kebab-case` names use bracket notation in types