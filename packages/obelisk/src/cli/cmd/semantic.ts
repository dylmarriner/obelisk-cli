import { EOL } from "os"
import { Effect } from "effect"
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

    console.log("")
    console.log("  Checking Serena MCP server...")
    console.log("")

    const status = yield* Effect.promise(() => adapter.status())

    if (status.available) {
      console.log(`  ✓ Serena is available`)
      if (status.version) console.log(`    Version: ${status.version}`)
      if (status.project) console.log(`    Project: ${status.project}`)
      console.log("")
    } else {
      console.log(`  ✗ Serena is not available`)
      if (status.error) console.log(`    ${status.error}`)
      console.log("")
      console.log("  To install Serena:")
      console.log("    uvx serena-agent start-mcp-server")
      console.log("")
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

    console.log("")
    console.log(`  Fetching symbols${args.file ? ` for ${args.file}` : "..."}`)
    console.log("")

    try {
      const symbols = yield* Effect.promise(() =>
        adapter.listSymbols({ file: args.file!, depth: args.depth })
      )

      if (symbols.length === 0) {
        console.log("  No symbols found.")
        console.log("")
        return
      }

      console.log(`  Found ${symbols.length} symbol(s):`)
      console.log("")

      for (const sym of symbols.slice(0, 40)) {
        const loc = sym.file ? ` ${sym.file}:${sym.line}:${sym.column}` : ` ${sym.line}:${sym.column}`
        console.log(`    ${sym.kind.padEnd(12)} ${sym.name}${loc}`)
      }

      if (symbols.length > 40) {
        console.log(`  ... and ${symbols.length - 40} more symbols`)
      }
      console.log("")
    } catch (err) {
      console.log(`  ✗ Failed: ${(err as Error).message}`)
      console.log("")
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

    console.log("")
    console.log(`  Searching for symbol "${args.name}"...`)
    console.log("")

    try {
      const symbols = yield* Effect.promise(() =>
        adapter.findSymbol({
          name: args.name!,
          file: args.file!,
          includeBody: args.body,
          includeInfo: true,
        })
      )

      if (symbols.length === 0) {
        console.log("  No matching symbols found.")
        console.log("")
        return
      }

      console.log(`  Found ${symbols.length} symbol(s):`)
      console.log("")

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
        console.log(`  ... and ${symbols.length - 15} more results`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Search failed: ${(err as Error).message}`)
      console.log("")
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

    console.log("")
    console.log(`  Finding references to "${args.name}" in ${args.file}...`)
    console.log("")

    try {
      const refs = yield* Effect.promise(() =>
        adapter.findReferences({ name: args.name!, file: args.file! })
      )

      if (refs.length === 0) {
        console.log("  No references found.")
        console.log("")
        return
      }

      console.log(`  Found ${refs.length} reference(s):`)
      console.log("")

      for (const ref of refs.slice(0, 30)) {
        console.log(`    ${ref.file}:${ref.line}:${ref.column}`)
        console.log(`    ${ref.context.substring(0, 100)}`)
        console.log("")
      }

      if (refs.length > 30) {
        console.log(`  ... and ${refs.length - 30} more references`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Search failed: ${(err as Error).message}`)
      console.log("")
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
        demandOption: true,
      })
      .positional("file", {
        type: "string",
        describe: "file containing the symbol",
        demandOption: true,
      })
      .positional("new-name", {
        type: "string",
        describe: "new symbol name",
        demandOption: true,
      }),
  handler: Effect.fn("Cli.semantic.rename")(function* (args) {
    const adapter = new SerenaMcpAdapter()

    console.log("")
    console.log(`  Preparing rename of "${args.name}" → "${args["new-name"]}"...`)
    console.log("")

    try {
      const plan = yield* Effect.promise(() =>
        adapter.prepareRename({ name: args.name!, file: args.file!, newName: args["new-name"] })
      )

      if (plan.changes.length === 0) {
        console.log("  No references found — rename is safe.")
        console.log("")
        return
      }

      console.log(`  ${plan.summary}`)
      console.log("")

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
        console.log(`  ... and ${plan.changes.length - 10} more changes`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Rename preview failed: ${(err as Error).message}`)
      console.log("")
    }
  }),
})