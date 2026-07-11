export * as SemanticCodeTool from "./semantic-code"

import { ToolFailure } from "@obelisk-ai/llm"
import { SerenaMcpAdapter } from "@obelisk-ai/semantic"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "semantic_code"

export const Input = Schema.Struct({
  mode: Schema.Literals(["find_symbol", "references", "overview"]).annotate({
    description: "find_symbol: locate a symbol by name. references: find callers/usages. overview: list symbols in a file.",
  }),
  symbol: Schema.String.pipe(Schema.optional).annotate({ description: "Symbol name (required for find_symbol and references)" }),
  file: Schema.String.pipe(Schema.optional).annotate({
    description: "File path (required for references and overview; narrows find_symbol)",
  }),
})

const Output = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    kind: Schema.String,
    file: Schema.String,
    line: Schema.Number,
  }),
)

let adapter: SerenaMcpAdapter | undefined

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Symbol-aware code intelligence via Serena (language-server backed) — finds a symbol's true definition, every place it's referenced, or a file's symbol table. More precise than text/AST search for 'where is X defined' and 'what calls X' questions, since it understands scope and imports rather than matching text.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text:
                output.length === 0
                  ? "No results."
                  : output.map((s) => `${s.kind}  ${s.name}  ${s.file}:${s.line}`).join("\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.symbol ?? input.file ?? ""],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              return yield* Effect.tryPromise({
                try: async () => {
                  if (!adapter) adapter = new SerenaMcpAdapter()
                  if (input.mode === "find_symbol") {
                    if (!input.symbol) throw new Error("find_symbol requires a symbol name")
                    const symbols = await adapter.findSymbol({ name: input.symbol, file: input.file })
                    return symbols.map((s) => ({ name: s.name, kind: s.kind, file: s.file, line: s.line }))
                  }
                  if (input.mode === "references") {
                    if (!input.symbol || !input.file) throw new Error("references requires both symbol and file")
                    const refs = await adapter.findReferences({ name: input.symbol, file: input.file })
                    return refs.map((r) => ({ name: r.symbol, kind: "reference", file: r.file, line: r.line }))
                  }
                  if (!input.file) throw new Error("overview requires a file")
                  const symbols = await adapter.listSymbols({ file: input.file })
                  return symbols.map((s) => ({ name: s.name, kind: s.kind, file: s.file, line: s.line }))
                },
                catch: (error) => error,
              })
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to run semantic ${input.mode} for "${input.symbol ?? input.file}"` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/semantic-code",
  layer,
  deps: [ToolRegistry.node, Location.node, PermissionV2.node],
})
