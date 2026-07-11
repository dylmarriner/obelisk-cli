import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { RemoteNexusMemoryAdapter, DEFAULT_NEXUS_CONFIG, LocalMemoryCache } from "@obelisk-ai/memory"

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage durable memory and recall",
  builder: (yargs: Argv) =>
    yargs
      .command(MemoryRememberCommand)
      .command(MemoryRecallCommand)
      .command(MemoryForgetCommand)
      .command(MemoryOfflineCommand)
      .demandCommand(),
  async handler() {},
})

const MemoryRememberCommand = effectCmd({
  command: "remember <content>",
  describe: "store a fact or decision in durable memory",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("content", {
        type: "string",
        describe: "the fact, decision, or note to remember",
        demandOption: true,
      })
      .option("tags", {
        type: "string",
        array: true,
        describe: "tags for categorizing the memory",
        default: [] as string[],
      })
      .option("scope", {
        type: "string",
        choices: ["global_user", "project", "session", "architecture_decision", "preference"],
        default: "project",
      }),
  handler: Effect.fn("Cli.memory.remember")(function* (args) {
    const adapter = createAdapter()
    const content = args.content
    const tags = args.tags || []
    const scope = args.scope || "project"

    console.log("")
    console.log("  Saving to memory...")
    console.log("")

    try {
      const record = yield* Effect.promise(() =>
        adapter.remember({
          scope: scope as any,
          content,
          tags,
          source: "manual",
          sensitivity: "normal",
        }),
      )

      const status = (record as any).status
      if (status === "queued") {
        console.log(`  ⚠ Nexus unavailable — memory queued locally`)
        console.log(`    ID: ${record.id}`)
        console.log("")
      } else {
        console.log(`  ✓ Memory saved`)
        console.log(`    ID: ${record.id}`)
        if (tags.length > 0) console.log(`    Tags: ${tags.join(", ")}`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Failed to save: ${(err as Error).message}`)
      console.log("")
    }
  }),
})

const MemoryRecallCommand = effectCmd({
  command: "recall <query>",
  describe: "search durable memory for relevant context",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("query", {
        type: "string",
        describe: "search query for finding relevant memories",
        demandOption: true,
      })
      .option("tags", {
        type: "string",
        array: true,
        describe: "filter by tags",
      })
      .option("limit", {
        type: "number",
        describe: "maximum results",
        default: 10,
      }),
  handler: Effect.fn("Cli.memory.recall")(function* (args) {
    const adapter = createAdapter()
    const query = args.query
    const tags = args.tags || undefined
    const limit = args.limit || 10

    console.log("")
    console.log(`  Searching memory for "${query}"...`)
    console.log("")

    try {
      const results = yield* Effect.promise(() =>
        adapter.recall({ query, tags, limit }),
      )

      if (results.length === 0) {
        console.log("  No matching memories found.")
        console.log("")
        return
      }

      console.log(`  Found ${results.length} result(s):`)
      console.log("")

      for (const record of results) {
        console.log(`    [${record.scope}] ${record.summary || record.content.substring(0, 120)}`)
        if (record.tags.length > 0) {
          console.log(`     Tags: ${record.tags.join(", ")}`)
        }
        console.log(`     ID: ${record.id} | ${new Date(record.createdAt).toLocaleDateString()}`)
        console.log("")
      }
    } catch (err) {
      console.log(`  ✗ Search failed: ${(err as Error).message}`)
      console.log("")
    }
  }),
})

const MemoryForgetCommand = effectCmd({
  command: "forget <id>",
  describe: "remove a memory record",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "memory record ID to forget",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.memory.forget")(function* (args) {
    const adapter = createAdapter()
    const id = args.id

    console.log("")
    try {
      yield* Effect.promise(() => adapter.forget({ queryOrId: id }))
      console.log(`  ✓ Memory forgotten: ${id}`)
      console.log("")
    } catch (err) {
      console.log(`  ✗ Failed to forget: ${(err as Error).message}`)
      console.log("")
    }
  }),
})

const MemoryOfflineCommand = effectCmd({
  command: "offline-status",
  describe: "show offline memory queue status",
  instance: false,
  handler: Effect.fn("Cli.memory.offline-status")(function* () {
    const cachePath = process.env.NEXUS_OFFLINE_CACHE || DEFAULT_NEXUS_CONFIG.offlineCachePath
    const cache = new LocalMemoryCache(cachePath)
    const stats = cache.stats()

    console.log("")
    console.log("  Offline Memory Queue")
    console.log("  " + "─".repeat(40))
    console.log(`  Cache:     ${cachePath}`)
    console.log(`  Total:     ${stats.total}`)
    console.log(`  Pending:   ${stats.pending}`)
    console.log(`  Synced:    ${stats.synced}`)
    console.log("")
  }),
})

function createAdapter(): RemoteNexusMemoryAdapter {
  const endpoint = process.env.NEXUS_ENDPOINT || DEFAULT_NEXUS_CONFIG.endpoint
  const cachePath = process.env.NEXUS_OFFLINE_CACHE || DEFAULT_NEXUS_CONFIG.offlineCachePath
  return new RemoteNexusMemoryAdapter(
    { endpoint },
    new LocalMemoryCache(cachePath),
  )
}