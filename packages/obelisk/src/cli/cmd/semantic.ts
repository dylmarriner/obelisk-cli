import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { SerenaMcpAdapter } from "@obelisk-ai/semantic"

export const SemanticCommand = cmd({
  command: "semantic",
  describe: "semantic code intelligence via Serena MCP",
  builder: (yargs: Argv) =>
    yargs
      .command(SemanticStatusCommand)
      .command(SemanticSymbolsCommand)
      .command(SemanticFindSymbolCommand)
      .command(SemanticRefsCommand)
      .command(SemanticRenameCommand)
      .demandCommand(),
  async handler() {},
})

const SemanticStatusCommand = effectCmd({
  command: "status",
  describe: "check Serena MCP server status",
  instance: false,
  handler: Effect.fn("Cli.semantic.status")(function* () {
    const adapter = new SerenaMcpAdapter()

    Console.log("")
    Console.log("  Checking Serena MCP server...")
    Console.log("")

    const status = yield* Effect.promise(() => adapter.status())

    if (status.available) {
      Console.log(`  ✓ Serena is available`)
      if (status.version) Console.log(`    Version: ${status.version}`)
      if (status.project) Console.log(`    Project: ${status.project}`)
      Console.log("")
    } else {
      Console.log(`  ✗ Serena is not available`)
      if (status.error) Console.log(`    ${status.error}`)
      Console.log("")
      Console.log("  To install Serena:")
      Console.log("    uvx serena-agent start-mcp-server")
      Console.log("")
    }
  }),
})

const SemanticSymbolsCommand = effectCmd({
  command: "symbols [file]",
  describe: "list symbols in a file or project",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "file path relative to project root",
      })
      .option("depth", {
        type: "number",
        describe: "symbol depth level",
        default: -1,
      }),
  handler: Effect.fn("Cli.semantic.symbols")(function* (args) {
    const adapter = new SerenaMcpAdapter()

    Console.log("")
    Console.log(`  Fetching symbols${args.file ? ` for ${args.file}` : "..."}`)
    Console.log("")

    try {
      const symbols = yield* Effect.promise(() =>
        adapter.listSymbols({ file: args.file, depth: args.depth })
      )

      if (symbols.length === 0) {
        Console.log("  No symbols found.")
        Console.log("")
        return
      }

      Console.log(`  Found ${symbols.length} symbol(s):`)
      Console.log("")

      for (const sym of symbols.slice(0, 40)) {
        const loc = sym.file ? ` ${sym.file}:${sym.line}:${sym.column}` : ` ${sym.line}:${sym.column}`
        console.log(`    ${sym.kind.padEnd(12)} ${sym.name}${loc}`)
      }

      if (symbols.length > 40) {
        Console.log(`  ... and ${symbols.length - 40} more symbols`)
      }
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const SemanticFindSymbolCommand = effectCmd({
  command: "find-symbol <name>",
  describe: "find a symbol by name across the project",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "symbol name to search for (e.g. 'UserService', 'createUser')",
      })
      .option("file", {
        type: "string",
        alias: "f",
        describe: "restrict search to a specific file",
      })
      .option("body", {
        type: "boolean",
        describe: "include symbol body/source code",
        default: false,
      }),
  handler: Effect.fn("Cli.semantic.find-symbol")(function* (args) {
    const adapter = new SerenaMcpAdapter()

    Console.log("")
    Console.log(`  Searching for symbol "${args.name}"...`)
    Console.log("")

    try {
      const symbols = yield* Effect.promise(() =>
        adapter.findSymbol({
          name: args.name,
          file: args.file,
          includeBody: args.body,
          includeInfo: true,
        })
      )

      if (symbols.length === 0) {
        Console.log("  No matching symbols found.")
        Console.log("")
        return
      }

      Console.log(`  Found ${symbols.length} symbol(s):`)
      Console.log("")

      for (const sym of symbols.slice(0, 15)) {
        console.log(`    ${sym.kind}  ${sym.name}`)
        console.log(`    Location: ${sym.file}:${sym.line}:${sym.column}`)
        if (sym.signature) console.log(`    Signature: ${sym.signature}`)
        if (sym.documentation) {
          const doc = sym.documentation.substring(0, 200)
          console.log(`    Doc: ${doc}`)
        }
        console.log("")
      }

      if (symbols.length > 15) {
        Console.log(`  ... and ${symbols.length - 15} more results`)
        Console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Search failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const SemanticRefsCommand = effectCmd({
  command: "refs <name> <file>",
  describe: "find all references to a symbol",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "symbol name (e.g. 'UserService.createUser')",
      })
      .positional("file", {
        type: "string",
        describe: "file containing the symbol definition",
      }),
  handler: Effect.fn("Cli.semantic.refs")(function* (args) {
    const adapter = new SerenaMcpAdapter()

    Console.log("")
    Console.log(`  Finding references to "${args.name}" in ${args.file}...`)
    Console.log("")

    try {
      const refs = yield* Effect.promise(() =>
        adapter.findReferences({ name: args.name, file: args.file })
      )

      if (refs.length === 0) {
        Console.log("  No references found.")
        Console.log("")
        return
      }

      Console.log(`  Found ${refs.length} reference(s):`)
      Console.log("")

      for (const ref of refs.slice(0, 30)) {
        console.log(`    ${ref.file}:${ref.line}:${ref.column}`)
        console.log(`    ${ref.context.substring(0, 100)}`)
        console.log("")
      }

      if (refs.length > 30) {
        Console.log(`  ... and ${refs.length - 30} more references`)
        Console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Search failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const SemanticRenameCommand = effectCmd({
  command: "rename <name> <file> <new-name>",
  describe: "preview renaming a symbol across the project",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "current symbol name",
      })
      .positional("file", {
        type: "string",
        describe: "file containing the symbol",
      })
      .positional("new-name", {
        type: "string",
        describe: "new symbol name",
      }),
  handler: Effect.fn("Cli.semantic.rename")(function* (args) {
    const adapter = new SerenaMcpAdapter()

    Console.log("")
    Console.log(`  Preparing rename of "${args.name}" → "${args.newName}"...`)
    Console.log("")

    try {
      const plan = yield* Effect.promise(() =>
        adapter.prepareRename({ name: args.name, file: args.file, newName: args.newName })
      )

      if (plan.changes.length === 0) {
        Console.log("  No references found — rename is safe.")
        Console.log("")
        return
      }

      Console.log(`  ${plan.summary}`)
      Console.log("")

      const uniqueFiles = new Set(plan.changes.map((c) => c.file))
      console.log(`    Files affected: ${uniqueFiles.size}`)
      console.log(`    Total changes:  ${plan.changes.length}`)
      console.log("")

      for (const change of plan.changes.slice(0, 10)) {
        console.log(`    ${change.file}:${change.line}`)
        console.log(`      ${change.oldContent} → ${change.newContent}`)
        console.log("")
      }

      if (plan.changes.length > 10) {
        Console.log(`  ... and ${plan.changes.length - 10} more changes`)
        Console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Rename preview failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})