export * as StructuralSearchTool from "./structural-search"

import { ToolFailure } from "@obelisk-ai/llm"
import { AstGrepAdapter } from "@obelisk-ai/structural"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "structural_search"

export const Input = Schema.Struct({
  pattern: Schema.String.annotate({
    description: 'AST pattern using $VAR placeholders, e.g. "await $CALL($ARGS)" or "var $A = $B"',
  }),
  language: Schema.String.annotate({ description: 'Language, e.g. "ts", "js", "py", "rust", "go"' }),
  path: Schema.String.pipe(Schema.optional).annotate({ description: "Directory or file to search. Defaults to the whole repo." }),
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
    const adapter = new AstGrepAdapter()

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Structural code search by AST pattern (ast-grep) — finds code by shape, not text, so it survives formatting differences and matches across statements. Use for refactoring-adjacent lookups like 'every await call', 'every var declaration', or language-construct patterns that a plain regex can't express reliably.",
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
                resources: [input.pattern],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              return yield* Effect.tryPromise({
                try: async () => {
                  const results = await adapter.find({
                    pattern: input.pattern,
                    language: input.language,
                    repoPath: input.path ?? location.directory,
                  })
                  return results.map((r) => ({ file: r.file, line: r.line, content: r.content }))
                },
                catch: (error) => error,
              })
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to run structural search for "${input.pattern}"` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/structural-search",
  layer,
  deps: [ToolRegistry.node, Location.node, PermissionV2.node],
})
