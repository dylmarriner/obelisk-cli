import { EOL } from "os"
import { Effect } from "effect"
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

    console.log("")
    console.log(`  Searching for pattern "${args.pattern}" in ${args.lang} files...`)
    console.log("")

    try {
      const results = yield* Effect.promise(() =>
        adapter.find({
          pattern: args.pattern!,
          language: args.lang!,
          repoPath: args.path!,
          file: args.file,
        })
      )

      if (results.length === 0) {
        console.log("  No matches found.")
        console.log("")
        return
      }

      console.log(`  Found ${results.length} match(es):`)
      console.log("")

      for (const r of results.slice(0, 30)) {
        console.log(`    ${r.file}:${r.line}:${r.column}`)
        console.log(`    ${r.content.trim().substring(0, 120)}`)
        if (Object.keys(r.variables).length > 0) {
          console.log(`    Variables: ${JSON.stringify(r.variables)}`)
        }
        console.log("")
      }

      if (results.length > 30) {
        console.log(`  ... and ${results.length - 30} more matches`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Search failed: ${(err as Error).message}`)
      console.log("")
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

    console.log("")
    console.log(`  Previewing rewrite:`)
    console.log(`    Pattern:  ${args.pattern}`)
    console.log(`    Rewrite:  ${args.rewrite}`)
    console.log(`    Language: ${args.lang}`)
    console.log("")

    try {
      const preview = yield* Effect.promise(() =>
        adapter.rewrite({
          pattern: args.pattern!,
          rewrite: args.rewrite!,
          language: args.lang!,
          repoPath: args.path!,
        })
      )

      if (preview.changes.length === 0) {
        console.log("  No matches found. Nothing to rewrite.")
        console.log("")
        return
      }

      console.log(`  ${preview.summary}`)
      console.log("")

      // Show preview (first 10 changes)
      const showChanges = preview.changes.slice(0, 10)
      for (const change of showChanges) {
        console.log(`  ${change.file}:${change.line}`)
        console.log(`    - ${change.oldContent.trim().substring(0, 80)}`)
        console.log(`    + ${change.newContent.trim().substring(0, 80)}`)
        console.log("")
      }

      if (preview.changes.length > 10) {
        console.log(`  ... and ${preview.changes.length - 10} more changes`)
        console.log("")
      }

      if (preview.approvalRequired && !args.apply) {
        console.log("  ⚠ Approval required: ${preview.changes.length} changes across files.")
        console.log("  Run with --apply to apply the rewrite.")
        console.log("")
        return
      }

      if (args.apply) {
        console.log("  Applying rewrite...")
        console.log("")

        const result = yield* Effect.promise(() =>
          adapter.apply({
            previewId: `${args.pattern}|${args.rewrite}|${args.lang}|${args.path || process.cwd()}`,
          })
        )

        if (result.success) {
          console.log(`  ✓ Rewrite applied: ${result.filesChanged} file(s) changed`)
        } else {
          console.log(`  ✗ Rewrite failed: ${result.error}`)
        }
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Rewrite failed: ${(err as Error).message}`)
      console.log("")
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

    if (!args.rule && !args["rule-text"]) {
      console.log("")
      console.log("  Usage: obelisk ast scan --rule <rule-file>")
      console.log("         obelisk ast scan --rule-text '<yaml>'")
      console.log("")
      return
    }

    console.log("")
    console.log("  Scanning codebase with ast-grep rules...")
    console.log("")

    try {
      const issues = yield* Effect.promise(() =>
        adapter.scan({
          rule: args.rule!,
          ruleText: args["rule-text"],
          repoPath: args.path!,
        })
      )

      if (issues.length === 0) {
        console.log("  ✓ No issues found.")
        console.log("")
        return
      }

      const bySeverity = (sev: string) => issues.filter((i) => i.severity === sev)
      const errors = bySeverity("error")
      const warnings = bySeverity("warning")

      console.log(`  Found ${issues.length} issue(s):`)
      if (errors.length > 0) console.log(`    ${errors.length} error(s)`)
      if (warnings.length > 0) console.log(`    ${warnings.length} warning(s)`)
      console.log("")

      for (const issue of issues.slice(0, 20)) {
        const icon = issue.severity === "error" ? "✗" : "⚠"
        console.log(`    ${icon} ${issue.file}:${issue.line}:${issue.column}`)
        console.log(`      ${issue.message}`)
        console.log("")
      }

      if (issues.length > 20) {
        console.log(`  ... and ${issues.length - 20} more issues`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Scan failed: ${(err as Error).message}`)
      console.log("")
    }
  }),
})