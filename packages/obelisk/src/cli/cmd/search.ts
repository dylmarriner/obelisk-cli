import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { ZoektSearchAdapter, CocoIndexAdapter } from "@obelisk-ai/search"

export const IndexCommand = cmd({
  command: "index",
  describe: "manage code search indexes",
  builder: (yargs: Argv) =>
    yargs
      .command(IndexRunCommand)
      .command(IndexStatusCommand)
      .command(IndexRebuildCommand)
      .command(IndexCocoCommand)
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
      indexDir: args["index-dir"],
    })

    console.log("")
    console.log(`  Indexing ${repoPath}...`)
    console.log("")

    try {
      const result = args.rebuild
        ? yield* Effect.promise(() => adapter.rebuild({ repoPath, indexDir: args["index-dir"] || undefined, name: args.name! }))
        : yield* Effect.promise(() => adapter.index({ repoPath, indexDir: args["index-dir"] || undefined, name: args.name! }))

      console.log(`  ✓ Indexing complete`)
      console.log(`    Files:     ${result.fileCount.toLocaleString()}`)
      console.log(`    Size:      ${formatBytes(result.sizeBytes)}`)
      console.log(`    Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
      console.log(`    Location:  ${result.indexPath}`)
      console.log("")
    } catch (err) {
      console.log(`  ✗ Indexing failed: ${(err as Error).message}`)
      console.log("")
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
      indexDir: args["index-dir"],
    })

    const status = yield* Effect.promise(() => adapter.status({ indexDir: args["index-dir"] }))

    console.log("")
    console.log("  Index Status")
    console.log("  " + "─".repeat(40))
    if (status.indexed) {
      console.log(`  Status:     ✓ Ready`)
      console.log(`  Location:   ${status.indexPath}`)
      console.log(`  Size:       ${formatBytes(status.sizeBytes)}`)
      console.log(`  Shards:     ${status.shardCount}`)
      if (status.lastIndexed) {
        console.log(`  Last built: ${new Date(status.lastIndexed).toLocaleString()}`)
      }
    } else {
      console.log(`  Status:     ✗ Not indexed`)
      console.log(`  Location:   ${status.indexPath}`)
      console.log("")
      console.log("  Run 'obelisk index' to build the index.")
    }
    console.log("")
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

    console.log("")
    console.log(`  Rebuilding index for ${repoPath}...`)
    console.log("")

    try {
      const result = yield* Effect.promise(() =>
        adapter.rebuild({ repoPath, name: args.name! })
      )

      console.log(`  ✓ Index rebuilt`)
      console.log(`    Files:     ${result.fileCount.toLocaleString()}`)
      console.log(`    Size:      ${formatBytes(result.sizeBytes)}`)
      console.log(`    Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
      console.log("")
    } catch (err) {
      console.log(`  ✗ Rebuild failed: ${(err as Error).message}`)
      console.log("")
    }
  }),
})

export const SearchCommand = effectCmd({
  command: "search <query>",
  describe: "search indexed code using Zoekt",
  instance: false,
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
      indexDir: args["index-dir"],
    })

    console.log("")
    console.log(`  Searching for "${args.query}"...`)
    console.log("")

    try {
      const results = yield* Effect.promise(() =>
        adapter.search({
          query: args.query!,
          regex: args.regex,
          file: args.file,
          maxResults: args["max-results"],
        })
      )

      if (results.length === 0) {
        console.log("  No results found.")
        console.log("")
        return
      }

      console.log(`  Found ${results.length} result(s):`)
      console.log("")

      for (const r of results.slice(0, 20)) {
        console.log(`    ${r.file}:${r.line}:${r.column}`)
        console.log(`    ${r.content.trim().substring(0, 120)}`)
        console.log("")
      }

      if (results.length > 20) {
        console.log(`  ... and ${results.length - 20} more results`)
        console.log("")
      }
    } catch (err) {
      const message = (err as Error).message
      if (message.includes("No index found")) {
        console.log(`  ✗ No index found. Run 'obelisk index' first.`)
      } else {
        console.log(`  ✗ Search failed: ${message}`)
      }
      console.log("")
    }
  }),
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

// ─── CocoIndex ──────────────────────────────────────────────────

const IndexCocoCommand = cmd({
  command: "coco",
  describe: "incremental indexing with CocoIndex",
  builder: (yargs: Argv) =>
    yargs
      .command(CocoUpdateCommand)
      .command(CocoStatusCommand)
      .command(CocoInitCommand)
      .command(CocoEmbedCommand)
      .demandCommand(),
  async handler() {},
})

const CocoUpdateCommand = effectCmd({
  command: "update <script>",
  describe: "run a CocoIndex pipeline (one-shot or live)",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("script", { type: "string", describe: "path to the Python app script", demandOption: true })
      .option("name", { type: "string", describe: "app name within the script" })
      .option("live", { type: "boolean", alias: "L", describe: "watch mode", default: false })
      .option("reset", { type: "boolean", describe: "reset before running", default: false }),
  handler: Effect.fn("Cli.index.coco.update")(function* (args) {
    const adapter = new CocoIndexAdapter()

    console.log("")
    console.log(`  Running CocoIndex pipeline: ${args.script}`)
    if (args.live) console.log("  Mode: live (watching for changes)")
    console.log("")

    const result = yield* Effect.promise(() =>
      adapter.update({
        appScript: args.script,
        appName: args.name,
        live: args.live,
        reset: args.reset,
      })
    )

    if (result.success) {
      console.log(`  ✓ Pipeline completed in ${(result.durationMs / 1000).toFixed(1)}s`)
      if (result.output) {
        const lines = result.output.trim().split("\n").slice(-5).join("\n")
        console.log(`  ${lines}`)
      }
    } else {
      console.log(`  ✗ Pipeline failed: ${result.error}`)
    }
    console.log("")
  }),
})

const CocoStatusCommand = effectCmd({
  command: "status",
  describe: "check CocoIndex availability and list apps",
  instance: false,
  handler: Effect.fn("Cli.index.coco.status")(function* () {
    const adapter = new CocoIndexAdapter()

    console.log("")
    console.log("  CocoIndex Status")
    console.log("  " + "─".repeat(40))
    console.log("")

    const status = yield* Effect.promise(() => adapter.status())

    if (status.available) {
      console.log(`  ✓ CocoIndex ${status.version || "installed"}`)
      console.log("")

      if (status.apps && status.apps.length > 0) {
        console.log(`  Apps: ${status.apps.length}`)
        for (const app of status.apps) {
          console.log(`    ${app.name}  (${app.status})`)
        }
      } else {
        console.log("  No apps registered.")
      }
    } else {
      console.log("  ✗ CocoIndex not available")
      console.log("  Install with: pip install cocoindex")
    }
    console.log("")
  }),
})

const CocoInitCommand = effectCmd({
  command: "init <name>",
  describe: "scaffold a new CocoIndex project",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", describe: "project name", demandOption: true }),
  handler: Effect.fn("Cli.index.coco.init")(function* (args) {
    const adapter = new CocoIndexAdapter()

    console.log("")
    console.log(`  Scaffolding CocoIndex project: ${args.name}`)
    console.log("")

    const result = yield* Effect.promise(() => adapter.init(args.name))
    if (result.success) {
      console.log(`  ✓ Project created at ${result.path}`)
    } else {
      console.log(`  ✗ Failed: ${result.error}`)
    }
    console.log("")
  }),
})

const CocoEmbedCommand = effectCmd({
  command: "embed <source-dir>",
  describe: "generate and run a code embedding pipeline",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("source-dir", { type: "string", describe: "source directory to index", demandOption: true })
      .option("chunk-size", { type: "number", describe: "code chunk size in tokens", default: 1000 })
      .option("model", { type: "string", describe: "embedding model", default: "sentence-transformers/all-MiniLM-L6-v2" })
      .option("table", { type: "string", describe: "target table name", default: "code_embeddings" })
      .option("run", { type: "boolean", describe: "run immediately after generating", default: false }),
  handler: Effect.fn("Cli.index.coco.embed")(function* (args) {
    const adapter = new CocoIndexAdapter()

    console.log("")
    console.log(`  Generating code embedding pipeline for ${args["source-dir"]}...`)
    console.log("")

    const scriptPath = adapter.generateEmbeddingScript(args["source-dir"], {
      chunkSize: args["chunk-size"],
      model: args.model!,
      tableName: args.table,
    })

    console.log(`  ✓ Pipeline script generated:`)
    console.log(`    ${scriptPath}`)
    console.log("")

    if (args.run) {
      console.log("  Running pipeline...")
      console.log("")

      const result = yield* Effect.promise(() =>
        adapter.update({ appScript: scriptPath })
      )

      if (result.success) {
        console.log(`  ✓ Indexing complete (${(result.durationMs / 1000).toFixed(1)}s)`)
      } else {
        console.log(`  ✗ Indexing failed: ${result.error}`)
        console.log("")
        console.log("  You can run the pipeline manually:")
        console.log(`    cocoindex update ${scriptPath}`)
      }
      console.log("")
    } else {
      console.log("  Run the pipeline with:")
      console.log(`    obelisk index coco update ${scriptPath}`)
      console.log("")
    }
  }),
})