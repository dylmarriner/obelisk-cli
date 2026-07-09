import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { RemoteNexusMemoryAdapter, DEFAULT_NEXUS_CONFIG, LocalMemoryCache } from "@obelisk-ai/memory"

export const NexusCommand = cmd({
  command: "nexus",
  describe: "Nexus remote memory operations",
  builder: (yargs: Argv) =>
    yargs
      .command(NexusHealthCommand)
      .command(NexusPingCommand)
      .command(NexusConfigCommand)
      .command(NexusSyncCommand)
      .command(NexusTestWriteCommand)
      .demandCommand(),
  async handler() {},
})

const NexusHealthCommand = effectCmd({
  command: "health",
  describe: "check Nexus memory server health",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("endpoint", {
      type: "string",
      describe: "Nexus endpoint URL",
    }),
  handler: Effect.fn("Cli.nexus.health")(function* (args) {
    const endpoint = args.endpoint || DEFAULT_NEXUS_CONFIG.endpoint
    const adapter = createAdapter(endpoint)

    Console.log("")
    Console.log(`  Checking Nexus health at ${endpoint}...`)
    Console.log("")

    try {
      const health = yield* Effect.promise(() => adapter.health())
      Console.log(`  ✓ Nexus is healthy`)
      Console.log(`    Service: ${health.service}`)
      Console.log(`    Version: ${health.version}`)
      Console.log(`    Storage: ${health.storage}`)
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Nexus is unreachable:`)
      Console.log(`    ${(err as Error).message}`)
      Console.log("")
      Console.log("  Possible causes:")
      Console.log("    - Tailscale not connected")
      Console.log("    - Nexus server not running on the Pi")
      Console.log("    - Wrong endpoint or port")
      Console.log("    - NEXUS_API_KEY not set in environment")
      Console.log("")
    }
  }),
})

const NexusPingCommand = effectCmd({
  command: "ping",
  describe: "ping the Nexus server and measure latency",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("endpoint", {
      type: "string",
      describe: "Nexus endpoint URL",
    }),
  handler: Effect.fn("Cli.nexus.ping")(function* (args) {
    const endpoint = args.endpoint || DEFAULT_NEXUS_CONFIG.endpoint
    const adapter = createAdapter(endpoint)

    const result = yield* Effect.promise(() => adapter.ping())
    if (result.ok) {
      Console.log(`  ✓ Nexus reachable at ${endpoint} (${result.latencyMs}ms)`)
    } else {
      Console.log(`  ✗ Nexus unreachable at ${endpoint}`)
    }
  }),
})

const NexusConfigCommand = effectCmd({
  command: "config",
  describe: "show Nexus configuration",
  instance: false,
  handler: Effect.fn("Cli.nexus.config")(function* () {
    const endpoint = process.env.NEXUS_ENDPOINT || DEFAULT_NEXUS_CONFIG.endpoint
    const apiKey = process.env.NEXUS_API_KEY ? "*** set ***" : "*** not set ***"

    Console.log("")
    Console.log("  Nexus Configuration")
    Console.log("  " + "─".repeat(40))
    Console.log(`  Endpoint:    ${endpoint}`)
    Console.log(`  API Key:     ${apiKey}`)
    Console.log(`  Timeout:     ${DEFAULT_NEXUS_CONFIG.timeoutMs}ms`)
    Console.log(`  Retries:     ${DEFAULT_NEXUS_CONFIG.retries}`)
    Console.log(`  Cache:       ${DEFAULT_NEXUS_CONFIG.offlineCachePath}`)
    Console.log("")
  }),
})

const NexusSyncCommand = effectCmd({
  command: "sync",
  describe: "sync queued offline memory writes to Nexus",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("endpoint", {
      type: "string",
      describe: "Nexus endpoint URL",
    }),
  handler: Effect.fn("Cli.nexus.sync")(function* (args) {
    const endpoint = args.endpoint || DEFAULT_NEXUS_CONFIG.endpoint
    const adapter = createAdapter(endpoint)

    Console.log("")
    Console.log("  Syncing offline memory queue...")
    Console.log("")

    const result = yield* Effect.promise(() => adapter.syncOfflineQueue())

    if (result.synced > 0) {
      Console.log(`  ✓ Synced ${result.synced} queued memory writes`)
    } else {
      Console.log("  No queued writes to sync")
    }

    if (result.remaining > 0) {
      Console.log(`  ⚠ ${result.remaining} writes remaining`)
    }
    if (result.errors?.length) {
      for (const err of result.errors) {
        Console.log(`  ✗ ${err}`)
      }
    }
    Console.log("")
  }),
})

const NexusTestWriteCommand = effectCmd({
  command: "test-write",
  describe: "write a test memory record to verify persistence",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("endpoint", {
        type: "string",
        describe: "Nexus endpoint URL",
      })
      .option("content", {
        type: "string",
        describe: "test content to write",
        default: `Nexus test write at ${new Date().toISOString()}`,
      }),
  handler: Effect.fn("Cli.nexus.test-write")(function* (args) {
    const endpoint = args.endpoint || DEFAULT_NEXUS_CONFIG.endpoint
    const adapter = createAdapter(endpoint)
    const content = args.content

    Console.log("")
    Console.log(`  Writing test memory to ${endpoint}...`)
    Console.log("")

    try {
      const record = yield* Effect.promise(() =>
        adapter.remember({
          scope: "project",
          content,
          tags: ["test", "nexus", "obelisk"],
          source: "manual",
          sensitivity: "normal",
        }),
      )
      Console.log(`  ✓ Written: ${record.id}`)
      Console.log(`    Status: ${(record as any).status || "persisted"}`)
      Console.log("")

      // Verify by reading back
      const fetched = yield* Effect.promise(() => adapter.get(record.id))
      if (fetched) {
        Console.log(`  ✓ Verified: read back successfully`)
        Console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Write failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

function createAdapter(endpoint: string): RemoteNexusMemoryAdapter {
  const cachePath = process.env.NEXUS_OFFLINE_CACHE || DEFAULT_NEXUS_CONFIG.offlineCachePath
  return new RemoteNexusMemoryAdapter(
    { endpoint },
    new LocalMemoryCache(cachePath),
  )
}