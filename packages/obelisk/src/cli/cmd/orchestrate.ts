import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import type { Argv } from "yargs"
import { AgentOrchestrator } from "@obelisk-ai/orchestrator"

export const OrchestrateCommand = effectCmd({
  command: "orchestrate <query>",
  describe: "analyze a task and route it through the appropriate tools",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("query", {
        type: "string",
        describe: "natural language task description",
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show the plan without executing",
        default: false,
      })
      .option("verbose", {
        type: "boolean",
        describe: "show detailed output",
        default: false,
      }),
  handler: Effect.fn("Cli.orchestrate")(function* (args) {
    const orchestrator = new AgentOrchestrator()
    const query = args.query!
    const dryRun = args["dry-run"]
    const verbose = args.verbose

    // Step 1: Analyze
    console.log("")
    console.log(`  Analyzing: "${query}"`)
    console.log("")

    const { classification, plan } = orchestrator.analyze(query!)

    console.log(`  Classification: ${classification.taskType}`)
    console.log(`  Confidence:     ${(classification.confidence * 100).toFixed(0)}%`)
    console.log("")

    // Step 2: Show the plan
    console.log("  Execution Plan:")
    console.log("  " + "─".repeat(40))
    console.log(`  ${plan.description}`)
    console.log("")

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      const icon = step.optional ? "◷" : "→"
      const required = step.optional ? "optional" : "required"
      console.log(`    ${icon}  Step ${i + 1}: [${step.tool}] ${step.action} (${required})`)
      if (verbose) {
        const paramStr = Object.entries(step.params)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => `      ${k}: ${v}`)
          .join("\n")
        if (paramStr) console.log(paramStr)
      }
    }
    console.log("")

    if (plan.requiresApproval) {
      console.log("  ⚠  This plan requires approval before execution.")
      console.log("")
    }

    if (dryRun) {
      console.log("  ── DRY RUN — no actions executed ──")
      console.log("")
      return
    }

    // Step 3: Execute
    console.log("  Executing plan...")
    console.log("")

    const result = yield* Effect.promise(() => orchestrator.execute(query!, { dryRun: false, verbose }))

    // Step 4: Report
    console.log("  " + "─".repeat(40))
    console.log(`  Result: ${result.summary}`)
    console.log(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`)
    console.log("")

    for (const step of result.executed) {
      const icon = step.success ? "✓" : "✗"
      console.log(`    ${icon}  Step ${step.step}: [${step.tool}]`)
      if (step.output && verbose) {
        console.log(`       ${step.output.substring(0, 120)}`)
      }
    }
    console.log("")
  }),
})