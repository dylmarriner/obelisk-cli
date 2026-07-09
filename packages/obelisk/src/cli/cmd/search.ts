import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { ZoektSearchAdapter } from "@obelisk-ai/search"

export const IndexCommand = cmd({
  command: "index",
  describe: "manage code search indexes",
  builder: (yargs: Argv) =>
    yargs
      .command(IndexRunCommand)
      .command(IndexStatusCommand)
      .command(IndexRebuildCommand)
      .demandCommand(),
  async handler() {},
})

const IndexRunCommand = effectCmd({
  command: "run [path]",
  describe: "index a repository for fast code search",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "path to the repository to index (default: cwd)",
      })
      .option("name", {
        type: "string",
        describe: "name for the index",
      })
      .option("index-dir", {
        type: "string",
        describe: "directory to store the index",
      })
      .option("rebuild", {
        type: "boolean",
        describe: "force rebuild from scratch",
        default: false,
      }),
  handler: Effect.fn("Cli.index.run")(function* (args) {
    const repoPath = args.path || process.cwd()
    const adapter = new ZoektSearchAdapter({
      indexDir: args.indexDir,
    })

    Console.log("")
    Console.log(`  Indexing ${repoPath}...`)
    Console.log("")

    try {
      const result = args.rebuild
        ? yield* Effect.promise(() => adapter.rebuild({ repoPath, indexDir: args.indexDir || undefined, name: args.name }))
        : yield* Effect.promise(() => adapter.index({ repoPath, indexDir: args.indexDir || undefined, name: args.name }))

      Console.log(`  ✓ Indexing complete`)
      Console.log(`    Files:     ${result.fileCount.toLocaleString()}`)
      Console.log(`    Size:      ${formatBytes(result.sizeBytes)}`)
      Console.log(`    Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
      Console.log(`    Location:  ${result.indexPath}`)
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Indexing failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const IndexStatusCommand = effectCmd({
  command: "status",
  describe: "show index status",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("index-dir", {
      type: "string",
      describe: "index directory to check",
    }),
  handler: Effect.fn("Cli.index.status")(function* (args) {
    const adapter = new ZoektSearchAdapter({
      indexDir: args.indexDir,
    })

    const status = yield* Effect.promise(() => adapter.status({ indexDir: args.indexDir }))

    Console.log("")
    Console.log("  Index Status")
    Console.log("  " + "─".repeat(40))
    if (status.indexed) {
      Console.log(`  Status:     ✓ Ready`)
      Console.log(`  Location:   ${status.indexPath}`)
      Console.log(`  Size:       ${formatBytes(status.sizeBytes)}`)
      Console.log(`  Shards:     ${status.shardCount}`)
      if (status.lastIndexed) {
        Console.log(`  Last built: ${new Date(status.lastIndexed).toLocaleString()}`)
      }
    } else {
      Console.log(`  Status:     ✗ Not indexed`)
      Console.log(`  Location:   ${status.indexPath}`)
      Console.log("")
      Console.log("  Run 'obelisk index' to build the index.")
    }
    Console.log("")
  }),
})

const IndexRebuildCommand = effectCmd({
  command: "rebuild [path]",
  describe: "rebuild the index from scratch",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "path to the repository",
      })
      .option("name", {
        type: "string",
        describe: "name for the index",
      }),
  handler: Effect.fn("Cli.index.rebuild")(function* (args) {
    const repoPath = args.path || process.cwd()
    const adapter = new ZoektSearchAdapter()

    Console.log("")
    Console.log(`  Rebuilding index for ${repoPath}...`)
    Console.log("")

    try {
      const result = yield* Effect.promise(() =>
        adapter.rebuild({ repoPath, name: args.name })
      )

      Console.log(`  ✓ Index rebuilt`)
      Console.log(`    Files:     ${result.fileCount.toLocaleString()}`)
      Console.log(`    Size:      ${formatBytes(result.sizeBytes)}`)
      Console.log(`    Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Rebuild failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

export const SearchCommand = cmd({
  command: "search <query>",
  describe: "search indexed code using Zoekt",
  builder: (yargs: Argv) =>
    yargs
      .positional("query", {
        type: "string",
        describe: "search query",
      })
      .option("regex", {
        type: "boolean",
        describe: "interpret query as a regular expression",
        default: false,
      })
      .option("file", {
        type: "string",
        describe: "filter by filename pattern",
      })
      .option("max-results", {
        type: "number",
        describe: "maximum number of results",
        default: 20,
      })
      .option("index-dir", {
        type: "string",
        describe: "index directory",
      }),
  handler: Effect.fn("Cli.search")(function* (args) {
    const adapter = new ZoektSearchAdapter({
      indexDir: args.indexDir,
    })

    Console.log("")
    Console.log(`  Searching for "${args.query}"...`)
    Console.log("")

    try {
      const results = yield* Effect.promise(() =>
        adapter.search({
          query: args.query,
          regex: args.regex,
          file: args.file,
          maxResults: args.maxResults,
        })
      )

      if (results.length === 0) {
        Console.log("  No results found.")
        Console.log("")
        return
      }

      Console.log(`  Found ${results.length} result(s):`)
      Console.log("")

      for (const r of results.slice(0, 20)) {
        console.log(`    ${r.file}:${r.line}:${r.column}`)
        console.log(`    ${r.content.trim().substring(0, 120)}`)
        console.log("")
      }

      if (results.length > 20) {
        Console.log(`  ... and ${results.length - 20} more results`)
        Console.log("")
      }
    } catch (err) {
      const message = (err as Error).message
      if (message.includes("No index found")) {
        Console.log(`  ✗ No index found. Run 'obelisk index' first.`)
      } else {
        Console.log(`  ✗ Search failed: ${message}`)
      }
      Console.log("")
    }
  }),
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}