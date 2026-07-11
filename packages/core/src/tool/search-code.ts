export * as SearchCodeTool from "./search-code"

import { ToolFailure } from "@obelisk-ai/llm"
import { ZoektSearchAdapter } from "@obelisk-ai/search"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "search_code"

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Text or regex pattern to search for across the codebase" }),
  file: Schema.String.pipe(Schema.optional).annotate({ description: "Restrict results to a file glob" }),
  maxResults: Schema.Number.pipe(Schema.optional).annotate({ description: "Maximum results to return (default 20)" }),
})

const Output = Schema.Array(
  Schema.Struct({
    file: Schema.String,
    line: Schema.Number,
    content: Schema.String,
  }),
)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service
    const adapter = new ZoektSearchAdapter({ indexDir: `${location.directory}/.obelisk/index/zoekt` })

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Fast full-text/regex search across the whole codebase using zoekt. Builds the index automatically on first use in a repo — no separate indexing step required. Prefer this over grep for broad, repo-wide code searches.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text:
                output.length === 0
                  ? "No matches found."
                  : output.map((m) => `${m.file}:${m.line}\n${m.content}`).join("\n\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              return yield* Effect.tryPromise({
                try: async () => {
                  const status = await adapter.status({})
                  if (!status.indexed) {
                    await adapter.index({ repoPath: location.directory })
                  }
                  const results = await adapter.search({
                    query: input.query,
                    file: input.file,
                    maxResults: input.maxResults ?? 20,
                  })
                  return results.map((r) => ({ file: r.file, line: r.line, content: r.content }))
                },
                catch: (error) => error,
              })
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to search for "${input.query}"` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/search-code",
  layer,
  deps: [ToolRegistry.node, Location.node, PermissionV2.node],
})
