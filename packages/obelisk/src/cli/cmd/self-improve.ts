import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { SelfImprovementEngine, LearningTracker } from "@obelisk-ai/self-improve"

export const SelfImproveCommand = cmd({
  command: "self-improve",
  describe: "analyze, improve, and propose changes to the codebase",
  builder: (yargs: Argv) =>
    yargs
      .command(SelfImproveRunCommand)
      .command(SelfImproveScanCommand)
      .command(SelfImproveLearningsCommand)
      .command(SelfImproveEnableCommand)
      .demandCommand(),
  async handler() {},
})

const SelfImproveRunCommand = effectCmd({
  command: "run",
  describe: "run a full improvement cycle — scan, fix, validate, and propose PR",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("auto-apply", {
        type: "boolean",
        describe: "automatically apply auto-fixable changes",
        default: false,
      })
      .option("create-pr", {
        type: "boolean",
        describe: "create a PR with the changes on a new branch",
        default: false,
      })
      .option("branch", {
        type: "string",
        describe: "branch name for the PR (default: auto-improve/<timestamp>)",
      }),
  handler: Effect.fn("Cli.self-improve.run")(function* (args) {
    const engine = new SelfImprovementEngine()

    Console.log("")
    Console.log("  🔄 Self-Improvement Cycle")
    Console.log("  " + "─".repeat(40))
    Console.log("")

    // Scan phase
    Console.log("  Phase 1: Scanning codebase for improvements...")
    Console.log("")

    const result = yield* Effect.promise(() =>
      engine.runCycle({
        autoApply: args.autoApply,
        createPR: args.createPR,
        branch: args.branch,
      })
    )

    const plan = result.plan

    // Report findings
    if (plan.findings.length === 0) {
      Console.log("  ✓ No improvements found — codebase is clean!")
      Console.log("")
      return
    }

    // Group by category
    const byCategory = new Map<string, ImprovementFinding[]>()
    for (const f of plan.findings) {
      const cat = f.category
      const list = byCategory.get(cat) || []
      list.push(f)
      byCategory.set(cat, list)
    }

    Console.log(`  Found ${plan.findings.length} improvement(s):`)
    Console.log("")

    for (const [cat, items] of byCategory) {
      const errors = items.filter((i) => i.severity === "error").length
      const warnings = items.filter((i) => i.severity === "warning").length
      const info = items.filter((i) => i.severity === "info").length
      const sev = errors > 0 ? ` ✗${errors}` : warnings > 0 ? ` ⚠${warnings}` : ` ℹ${info}`
      console.log(`    ${cat.padEnd(15)} ${items.length} finding(s)${sev}`)
    }
    Console.log("")

    // Auto-fixable
    if (plan.autoFixable.length > 0) {
      Console.log(`  Auto-fixable: ${plan.autoFixable.length}`)
      if (args.autoApply) {
        Console.log(`  Applied: ${result.applied}`)
      }
      Console.log("")
    }

    // Needs review
    if (plan.requiresHumanReview.length > 0) {
      Console.log(`  Needs review: ${plan.requiresHumanReview.length}`)
      for (const f of plan.requiresHumanReview.slice(0, 5)) {
        const loc = f.file ? ` ${f.file}:${f.line}` : ""
        console.log(`    ${f.severity === "error" ? "✗" : "⚠"} ${f.title}${loc}`)
      }
      if (plan.requiresHumanReview.length > 5) {
        Console.log(`    ... and ${plan.requiresHumanReview.length - 5} more`)
      }
      Console.log("")
    }

    // Validation
    Console.log(`  Validation: ${result.validationPassed ? "✓ passed" : "✗ failed"}`)

    // PR info
    if (result.branchName) {
      Console.log(`  Branch:    ${result.branchName}`)
      if (result.prUrl) {
        Console.log(`  PR:        ${result.prUrl}`)
        Console.log("  Review and merge at your discretion.")
      }
    }

    Console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
    Console.log("")
  }),
})

const SelfImproveScanCommand = effectCmd({
  command: "scan",
  describe: "scan codebase for improvement opportunities without making changes",
  instance: false,
  handler: Effect.fn("Cli.self-improve.scan")(function* () {
    const engine = new SelfImprovementEngine()

    Console.log("")
    Console.log("  Scanning codebase for improvements...")
    Console.log("")

    const plan = yield* Effect.promise(() => engine.scan())

    if (plan.findings.length === 0) {
      Console.log("  ✓ No improvements found!")
      Console.log("")
      return
    }

    Console.log(`  ${plan.summary}`)
    Console.log("")

    for (const f of plan.findings) {
      const icon = f.severity === "error" ? "✗" : f.severity === "warning" ? "⚠" : "ℹ"
      const loc = f.file ? ` (${f.file}:${f.line})` : ""
      const autoIcon = f.autoFixable ? " 🔧" : ""
      console.log(`  ${icon} [${f.category}] ${f.title}${loc}${autoIcon}`)
    }
    Console.log("")
  }),
})

const SelfImproveLearningsCommand = effectCmd({
  command: "learnings",
  describe: "show tracked learnings and observations",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("type", {
      type: "string",
      describe: "filter by learning type",
    }),
  handler: Effect.fn("Cli.self-improve.learnings")(function* (args) {
    const tracker = new LearningTracker()
    const stats = yield* Effect.promise(() => tracker.stats())

    Console.log("")
    Console.log("  Learning Tracker")
    Console.log("  " + "─".repeat(40))
    Console.log(`  Total learnings: ${stats.total}`)
    Console.log("")

    if (stats.total > 0) {
      Console.log("  By type:")
      for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${type.padEnd(25)} ${count}`)
      }
      Console.log("")

      Console.log("  Recent:")
      for (const l of stats.recent) {
        console.log(`    ${l.timestamp.substring(0, 19)} ${l.content.substring(0, 60)}`)
      }
      Console.log("")
    }
  }),
})

const SelfImproveEnableCommand = effectCmd({
  command: "enable",
  describe: "enable periodic self-improvement for this repo",
  instance: false,
  handler: Effect.fn("Cli.self-improve.enable")(function* () {
    const engine = new SelfImprovementEngine()

    Console.log("")
    Console.log("  Enabling self-improvement for this repository...")
    Console.log("")

    // Record an enablement learning
    const tracker = new LearningTracker()
    yield* Effect.promise(() =>
      tracker.record({
        type: "self-improve-enabled",
        content: "Self-improvement enabled for this repository",
        context: `Repo: ${process.cwd()}`,
        tags: ["self-improve", "enabled"],
        source: "self-improve",
      })
    )

    Console.log("  ✓ Self-improvement enabled")
    Console.log("")
    Console.log("  The engine will now track:")
    Console.log("    • Lint errors and warnings")
    Console.log("    • Type checking issues")
    Console.log("    • Documentation gaps")
    Console.log("    • Tech debt markers (TODO, FIXME, HACK)")
    Console.log("    • Deprecation notices")
    Console.log("")
    Console.log("  Run a cycle with:")
    Console.log("    obelisk self-improve run")
    Console.log("")
    Console.log("  Or scan without changes:")
    Console.log("    obelisk self-improve scan")
    Console.log("")
  }),
})

interface ImprovementFinding {
  category: string
  severity: string
  title: string
  file?: string
  line?: number
  autoFixable: boolean
}