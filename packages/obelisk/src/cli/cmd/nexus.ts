import { EOL } from "os"
import { Effect } from "effect"
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

    console.log("")
    console.log(`  Checking Nexus health at ${endpoint}...`)
    console.log("")

    try {
      const health = yield* Effect.promise(() => adapter.health())
      console.log(`  ✓ Nexus is healthy`)
      console.log(`    Service: ${health.service}`)
      console.log(`    Version: ${health.version}`)
      console.log(`    Storage: ${health.storage}`)
      console.log("")
    } catch (err) {
      console.log(`  ✗ Nexus is unreachable:`)
      console.log(`    ${(err as Error).message}`)
      console.log("")
      console.log("  Possible causes:")
      console.log("    - Tailscale not connected")
      console.log("    - Nexus server not running on the Pi")
      console.log("    - Wrong endpoint or port")
      console.log("    - NEXUS_API_KEY not set in environment")
      console.log("")
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
      console.log(`  ✓ Nexus reachable at ${endpoint} (${result.latencyMs}ms)`)
    } else {
      console.log(`  ✗ Nexus unreachable at ${endpoint}`)
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

    console.log("")
    console.log("  Nexus Configuration")
    console.log("  " + "─".repeat(40))
    console.log(`  Endpoint:    ${endpoint}`)
    console.log(`  API Key:     ${apiKey}`)
    console.log(`  Timeout:     ${DEFAULT_NEXUS_CONFIG.timeoutMs}ms`)
    console.log(`  Retries:     ${DEFAULT_NEXUS_CONFIG.retries}`)
    console.log(`  Cache:       ${DEFAULT_NEXUS_CONFIG.offlineCachePath}`)
    console.log("")
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

    console.log("")
    console.log("  Syncing offline memory queue...")
    console.log("")

    const result = yield* Effect.promise(() => adapter.syncOfflineQueue())

    if (result.synced > 0) {
      console.log(`  ✓ Synced ${result.synced} queued memory writes`)
    } else {
      console.log("  No queued writes to sync")
    }

    if (result.remaining > 0) {
      console.log(`  ⚠ ${result.remaining} writes remaining`)
    }
    if (result.errors?.length) {
      for (const err of result.errors) {
        console.log(`  ✗ ${err}`)
      }
    }
    console.log("")
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

    console.log("")
    console.log(`  Writing test memory to ${endpoint}...`)
    console.log("")

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
      console.log(`  ✓ Written: ${record.id}`)
      console.log(`    Status: ${(record as any).status || "persisted"}`)
      console.log("")

      // Verify by reading back
      const fetched = yield* Effect.promise(() => adapter.get(record.id))
      if (fetched) {
        console.log(`  ✓ Verified: read back successfully`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Write failed: ${(err as Error).message}`)
      console.log("")
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