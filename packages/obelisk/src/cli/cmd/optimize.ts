import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import * as fs from "node:fs"
import { InputOptimizer, OutputOptimizer, ReversibleBlobStore, estimateTokens } from "@obelisk-ai/obelisk-core"

export const OptimizeCommand = cmd({
  command: "optimize",
  describe: "token optimization — compress input/output, restore originals",
  builder: (yargs: Argv) =>
    yargs
      .command(OptimizeInputCommand)
      .command(OptimizeOutputCommand)
      .command(OptimizeRestoreCommand)
      .command(OptimizeStatsCommand)
      .command(OptimizeGcCommand)
      .demandCommand(),
  async handler() {},
})

const OptimizeInputCommand = effectCmd({
  command: "input [file]",
  describe: "compress text for LLM input — reversible, lossless",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "file to optimize (reads from stdin if omitted)",
      })
      .option("terse", {
        type: "string",
        choices: ["off", "lite", "full", "ultra"],
        describe: "prose compression level",
        default: "lite",
      })
      .option("no-reversible", {
        type: "boolean",
        describe: "skip storing originals for recovery",
        default: false,
      })
      .option("json", {
        type: "boolean",
        describe: "output JSON report instead of compressed text",
        default: false,
      }),
  handler: Effect.fn("Cli.optimize.input")(function* (args) {
    const text = args.file
      ? fs.readFileSync(args.file, "utf-8")
      : yield* Effect.promise(() => readStdin())

    if (!text) {
      Console.log("  No input provided. Pipe text or provide a file.")
      Console.log("")
      return
    }

    const optimizer = new InputOptimizer({
      terseLevel: args.terse as any,
      reversible: !args.noReversible,
    })

    const { text: optimized, report } = optimizer.optimize(text, args.file || "stdin")

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }

    Console.log("")
    Console.log("  Input Optimization Report")
    Console.log("  " + "─".repeat(40))
    Console.log(`  Input tokens:     ${report.inputTokens.toLocaleString()}`)
    Console.log(`  Output tokens:    ${report.outputTokens.toLocaleString()}`)
    Console.log(`  Saved:            ${report.savedTokens.toLocaleString()} (${report.savedPercent.toFixed(1)}%)`)
    Console.log("")

    if (report.layers.length > 0) {
      Console.log("  Layers applied:")
      for (const layer of report.layers) {
        const icon = layer.reversible ? "↩" : "→"
        console.log(`    ${icon} ${layer.name.padEnd(20)} saved ${layer.savedTokens.toLocaleString()} tok`)
      }
      Console.log("")
    }

    if (report.handle) {
      Console.log(`  Reversible handle: ${report.handle}`)
      Console.log(`  Restore with: obelisk optimize restore ${report.handle}`)
      Console.log("")
    }

    // Output the compressed text
    process.stdout.write(optimized + EOL)
  }),
})

const OptimizeOutputCommand = effectCmd({
  command: "output [file]",
  describe: "compress tool output for LLM context — type-aware",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "file to optimize (reads from stdin if omitted)",
      })
      .option("type", {
        type: "string",
        choices: ["auto", "git-diff", "build-log", "search-results", "json", "stack-trace", "generic"],
        describe: "force output type detection",
        default: "auto",
      })
      .option("max-tokens", {
        type: "number",
        describe: "max tokens for output",
        default: 24000,
      })
      .option("max-lines", {
        type: "number",
        describe: "max lines for output",
        default: 500,
      })
      .option("json", {
        type: "boolean",
        describe: "output JSON report",
        default: false,
      }),
  handler: Effect.fn("Cli.optimize.output")(function* (args) {
    const text = args.file
      ? fs.readFileSync(args.file, "utf-8")
      : yield* Effect.promise(() => readStdin())

    if (!text) {
      Console.log("  No input provided. Pipe text or provide a file.")
      Console.log("")
      return
    }

    const optimizer = new OutputOptimizer({
      maxOutputTokens: args.maxTokens,
      maxLines: args.maxLines,
    })

    const outputType = args.type === "auto" ? undefined : args.type
    const { text: optimized, report } = optimizer.optimize(text, outputType)

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }

    Console.log("")
    Console.log("  Output Optimization Report")
    Console.log("  " + "─".repeat(40))
    Console.log(`  Input tokens:     ${report.inputTokens.toLocaleString()}`)
    Console.log(`  Output tokens:    ${report.outputTokens.toLocaleString()}`)
    Console.log(`  Saved:            ${report.savedTokens.toLocaleString()} (${report.savedPercent.toFixed(1)}%)`)
    Console.log(`  Truncated:        ${report.truncated ? "⚠ yes" : "✓ no"}`)
    Console.log("")

    if (report.layers.length > 0) {
      Console.log("  Layers applied:")
      for (const layer of report.layers) {
        console.log(`    ✓ ${layer.name.padEnd(20)} saved ${layer.savedTokens.toLocaleString()} tok`)
      }
      Console.log("")
    }

    if (report.handle) {
      Console.log(`  Reversible handle: ${report.handle}`)
      Console.log(`  Restore with: obelisk optimize restore ${report.handle}`)
      Console.log("")
    }

    process.stdout.write(optimized + EOL)
  }),
})

const OptimizeRestoreCommand = effectCmd({
  command: "restore <handle>",
  describe: "restore original content from a reversible blob handle",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("handle", {
      type: "string",
      describe: "blob handle to restore",
    }),
  handler: Effect.fn("Cli.optimize.restore")(function* (args) {
    const store = new ReversibleBlobStore()
    const original = store.restore(args.handle)

    if (!original) {
      Console.log(`  Blob not found: ${args.handle}`)
      Console.log("")
      return
    }

    process.stdout.write(original + EOL)
  }),
})

const OptimizeStatsCommand = effectCmd({
  command: "stats",
  describe: "show blob store statistics",
  instance: false,
  handler: Effect.fn("Cli.optimize.stats")(function* () {
    const store = new ReversibleBlobStore()
    const stats = store.stats()

    Console.log("")
    Console.log("  Reversible Blob Store")
    Console.log("  " + "─".repeat(40))
    Console.log(`  Total blobs: ${stats.totalBlobs}`)
    Console.log(`  Total size:  ${formatBytes(stats.totalSizeBytes)}`)
    Console.log("")
  }),
})

const OptimizeGcCommand = effectCmd({
  command: "gc",
  describe: "garbage collect blobs older than N days",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("days", {
      type: "number",
      describe: "age threshold in days",
      default: 14,
    }),
  handler: Effect.fn("Cli.optimize.gc")(function* (args) {
    const store = new ReversibleBlobStore()
    const evicted = store.gc(args.days)
    Console.log(`  Evicted ${evicted} blob(s) older than ${args.days} days.`)
  }),
})

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = []
    const stdin = process.stdin
    if (stdin.isTTY) {
      resolve("")
      return
    }
    stdin.setEncoding("utf-8")
    stdin.on("data", (chunk: string) => chunks.push(chunk))
    stdin.on("end", () => resolve(chunks.join("")))
  })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}