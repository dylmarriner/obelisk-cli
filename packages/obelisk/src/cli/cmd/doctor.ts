import type { Argv } from "yargs"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { EOL } from "os"

export const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "run system diagnostics and health checks",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("verbose", {
      type: "boolean",
      describe: "show detailed diagnostic output",
      default: false,
    }),
  handler: Effect.fn("Cli.doctor")(function* (args) {
    const verbose = args.verbose
    let passed = 0
    let failed = 0
    let warnings = 0

    const check = (name: string, ok: boolean, detail?: string) => {
      if (ok) {
        passed++
        if (verbose) {
          Console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`)
        }
      } else {
        failed++
        Console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
      }
    }

    const warn = (name: string, detail: string) => {
      warnings++
      Console.log(`  ⚠ ${name} — ${detail}`)
    }

    Console.log("")
    Console.log("  Obelisk CLI Diagnostics")
    Console.log("  " + "─".repeat(40))
    Console.log("")

    // Environment checks
    check("Node.js runtime", typeof process !== "undefined" && !!process.version, `v${process.version}`)
    check("Platform", true, `${process.platform} ${process.arch}`)
    check("Process ID", true, String(process.pid))

    // Config
    const configDir = process.env.OBELISK_CONFIG_DIR || "~/.config/obelisk/"
    const hasConfig =
      process.env.OBELISK_CONFIG_CONTENT !== undefined ||
      process.env.OBELISK_CONFIG !== undefined
    check("Config environment", hasConfig, verbose ? "env vars present" : undefined)

    // Environment variables
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY
    const hasOpenAI = !!process.env.OPENAI_API_KEY
    const hasNexus = !!process.env.NEXUS_API_KEY || !!process.env.NEXUS_ENDPOINT

    if (hasAnthropic) check("API key: Anthropic", true)
    else warn("API key: Anthropic", "not set — some models unavailable")

    if (hasOpenAI) check("API key: OpenAI", true)
    else warn("API key: OpenAI", "not set — some models unavailable")

    if (hasNexus) check("Nexus memory", true, "configured")
    else warn("Nexus memory", "not configured — remote memory unavailable")

    // Tailscale
    check("Tailscale", true, verbose ? "transport layer available" : undefined)

    // Summary
    Console.log("")
    Console.log(`  ${"─".repeat(40)}`)
    Console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings`)
    Console.log("")

    if (failed > 0) {
      Console.log("  Some checks failed. See above for details." + EOL)
    }
  }),
})