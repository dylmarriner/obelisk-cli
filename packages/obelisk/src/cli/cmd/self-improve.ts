import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { SelfImprovementEngine, LearningTracker, SkillGenerator, AutoTriggerEngine, MemoryAugmentedLearning, AutoScheduler } from "@obelisk-ai/self-improve"

export const SelfImproveCommand = cmd({
  command: "self-improve",
  describe: "analyze, improve, and propose changes to the codebase",
  builder: (yargs: Argv) =>
    yargs
      .command(SelfImproveRunCommand)
      .command(SelfImproveScanCommand)
      .command(SelfImproveLearningsCommand)
      .command(SelfImproveEnableCommand)
      .command(SelfImproveDisableCommand)
      .command(SelfImproveSkillsCommand)
      .command(SelfImproveMetaCommand)
      .command(SelfImproveTriggerCommand)
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

    console.log("")
    console.log("  🔄 Self-Improvement Cycle")
    console.log("  " + "─".repeat(40))
    console.log("")

    // Scan phase
    console.log("  Phase 1: Scanning codebase for improvements...")
    console.log("")

    const result = yield* Effect.promise(() =>
      engine.runCycle({
        autoApply: args["auto-apply"],
        createPR: args["create-pr"],
        branch: args.branch,
      })
    )

    const plan = result.plan

    // Report findings
    if (plan.findings.length === 0) {
      console.log("  ✓ No improvements found — codebase is clean!")
      console.log("")
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

    console.log(`  Found ${plan.findings.length} improvement(s):`)
    console.log("")

    for (const [cat, items] of byCategory) {
      const errors = items.filter((i) => i.severity === "error").length
      const warnings = items.filter((i) => i.severity === "warning").length
      const info = items.filter((i) => i.severity === "info").length
      const sev = errors > 0 ? ` ✗${errors}` : warnings > 0 ? ` ⚠${warnings}` : ` ℹ${info}`
      console.log(`    ${cat.padEnd(15)} ${items.length} finding(s)${sev}`)
    }
    console.log("")

    // Auto-fixable
    if (plan.autoFixable.length > 0) {
      console.log(`  Auto-fixable: ${plan.autoFixable.length}`)
      if (args["auto-apply"]) {
        console.log(`  Applied: ${result.applied}`)
      }
      console.log("")
    }

    // Needs review
    if (plan.requiresHumanReview.length > 0) {
      console.log(`  Needs review: ${plan.requiresHumanReview.length}`)
      for (const f of plan.requiresHumanReview.slice(0, 5)) {
        const loc = f.file ? ` ${f.file}:${f.line}` : ""
        console.log(`    ${f.severity === "error" ? "✗" : "⚠"} ${f.title}${loc}`)
      }
      if (plan.requiresHumanReview.length > 5) {
        console.log(`    ... and ${plan.requiresHumanReview.length - 5} more`)
      }
      console.log("")
    }

    // Validation
    console.log(`  Validation: ${result.validationPassed ? "✓ passed" : "✗ failed"}`)

    // PR info
    if (result.branchName) {
      console.log(`  Branch:    ${result.branchName}`)
      if (result.prUrl) {
        console.log(`  PR:        ${result.prUrl}`)
        console.log("  Review and merge at your discretion.")
      }
    }

    console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
    console.log("")
  }),
})

const SelfImproveScanCommand = effectCmd({
  command: "scan",
  describe: "scan codebase for improvement opportunities without making changes",
  instance: false,
  handler: Effect.fn("Cli.self-improve.scan")(function* () {
    const engine = new SelfImprovementEngine()

    console.log("")
    console.log("  Scanning codebase for improvements...")
    console.log("")

    const plan = yield* Effect.promise(() => engine.scan())

    if (plan.findings.length === 0) {
      console.log("  ✓ No improvements found!")
      console.log("")
      return
    }

    console.log(`  ${plan.summary}`)
    console.log("")

    for (const f of plan.findings) {
      const icon = f.severity === "error" ? "✗" : f.severity === "warning" ? "⚠" : "ℹ"
      const loc = f.file ? ` (${f.file}:${f.line})` : ""
      const autoIcon = f.autoFixable ? " 🔧" : ""
      console.log(`  ${icon} [${f.category}] ${f.title}${loc}${autoIcon}`)
    }
    console.log("")
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

    console.log("")
    console.log("  Learning Tracker")
    console.log("  " + "─".repeat(40))
    console.log(`  Total learnings: ${stats.total}`)
    console.log("")

    if (stats.total > 0) {
      console.log("  By type:")
      for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${type.padEnd(25)} ${count}`)
      }
      console.log("")

      console.log("  Recent:")
      for (const l of stats.recent) {
        console.log(`    ${l.timestamp.substring(0, 19)} ${l.content.substring(0, 60)}`)
      }
      console.log("")
    }
  }),
})

const SelfImproveEnableCommand = effectCmd({
  command: "enable",
  describe: "enable autonomous, periodic self-improvement for this repo",
  instance: false,
  handler: Effect.fn("Cli.self-improve.enable")(function* () {
    console.log("")
    console.log("  Enabling self-improvement for this repository...")
    console.log("")

    AutoScheduler.enable()

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

    console.log("  ✓ Self-improvement enabled")
    console.log("")
    console.log("  While enabled, any obelisk process running in this repo will")
    console.log("  automatically run a scan → auto-apply → PR cycle roughly once")
    console.log("  an hour in the background — no need to run `self-improve run`")
    console.log("  yourself. Changes always land as a PR on a new branch, never")
    console.log("  pushed directly to your current branch.")
    console.log("")
    console.log("  The engine tracks:")
    console.log("    • Lint errors and warnings")
    console.log("    • Type checking issues")
    console.log("    • Documentation gaps")
    console.log("    • Tech debt markers (TODO, FIXME, HACK)")
    console.log("    • Deprecation notices")
    console.log("")
    console.log("  Disable with:")
    console.log("    obelisk self-improve disable")
    console.log("")
  }),
})

const SelfImproveDisableCommand = effectCmd({
  command: "disable",
  describe: "disable autonomous self-improvement for this repo",
  instance: false,
  handler: Effect.fn("Cli.self-improve.disable")(function* () {
    AutoScheduler.disable()
    console.log("")
    console.log("  ✓ Self-improvement disabled")
    console.log("")
  }),
})

// ─── Skills Command ─────────────────────────────────────────────

const SelfImproveSkillsCommand = cmd({
  command: "skills",
  describe: "generate and manage auto-discovered skills from learnings",
  builder: (yargs: Argv) =>
    yargs
      .command(SkillsGenerateCommand)
      .command(SkillsListCommand)
      .demandCommand(),
  async handler() {},
})

const SkillsGenerateCommand = effectCmd({
  command: "generate",
  describe: "generate new skills from recent learnings",
  instance: false,
  handler: Effect.fn("Cli.self-improve.skills.generate")(function* () {
    const tracker = new LearningTracker()
    const generator = new SkillGenerator()

    console.log("")
    console.log("  Generating skills from learnings...")
    console.log("")

    const learnings = yield* Effect.promise(() => tracker.recent(100))
    if (learnings.length === 0) {
      console.log("  No learnings available yet. Run some commands first.")
      console.log("")
      return
    }

    const result = yield* Effect.promise(() => generator.generateFromLearnings(learnings))

    if (result.created.length > 0) {
      console.log(`  ✓ Created ${result.created.length} new skill(s):`)
      for (const skill of result.created) {
        console.log(`    ${skill.meta.name} — ${skill.meta.description}`)
      }
      console.log("")
    }

    if (result.updated.length > 0) {
      console.log(`  ✓ Updated ${result.updated.length} existing skill(s)`)
      console.log("")
    }

    if (result.skipped > 0) {
      console.log(`  ⚠ ${result.skipped} pattern(s) skipped (below confidence threshold)`)
      console.log("")
    }

    if (result.created.length === 0 && result.updated.length === 0) {
      console.log("  No new skills generated. Existing skills are up to date.")
      console.log("")
    }
  }),
})

const SkillsListCommand = effectCmd({
  command: "list",
  describe: "list all auto-generated skills",
  instance: false,
  handler: Effect.fn("Cli.self-improve.skills.list")(function* () {
    const generator = new SkillGenerator()
    const skills = generator.listSkills()

    console.log("")
    console.log("  Auto-Generated Skills")
    console.log("  " + "─".repeat(40))
    console.log("")

    if (skills.length === 0) {
      console.log("  No auto-generated skills found.")
      console.log("")
      return
    }

    for (const skill of skills) {
      console.log(`  ${skill.meta.name}`)
      console.log(`    ${skill.meta.description}`)
      console.log(`    Source: ${skill.meta.source}  |  Version: ${skill.meta.version || 1}`)
      if (skill.meta.triggers?.length) {
        console.log(`    Triggers: ${skill.meta.triggers.join(", ")}`)
      }
      console.log("")
    }
  }),
})

// ─── Meta Learning Command ──────────────────────────────────────

const SelfImproveMetaCommand = effectCmd({
  command: "meta",
  describe: "show meta-learning state and scanner performance",
  instance: false,
  handler: Effect.fn("Cli.self-improve.meta")(function* () {
    const tracker = new LearningTracker()
    const meta = new MemoryAugmentedLearning(tracker)

    console.log("")
    console.log("  Meta-Learning State")
    console.log("  " + "─".repeat(40))
    console.log("")

    const state = yield* Effect.promise(() => meta.getState())

    console.log(`  Cycles completed: ${state.cycleCount}`)
    if (state.lastCycleOutcome) {
      const o = state.lastCycleOutcome
      console.log(`  Last cycle: ${o.findingsCount} findings, ${o.autoFixedCount} auto-fixed`)
      console.log(`  Validation: ${o.validationPassed ? "✓ passed" : "✗ failed"}`)
      console.log(`  PR created: ${o.prCreated ? "✓ yes" : "— no"}`)
      if (o.prAccepted !== undefined) {
        console.log(`  PR accepted: ${o.prAccepted ? "✓ yes" : "✗ no"}`)
      }
    }
    console.log("")

    console.log("  Scanner Priorities:")
    const priorities = meta.getScannerPriorities()
    for (const p of priorities) {
      const icon = p.priority === "high" ? "✓" : p.priority === "medium" ? "→" : "↓"
      console.log(`    ${icon} ${p.scanner.padEnd(15)} ${p.priority}`)
    }
    console.log("")

    if (state.learnedPatterns.length > 0) {
      console.log(`  Learned patterns: ${state.learnedPatterns.length}`)
      for (const p of state.learnedPatterns.slice(0, 5)) {
        console.log(`    • ${p.substring(0, 80)}`)
      }
      console.log("")
    }

    if (state.prunedPatterns.length > 0) {
      console.log(`  Pruned patterns: ${state.prunedPatterns.length}`)
    }
  }),
})

// ─── Trigger Command ────────────────────────────────────────────

const SelfImproveTriggerCommand = effectCmd({
  command: "trigger",
  describe: "check which skills would be auto-triggered in current context",
  instance: false,
  handler: Effect.fn("Cli.self-improve.trigger")(function* () {
    const engine = new AutoTriggerEngine()
    const tracker = new LearningTracker()

    console.log("")
    console.log("  Auto-Trigger Evaluation")
    console.log("  " + "─".repeat(40))
    console.log("")

    const recentLearnings = yield* Effect.promise(() => tracker.recent(20))

    const context = {
      command: process.argv.slice(2).join(" "),
      cwd: process.cwd(),
      recentLearnings,
    }

    const matches = engine.evaluate(context)

    if (matches.length === 0) {
      console.log("  No matching skills for current context.")
      console.log("")
      return
    }

    console.log(`  Found ${matches.length} matching skill(s):`)
    console.log("")

    for (const match of matches.slice(0, 10)) {
      const confidence = (match.confidence * 100).toFixed(0)
      const autoTrigger = match.confidence >= 0.7 ? " 🔧 auto" : ""
      console.log(`  ${confidence}%  ${match.skillName}${autoTrigger}`)
      console.log(`       ${match.reason}`)
    }
    console.log("")
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