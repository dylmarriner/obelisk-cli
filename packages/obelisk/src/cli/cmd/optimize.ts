import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import * as fs from "node:fs"
import { InputOptimizer, OutputOptimizer, ReversibleBlobStore, estimateTokens, AGGRESSIVE_OPTIONS, BALANCED_OPTIONS, SAFE_OPTIONS } from "@obelisk-ai/obelisk-core"

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
      .command(OptimizeBenchmarkCommand)
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
        default: "ultra",
      })
      .option("profile", {
        type: "string",
        choices: ["safe", "balanced", "aggressive"],
        describe: "compression profile (safe=40-60%, balanced=60-75%, aggressive=75-90%)",
        default: "aggressive",
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
      console.log("  No input provided. Pipe text or provide a file.")
      console.log("")
      return
    }

    const profileMap = {
      safe: SAFE_OPTIONS,
      balanced: BALANCED_OPTIONS,
      aggressive: AGGRESSIVE_OPTIONS,
    }
    const baseOptions = profileMap[args.profile as keyof typeof profileMap] || AGGRESSIVE_OPTIONS

    const optimizer = new InputOptimizer({
      ...baseOptions,
      terseLevel: args.terse as any,
      reversible: !args["no-reversible"],
    })

    const { text: optimized, report } = optimizer.optimize(text, args.file || "stdin")

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }

    console.log("")
    console.log("  Input Optimization Report")
    console.log("  " + "─".repeat(40))
    console.log(`  Input tokens:     ${report.inputTokens.toLocaleString()}`)
    console.log(`  Output tokens:    ${report.outputTokens.toLocaleString()}`)
    console.log(`  Saved:            ${report.savedTokens.toLocaleString()} (${report.savedPercent.toFixed(1)}%)`)
    console.log("")

    if (report.layers.length > 0) {
      console.log("  Layers applied:")
      for (const layer of report.layers) {
        const icon = layer.reversible ? "↩" : "→"
        console.log(`    ${icon} ${layer.name.padEnd(20)} saved ${layer.savedTokens.toLocaleString()} tok`)
      }
      console.log("")
    }

    if (report.handle) {
      console.log(`  Reversible handle: ${report.handle}`)
      console.log(`  Restore with: obelisk optimize restore ${report.handle}`)
      console.log("")
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
      console.log("  No input provided. Pipe text or provide a file.")
      console.log("")
      return
    }

    const optimizer = new OutputOptimizer({
      maxOutputTokens: args["max-tokens"],
      maxLines: args["max-lines"],
    })

    const outputType = args.type === "auto" ? undefined : args.type
    const { text: optimized, report } = optimizer.optimize(text, outputType)

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }

    console.log("")
    console.log("  Output Optimization Report")
    console.log("  " + "─".repeat(40))
    console.log(`  Input tokens:     ${report.inputTokens.toLocaleString()}`)
    console.log(`  Output tokens:    ${report.outputTokens.toLocaleString()}`)
    console.log(`  Saved:            ${report.savedTokens.toLocaleString()} (${report.savedPercent.toFixed(1)}%)`)
    console.log(`  Truncated:        ${report.truncated ? "⚠ yes" : "✓ no"}`)
    console.log("")

    if (report.layers.length > 0) {
      console.log("  Layers applied:")
      for (const layer of report.layers) {
        console.log(`    ✓ ${layer.name.padEnd(20)} saved ${layer.savedTokens.toLocaleString()} tok`)
      }
      console.log("")
    }

    if (report.handle) {
      console.log(`  Reversible handle: ${report.handle}`)
      console.log(`  Restore with: obelisk optimize restore ${report.handle}`)
      console.log("")
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
      demandOption: true,
    }),
  handler: Effect.fn("Cli.optimize.restore")(function* (args) {
    const store = new ReversibleBlobStore()
    const original = store.restore(args.handle)

    if (!original) {
      console.log(`  Blob not found: ${args.handle}`)
      console.log("")
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

    console.log("")
    console.log("  Reversible Blob Store")
    console.log("  " + "─".repeat(40))
    console.log(`  Total blobs: ${stats.totalBlobs}`)
    console.log(`  Total size:  ${formatBytes(stats.totalSizeBytes)}`)
    console.log("")
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
    console.log(`  Evicted ${evicted} blob(s) older than ${args.days} days.`)
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

// ─── Benchmark Command ──────────────────────────────────────────

const SAMPLE_TYPES = [
  {
    name: "code (TypeScript)",
    text: `import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { useRouter } from "next/router";
import { api } from "~/utils/api";
import { TRPCClientError } from "@trpc/client";
// This is a comment that should be stripped
const VERY_LONG_COMPONENT_NAME_FOR_TESTING_PURPOSES = () => {
  const [state, setState] = useState<string | null>(null);
  const router = useRouter();
  const utils = api.useUtils();
  useEffect(() => {
    // Another comment
    const fetchData = async () => {
      try {
        const result = await api.post.getAll.useQuery({ limit: 10, offset: 0, sort: "desc", filter: "all" });
        setState(JSON.stringify(result));
      } catch (err) {
        console.error("Failed to fetch data from the API endpoint:", err);
      }
    };
    fetchData();
  }, []);
  return <div>Hello World</div>;
};
export default VERY_LONG_COMPONENT_NAME_FOR_TESTING_PURPOSES;`,
    type: "code",
  },
  {
    name: "git diff",
    text: `diff --git a/src/auth.ts b/src/auth.ts
index abc123..def456 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -15,7 +15,7 @@ export class AuthService {
   constructor(private readonly db: Database) {}
 
   async login(email: string, password: string) {
-    const user = await this.db.findUserByEmail(email);
+    const user = await this.db.findUserByEmail(email.toLowerCase());
     if (!user) throw new AuthError("User not found");
     const valid = await verifyPassword(password, user.passwordHash);
     if (!valid) throw new AuthError("Invalid password");
@@ -45,7 +45,7 @@ export class AuthService {
   async register(email: string, password: string) {
     const existing = await this.db.findUserByEmail(email);
     if (existing) throw new AuthError("Email already registered");
-    const hash = await hashPassword(password);
+    const hash = await hashPassword(password, { rounds: 12 });
     return this.db.createUser({ email: email.toLowerCase(), passwordHash: hash });
   }
 }
`,
    type: "git-diff",
  },
  {
    name: "build log",
    text: `Compiling obelisk-core v0.1.0
Compiling obelisk v0.1.0
error[E0308]: mismatched types
  --> src/auth.ts:42:5
   |
42 |     return "hello"
   |            ^^^^^^^ expected number, found string
   |
   = note: expected type \`number\`
            found type \`&str\`

warning: unused variable: \`result\`
  --> src/utils.ts:10:9
   |
10 |     let result = compute();
   |         ^^^^^^ help: if you don't use \`result\`, use \`_\` instead

Compiling complete. 1 error, 1 warning emitted.
Finished dev [unoptimized + debuginfo] target(s) in 2.45s`,
    type: "build-log",
  },
  {
    name: "search results",
    text: `src/auth.ts:15:10: export class AuthService {
src/auth.ts:18:3:   constructor(private readonly db: Database)
src/auth.ts:22:3:   async login(email: string, password: string)
src/auth.ts:23:5:     const user = await this.db.findUserByEmail(email);
src/auth.ts:45:3:   async register(email: string, password: string)
src/auth.ts:46:5:     const existing = await this.db.findUserByEmail(email);
src/utils.ts:8:3:   export function compute(input: string): number
src/utils.ts:15:3:   export function formatOutput(data: Record<string, unknown>): string
src/utils.ts:22:3:   export function validateInput(schema: unknown, data: unknown): boolean`,
    type: "search-results",
  },
  {
    name: "JSON",
    text: JSON.stringify({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The request body contains invalid fields. Please check your input and try again.",
      details: {
        field: "email",
        value: "invalid-email",
        constraint: "must be a valid email address",
        docs: "https://docs.example.com/validation/email",
      },
      timestamp: "2026-07-09T12:00:00Z",
      requestId: "req-abc123def456ghi789jkl",
    }, null, 2),
    type: "json",
  },
]

const OptimizeBenchmarkCommand = effectCmd({
  command: "benchmark",
  describe: "run token optimization benchmarks against sample data",
  instance: false,
  handler: Effect.fn("Cli.optimize.benchmark")(function* () {
    console.log("")
    console.log("  Token Optimization Benchmark")
    console.log("  " + "═".repeat(50))
    console.log("")

    const profiles = [
      { name: "safe", options: SAFE_OPTIONS, expected: "40-60%" },
      { name: "balanced", options: BALANCED_OPTIONS, expected: "60-75%" },
      { name: "aggressive", options: AGGRESSIVE_OPTIONS, expected: "75-90%" },
    ]

    for (const sample of SAMPLE_TYPES) {
      console.log(`  ── ${sample.name} (${sample.type}) ──`)
      console.log("")

      for (const profile of profiles) {
        const optimizer = new InputOptimizer({ ...profile.options })
        const { report } = optimizer.optimize(sample.text, `benchmark-${sample.type}`)

        // Build a visual bar
        const barLen = 30
        const filled = Math.round((report.savedPercent / 100) * barLen)
        const bar = "█".repeat(filled) + "░".repeat(barLen - filled)

        console.log(`  ${profile.name.padEnd(12)} ${bar} ${report.savedPercent.toFixed(1)}% (expected ${profile.expected})`)
      }
      console.log("")
    }

    console.log("  " + "═".repeat(50))
    console.log("  Profile guide:")
    console.log("    safe       — 40-60% — comment stripping, basic dedup, blob detection")
    console.log("    balanced   — 60-75% — plus import compaction, terse prose, pattern folding")
    console.log("    aggressive — 75-90% — plus ultra terse, type compact, string truncate, code ws eliminate")
    console.log("  All profiles are reversible — originals stored in blob store.")
    console.log("")
  }),
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}