import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { AgentOrchestrator } from "@obelisk-ai/orchestrator"

export const OrchestrateCommand = cmd({
  command: "orchestrate <query>",
  describe: "analyze a task and route it through the appropriate tools",
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
    const query = args.query
    const dryRun = args.dryRun
    const verbose = args.verbose

    // Step 1: Analyze
    Console.log("")
    Console.log(`  Analyzing: "${query}"`)
    Console.log("")

    const { classification, plan } = orchestrator.analyze(query)

    Console.log(`  Classification: ${classification.taskType}`)
    Console.log(`  Confidence:     ${(classification.confidence * 100).toFixed(0)}%`)
    Console.log("")

    // Step 2: Show the plan
    Console.log("  Execution Plan:")
    Console.log("  " + "─".repeat(40))
    Console.log(`  ${plan.description}`)
    Console.log("")

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
    Console.log("")

    if (plan.requiresApproval) {
      Console.log("  ⚠  This plan requires approval before execution.")
      Console.log("")
    }

    if (dryRun) {
      Console.log("  ── DRY RUN — no actions executed ──")
      Console.log("")
      return
    }

    // Step 3: Execute
    Console.log("  Executing plan...")
    Console.log("")

    const result = yield* Effect.promise(() => orchestrator.execute(query, { dryRun: false, verbose }))

    // Step 4: Report
    Console.log("  " + "─".repeat(40))
    Console.log(`  Result: ${result.summary}`)
    Console.log(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`)
    Console.log("")

    for (const step of result.executed) {
      const icon = step.success ? "✓" : "✗"
      console.log(`    ${icon}  Step ${step.step}: [${step.tool}]`)
      if (step.output && verbose) {
        console.log(`       ${step.output.substring(0, 120)}`)
      }
    }
    Console.log("")
  }),
})