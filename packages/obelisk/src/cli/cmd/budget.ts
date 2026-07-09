import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { TokenBudgetManager, PolicyEngine, estimateTokens, DEFAULT_BUDGET_CONFIG, DEFAULT_POLICY_CONFIG } from "@obelisk-ai/obelisk-core"

export const BudgetCommand = cmd({
  command: "budget",
  describe: "inspect and manage token budgets",
  builder: (yargs: Argv) =>
    yargs
      .command(BudgetInspectCommand)
      .command(BudgetExplainCommand)
      .command(BudgetSetCommand)
      .demandCommand(),
  async handler() {},
})

const BudgetInspectCommand = effectCmd({
  command: "inspect",
  describe: "show current token budget and usage",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("text", {
        type: "string",
        describe: "text to estimate tokens for",
      })
      .option("code", {
        type: "boolean",
        describe: "treat text as code for more accurate estimation",
        default: false,
      }),
  handler: Effect.fn("Cli.budget.inspect")(function* (args) {
    const budget = new TokenBudgetManager()
    const config = budget.getConfig()

    Console.log("")
    Console.log("  Token Budget Configuration")
    Console.log("  " + "─".repeat(40))
    Console.log(`  Max input tokens:         ${config.maxInputTokens.toLocaleString()}`)
    Console.log(`  Reserve output tokens:    ${config.reserveOutputTokens.toLocaleString()}`)
    Console.log(`  Max tool result tokens:   ${config.maxToolResultTokens.toLocaleString()}`)
    Console.log(`  Compaction threshold:     ${(config.compactionThreshold * 100).toFixed(0)}%`)
    Console.log(`  Context policy:           ${config.contextPolicy}`)
    Console.log("")

    if (args.text) {
      const estimated = estimateTokens(args.text, args.code)
      Console.log(`  Text: "${args.text.substring(0, 60)}..."`)
      Console.log(`  Estimated tokens: ${estimated.toLocaleString()} (${args.code ? "code" : "text"})`)
      Console.log("")
    }

    const sources = [
      { name: "System prompt", tokens: 2500, percentage: 0, isCode: false },
      { name: "Session history", tokens: 45000, percentage: 0, isCode: false },
      { name: "Tool results", tokens: 12000, percentage: 0, isCode: true },
      { name: "User input", tokens: 500, percentage: 0, isCode: false },
    ]

    const report = budget.inspect(sources)
    Console.log("  Example usage breakdown:")
    for (const src of report.sources) {
      const pct = ((src.tokens / config.maxInputTokens) * 100).toFixed(1)
      Console.log(`    ${src.name.padEnd(20)} ${src.tokens.toLocaleString().padStart(8)} tok (${pct}%)`)
    }
    Console.log("")
    Console.log(`  Total:     ${report.totalTokens.toLocaleString()}`)
    Console.log(`  Available: ${report.availableTokens.toLocaleString()}`)
    Console.log(`  Used:      ${report.usedPercentage.toFixed(1)}%`)
    Console.log(`  Exceeds:   ${report.exceedsBudget ? "⚠ YES" : "✓ no"}`)
    Console.log(`  Compact:   ${report.needsCompaction ? "⚠ recommended" : "✓ not needed"}`)
    Console.log("")
  }),
})

const BudgetExplainCommand = effectCmd({
  command: "explain",
  describe: "get a compaction suggestion for current context",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("tokens", {
      type: "number",
      describe: "current context token count",
      default: 95000,
    }),
  handler: Effect.fn("Cli.budget.explain")(function* (args) {
    const budget = new TokenBudgetManager()
    const sources = [
      { name: "System prompt", tokens: 2500, percentage: 0, isCode: false },
      { name: "Session history", tokens: args.tokens - 4500, percentage: 0, isCode: false },
      { name: "Tool results", tokens: 1500, percentage: 0, isCode: true },
      { name: "User input", tokens: 500, percentage: 0, isCode: false },
    ]

    const report = budget.inspect(sources)
    const suggestion = budget.getCompactionSuggestion(report)

    Console.log("")
    Console.log("  Budget Analysis")
    Console.log("  " + "─".repeat(40))
    Console.log(`  Current context: ${report.totalTokens.toLocaleString()} tokens`)
    Console.log(`  Budget limit:    ${report.availableTokens.toLocaleString()} tokens`)
    Console.log(`  Status:          ${report.needsCompaction ? "⚠ Over threshold" : "✓ Within budget"}`)
    Console.log("")

    if (suggestion.recommended) {
      Console.log(`  Recommendation: ${suggestion.reason}`)
      Console.log(`  Free up: ${suggestion.estimatedTokensToFree.toLocaleString()} tokens`)
      Console.log("")
      Console.log("  Suggested actions:")
      for (const action of suggestion.suggestedActions) {
        Console.log(`    • ${action}`)
      }
      Console.log("")
    } else {
      Console.log("  ✓ No compaction needed.")
      Console.log("")
    }
  }),
})

const BudgetSetCommand = effectCmd({
  command: "set",
  describe: "update token budget configuration",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("max-input", {
        type: "number",
        describe: "max input tokens",
      })
      .option("reserve-output", {
        type: "number",
        describe: "reserved output tokens",
      })
      .option("max-tool-result", {
        type: "number",
        describe: "max tool result tokens",
      })
      .option("policy", {
        type: "string",
        choices: ["compact-first", "warn-only", "strict-truncate"],
        describe: "context policy",
      }),
  handler: Effect.fn("Cli.budget.set")(function* (args) {
    const budget = new TokenBudgetManager()
    const updates: string[] = []

    if (args.maxInput) {
      budget.updateConfig({ maxInputTokens: args.maxInput })
      updates.push(`maxInputTokens: ${args.maxInput}`)
    }
    if (args.reserveOutput) {
      budget.updateConfig({ reserveOutputTokens: args.reserveOutput })
      updates.push(`reserveOutputTokens: ${args.reserveOutput}`)
    }
    if (args.maxToolResult) {
      budget.updateConfig({ maxToolResultTokens: args.maxToolResult })
      updates.push(`maxToolResultTokens: ${args.maxToolResult}`)
    }
    if (args.policy) {
      budget.updateConfig({ contextPolicy: args.policy as any })
      updates.push(`contextPolicy: ${args.policy}`)
    }

    if (updates.length > 0) {
      Console.log("")
      Console.log("  Updated budget configuration:")
      for (const update of updates) {
        Console.log(`    ✓ ${update}`)
      }
      Console.log("")
      Console.log("  Note: These changes apply only to the current session.")
      Console.log("  To persist, update obelisk.config.jsonc.")
      Console.log("")
    }
  }),
})

export const PolicyCommand = cmd({
  command: "policy",
  describe: "manage execution policies",
  builder: (yargs: Argv) =>
    yargs
      .command(PolicyShowCommand)
      .command(PolicyTestCommand)
      .demandCommand(),
  async handler() {},
})

const PolicyShowCommand = effectCmd({
  command: "show",
  describe: "show current policy configuration",
  instance: false,
  handler: Effect.fn("Cli.policy.show")(function* () {
    const policy = new PolicyEngine()
    const summary = policy.getSummary()

    Console.log("")
    Console.log("  Policy Configuration")
    Console.log("  " + "─".repeat(40))
    for (const [key, value] of Object.entries(summary)) {
      const display = typeof value === "boolean" ? (value ? "✓ enabled" : "✗ disabled") : String(value)
      Console.log(`  ${key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).padEnd(35)} ${display}`)
    }
    Console.log("")
  }),
})

const PolicyTestCommand = effectCmd({
  command: "test <action> <target>",
  describe: "test a policy rule against an action",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["shell", "file-read", "file-write", "file-delete", "network", "env-read"],
        describe: "type of action to test",
      })
      .positional("target", {
        type: "string",
        describe: "action target (file path, command, URL, env var name)",
      }),
  handler: Effect.fn("Cli.policy.test")(function* (args) {
    const policy = new PolicyEngine()
    const action = { type: args.action as any, target: args.target }
    const result = policy.explain(action)

    Console.log("")
    Console.log("  Policy Evaluation")
    Console.log("  " + "─".repeat(40))
    for (const line of result.split("\n")) {
      Console.log(`  ${line}`)
    }
    Console.log("")
  }),
})