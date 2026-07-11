import { Effect } from "effect"
import {
  LLMEvent,
  type ToolCallPart,
  ToolFailure,
  ToolOutput,
  ToolResultValue,
  type ToolOutput as ToolOutputType,
  type ToolResultValue as ToolResultValueType,
} from "./schema"
import { type AnyTool, type Tools } from "./tool"
import { PolicyEngine, type AgentAction } from "@obelisk-ai/obelisk-core"

const policyEngine = new PolicyEngine()

function actionFor(toolName: string, input: unknown): AgentAction | undefined {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  switch (toolName) {
    case "bash":
      return typeof record.command === "string" ? { type: "shell", target: record.command } : undefined
    case "write":
    case "edit":
      return typeof record.path === "string" ? { type: "file-write", target: record.path } : undefined
    case "read":
      return typeof record.filePath === "string"
        ? { type: "file-read", target: record.filePath }
        : typeof record.path === "string"
          ? { type: "file-read", target: record.path }
          : undefined
    case "webfetch":
      return typeof record.url === "string" ? { type: "network", target: record.url } : undefined
    default:
      return undefined
  }
}

/** Policy check for a decoded tool call. Fails open on internal errors. */
function checkPolicy(toolName: string, input: unknown): string | undefined {
  const action = actionFor(toolName, input)
  if (!action) return undefined
  try {
    const decision = policyEngine.evaluate(action)
    if (decision.verdict === "deny") {
      return `Blocked by policy: ${decision.reason ?? `${action.type} denied for ${decision.redactedTarget ?? action.target}`}`
    }
    return undefined
  } catch {
    return undefined
  }
}

export interface ToolSettlement {
  readonly result: ToolResultValueType
  readonly output?: ToolOutputType
}

export interface DispatchResult extends ToolSettlement {
  readonly events: ReadonlyArray<LLMEvent>
}

/** Execute one canonical tool call without owning provider IO or continuation. */
export const dispatch = (tools: Tools, call: ToolCallPart): Effect.Effect<DispatchResult> => {
  const tool = tools[call.name]
  if (!tool) return Effect.succeed(result(call, { type: "error", value: `Unknown tool: ${call.name}` }))
  if (!tool.execute)
    return Effect.succeed(result(call, { type: "error", value: `Tool has no execute handler: ${call.name}` }))

  return decodeAndExecute(tool, call).pipe(
    Effect.map((value) => result(call, value)),
    Effect.catchTag("LLM.ToolFailure", (failure) =>
      Effect.succeed(result(call, { type: "error", value: failure.message }, failure.error)),
    ),
  )
}

const decodeAndExecute = (tool: AnyTool, call: ToolCallPart): Effect.Effect<ToolSettlement, ToolFailure> =>
  tool._decode(call.input).pipe(
    Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
    Effect.flatMap((decoded) => {
      const denial = checkPolicy(call.name, decoded)
      return denial ? Effect.fail(new ToolFailure({ message: denial })) : Effect.succeed(decoded)
    }),
    Effect.flatMap((decoded) =>
      tool.execute!(decoded, { id: call.id, name: call.name }).pipe(
        Effect.flatMap((value) =>
          tool._encode(value).pipe(
            Effect.mapError(
              (error) =>
                new ToolFailure({
                  message: `Tool returned an invalid value for its success schema: ${error.message}`,
                }),
            ),
          ),
        ),
        Effect.map((encoded) => {
          if (tool._legacyResult && ToolResultValue.is(encoded))
            return { result: encoded, output: ToolOutput.fromResultValue(encoded) }
          const output = tool._project(decoded, call.id, encoded)
          const result = ToolOutput.toResultValue(output)
          return result.type === "error" ? { result } : { result, output }
        }),
      ),
    ),
  )

const result = (call: ToolCallPart, value: ToolResultValueType | ToolSettlement, error?: unknown): DispatchResult => {
  const settlement = ToolResultValue.is(value) ? { result: value } : value
  return {
    result: settlement.result,
    output: settlement.output,
    events:
      settlement.result.type === "error"
        ? [
            LLMEvent.toolError({ id: call.id, name: call.name, message: String(settlement.result.value), error }),
            LLMEvent.toolResult({ id: call.id, name: call.name, result: settlement.result }),
          ]
        : [LLMEvent.toolResult({ id: call.id, name: call.name, result: settlement.result, output: settlement.output })],
  }
}

export const ToolRuntime = { dispatch } as const
