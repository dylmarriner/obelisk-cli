import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { AstGrepAdapter } from "@obelisk-ai/structural"

export const AstCommand = cmd({
  command: "ast",
  describe: "structural code search and refactoring with ast-grep",
  builder: (yargs: Argv) =>
    yargs
      .command(AstFindCommand)
      .command(AstRewriteCommand)
      .command(AstScanCommand)
      .demandCommand(),
  async handler() {},
})

const AstFindCommand = effectCmd({
  command: "find <pattern>",
  describe: "find code matching a structural AST pattern",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("pattern", {
        type: "string",
        describe: "AST pattern to search for (e.g. 'await $CALL($ARGS)')",
      })
      .option("lang", {
        type: "string",
        alias: "l",
        describe: "language of the pattern (ts, tsx, rust, py, go, java, etc.)",
        default: "ts",
      })
      .option("file", {
        type: "string",
        alias: "f",
        describe: "filter by file path/pattern",
      })
      .option("path", {
        type: "string",
        describe: "repository path to search (default: cwd)",
      }),
  handler: Effect.fn("Cli.ast.find")(function* (args) {
    const adapter = new AstGrepAdapter()

    Console.log("")
    Console.log(`  Searching for pattern "${args.pattern}" in ${args.lang} files...`)
    Console.log("")

    try {
      const results = yield* Effect.promise(() =>
        adapter.find({
          pattern: args.pattern,
          language: args.lang,
          repoPath: args.path,
          file: args.file,
        })
      )

      if (results.length === 0) {
        Console.log("  No matches found.")
        Console.log("")
        return
      }

      Console.log(`  Found ${results.length} match(es):`)
      Console.log("")

      for (const r of results.slice(0, 30)) {
        console.log(`    ${r.file}:${r.line}:${r.column}`)
        console.log(`    ${r.content.trim().substring(0, 120)}`)
        if (Object.keys(r.variables).length > 0) {
          console.log(`    Variables: ${JSON.stringify(r.variables)}`)
        }
        console.log("")
      }

      if (results.length > 30) {
        Console.log(`  ... and ${results.length - 30} more matches`)
        Console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Search failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const AstRewriteCommand = effectCmd({
  command: "rewrite <pattern> <rewrite>",
  describe: "preview and apply a structural AST rewrite",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("pattern", {
        type: "string",
        describe: "AST pattern to match (e.g. 'var $A = $B')",
      })
      .positional("rewrite", {
        type: "string",
        describe: "replacement expression (e.g. 'let $A = $B')",
      })
      .option("lang", {
        type: "string",
        alias: "l",
        describe: "language of the pattern",
        default: "ts",
      })
      .option("path", {
        type: "string",
        describe: "repository path (default: cwd)",
      })
      .option("apply", {
        type: "boolean",
        describe: "apply the rewrite without confirmation",
        default: false,
      }),
  handler: Effect.fn("Cli.ast.rewrite")(function* (args) {
    const adapter = new AstGrepAdapter()

    Console.log("")
    Console.log(`  Previewing rewrite:`)
    Console.log(`    Pattern:  ${args.pattern}`)
    Console.log(`    Rewrite:  ${args.rewrite}`)
    Console.log(`    Language: ${args.lang}`)
    Console.log("")

    try {
      const preview = yield* Effect.promise(() =>
        adapter.rewrite({
          pattern: args.pattern,
          rewrite: args.rewrite,
          language: args.lang,
          repoPath: args.path,
        })
      )

      if (preview.changes.length === 0) {
        Console.log("  No matches found. Nothing to rewrite.")
        Console.log("")
        return
      }

      Console.log(`  ${preview.summary}`)
      Console.log("")

      // Show preview (first 10 changes)
      const showChanges = preview.changes.slice(0, 10)
      for (const change of showChanges) {
        console.log(`  ${change.file}:${change.line}`)
        console.log(`    - ${change.oldContent.trim().substring(0, 80)}`)
        console.log(`    + ${change.newContent.trim().substring(0, 80)}`)
        console.log("")
      }

      if (preview.changes.length > 10) {
        Console.log(`  ... and ${preview.changes.length - 10} more changes`)
        Console.log("")
      }

      if (preview.approvalRequired && !args.apply) {
        Console.log("  ⚠ Approval required: ${preview.changes.length} changes across files.")
        Console.log("  Run with --apply to apply the rewrite.")
        Console.log("")
        return
      }

      if (args.apply) {
        Console.log("  Applying rewrite...")
        Console.log("")

        const result = yield* Effect.promise(() =>
          adapter.apply({
            previewId: `${args.pattern}|${args.rewrite}|${args.lang}|${args.path || process.cwd()}`,
          })
        )

        if (result.success) {
          Console.log(`  ✓ Rewrite applied: ${result.filesChanged} file(s) changed`)
        } else {
          Console.log(`  ✗ Rewrite failed: ${result.error}`)
        }
        Console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Rewrite failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const AstScanCommand = effectCmd({
  command: "scan",
  describe: "scan codebase with ast-grep rules",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("rule", {
        type: "string",
        alias: "r",
        describe: "path to a rule file",
      })
      .option("rule-text", {
        type: "string",
        describe: "inline rule YAML text",
      })
      .option("path", {
        type: "string",
        describe: "repository path to scan (default: cwd)",
      }),
  handler: Effect.fn("Cli.ast.scan")(function* (args) {
    const adapter = new AstGrepAdapter()

    if (!args.rule && !args.ruleText) {
      Console.log("")
      Console.log("  Usage: obelisk ast scan --rule <rule-file>")
      Console.log("         obelisk ast scan --rule-text '<yaml>'")
      Console.log("")
      return
    }

    Console.log("")
    Console.log("  Scanning codebase with ast-grep rules...")
    Console.log("")

    try {
      const issues = yield* Effect.promise(() =>
        adapter.scan({
          rule: args.rule,
          ruleText: args.ruleText,
          repoPath: args.path,
        })
      )

      if (issues.length === 0) {
        Console.log("  ✓ No issues found.")
        Console.log("")
        return
      }

      const bySeverity = (sev: string) => issues.filter((i) => i.severity === sev)
      const errors = bySeverity("error")
      const warnings = bySeverity("warning")

      Console.log(`  Found ${issues.length} issue(s):`)
      if (errors.length > 0) Console.log(`    ${errors.length} error(s)`)
      if (warnings.length > 0) Console.log(`    ${warnings.length} warning(s)`)
      Console.log("")

      for (const issue of issues.slice(0, 20)) {
        const icon = issue.severity === "error" ? "✗" : "⚠"
        console.log(`    ${icon} ${issue.file}:${issue.line}:${issue.column}`)
        console.log(`      ${issue.message}`)
        console.log("")
      }

      if (issues.length > 20) {
        Console.log(`  ... and ${issues.length - 20} more issues`)
        Console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Scan failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})