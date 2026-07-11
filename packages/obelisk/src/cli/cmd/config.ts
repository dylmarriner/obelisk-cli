import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"

export const ConfigCommand = cmd({
  command: "config",
  describe: "manage configuration",
  builder: (yargs: Argv) =>
    yargs
      .command(ConfigGetCommand)
      .command(ConfigDoctorCommand)
      .demandCommand(),
  async handler() {},
})

const ConfigGetCommand = effectCmd({
  command: "get [key]",
  describe: "show resolved configuration value for a key, or the full config",
  builder: (yargs: Argv) =>
    yargs
      .positional("key", {
        type: "string",
        describe: "config key path (e.g. nexus.endpoint, models.default)",
      })
      .option("json", {
        type: "boolean",
        describe: "output raw JSON",
        default: false,
      }),
  handler: Effect.fn("Cli.config.get")(function* (args) {
    const fs = yield* Effect.promise(() => import("fs"))
    const pathMod = yield* Effect.promise(() => import("path"))
    const configPath = pathMod.default.resolve(process.cwd(), "obelisk.config.jsonc")
    let config: Record<string, unknown> = {}
    try {
      const raw = fs.readFileSync(configPath, "utf-8")
      const jsonc = yield* Effect.promise(() => import("jsonc-parser"))
      config = jsonc.parse(raw) || {}
    } catch {
      // No config file found, use empty config
      console.log("  No configuration file found at obelisk.config.jsonc" + EOL)
      return
    }

    const key = args.key
    if (!key) {
      if (args.json) {
        process.stdout.write(JSON.stringify(config, null, 2) + EOL)
      } else {
        console.log("")
        console.log("  Resolved Configuration")
        console.log("  " + "─".repeat(40))
        console.log("")
        console.log(JSON.stringify(config, null, 2))
        console.log("")
      }
      return
    }

    const parts = key.split(".")
    let value: unknown = config
    for (const part of parts) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        value = (value as Record<string, unknown>)[part]
      } else {
        value = undefined
        break
      }
    }

    if (value === undefined) {
      console.log(`  Key "${key}" not found in configuration.` + EOL)
      return
    }

    if (args.json) {
      process.stdout.write(JSON.stringify(value, null, 2) + EOL)
    } else {
      console.log(`  ${key}: ${typeof value === "string" ? value : JSON.stringify(value, null, 2)}` + EOL)
    }
  }),
})

const ConfigDoctorCommand = effectCmd({
  command: "doctor",
  describe: "validate configuration and report issues",
  instance: false,
  handler: Effect.fn("Cli.config.doctor")(function* () {
    const fs = yield* Effect.promise(() => import("fs"))
    const pathMod = yield* Effect.promise(() => import("path"))
    const configPath = pathMod.default.resolve(process.cwd(), "obelisk.config.jsonc")
    let config: Record<string, unknown> = {}
    try {
      const raw = fs.readFileSync(configPath, "utf-8")
      const jsonc = yield* Effect.promise(() => import("jsonc-parser"))
      config = jsonc.parse(raw) || {}
    } catch {
      console.log("")
      console.log("  Configuration Diagnostics")
      console.log("  " + "─".repeat(40))
      console.log("")
      console.log("  ✗ No configuration file found at obelisk.config.jsonc")
      console.log("")
      return
    }

    let passed = 0
    let failed = 0
    let warnings = 0

    const check = (name: string, ok: boolean, detail?: string) => {
      if (ok) {
        passed++
        if (detail) console.log(`  ✓ ${name} — ${detail}`)
      } else {
        failed++
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
      }
    }

    const warn = (name: string, detail: string) => {
      warnings++
      console.log(`  ⚠ ${name} — ${detail}`)
    }

    console.log("")
    console.log("  Configuration Diagnostics")
    console.log("  " + "─".repeat(40))
    console.log("")

    // Check model configuration
    const model = (config as Record<string, unknown>).model
    const defaultModel = (config as Record<string, unknown>).default_agent
    check("Default model configured", !!model, model as string)
    check("Default agent configured", !!defaultModel, defaultModel as string)

    // Check provider configuration
    const providers = (config as Record<string, unknown>).provider as Record<string, unknown> | undefined
    if (providers && Object.keys(providers).length > 0) {
      check("Providers configured", true, `${Object.keys(providers).length} provider(s)`)
      for (const [name, p] of Object.entries(providers)) {
        const provider = p as Record<string, unknown>
        if (provider.apiKeyEnv) {
          const envVar = provider.apiKeyEnv as string
          check(`Provider "${name}" API key (${envVar})`, !!process.env[envVar])
        }
      }
    } else {
      warn("Providers", "no providers configured")
    }

    // Check permission configuration
    const permission = (config as Record<string, unknown>).permission
    check("Permission rules configured", !!permission)

    // Check MCP configuration
    const mcp = (config as Record<string, unknown>).mcp
    if (mcp && typeof mcp === "object" && Object.keys(mcp as Record<string, unknown>).length > 0) {
      check("MCP servers configured", true, `${Object.keys(mcp as Record<string, unknown>).length} server(s)`)
    } else {
      warn("MCP servers", "none configured")
    }

    // Check plugin configuration
    const plugins = (config as Record<string, unknown>).plugin_origins
    if (plugins && Array.isArray(plugins) && plugins.length > 0) {
      check("Plugins configured", true, `${plugins.length} plugin(s)`)
    } else {
      warn("Plugins", "none configured")
    }

    // Check instruction files
    const instructions = (config as Record<string, unknown>).instructions
    if (instructions && Array.isArray(instructions) && instructions.length > 0) {
      check("Instruction files", true, `${instructions.length} file(s)`)
    }

    // Summary
    console.log("")
    console.log(`  ${"─".repeat(40)}`)
    console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings`)
    console.log("")
  }),
})

function printConfig(obj: Record<string, unknown>, depth: number) {
  const indent = "  ".repeat(depth + 1)
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (key === "provider" || key === "permission") {
      // Redact sensitive sections
      console.log(`${indent}${key}: ${JSON.stringify(value).length} bytes (redacted)`)
    } else if (typeof value === "object" && !Array.isArray(value)) {
      console.log(`${indent}${key}:`)
      printConfig(value as Record<string, unknown>, depth + 1)
    } else if (Array.isArray(value)) {
      console.log(`${indent}${key}: [${value.length} items]`)
    } else {
      console.log(`${indent}${key}: ${String(value).substring(0, 100)}`)
    }
  }
}