/**
 * Autopilot — forces token optimization, secret redaction, and policy
 * gating onto every tool call without the model having to invoke them.
 *
 * This is the thing that separates the fork from "OpenCode + these as MCP
 * servers": MCP tools are opt-in (the model has to decide to call them).
 * These hooks run unconditionally on every tool execution.
 */
export * as Autopilot from "./autopilot"

import { OutputOptimizer, PolicyEngine, SecretRedactor, type AgentAction } from "@obelisk-ai/obelisk-core"

const outputOptimizer = new OutputOptimizer()
const policyEngine = new PolicyEngine()
const secretRedactor = new SecretRedactor()

// Below this size, tool output is typically small structured data (a
// skill listing, a todo array, a single symbol lookup) where the
// compression layers' dedup/minify passes can silently drop lines the
// model actually needs. Compression only pays off, and is only safe to
// apply blindly, on larger freeform text (logs, diffs, search results).
const COMPRESSION_THRESHOLD = 2000

/**
 * Run redaction + compression on model-bound tool output text. Never
 * throws — a bug in the optimizer must not break tool calls that would
 * otherwise have succeeded. Secret redaction always runs; the full
 * compression pipeline only runs above COMPRESSION_THRESHOLD.
 */
export function optimizeText(text: string): string {
  if (!text) return text
  try {
    const redacted = secretRedactor.redact(text).text
    if (redacted.length < COMPRESSION_THRESHOLD) return redacted
    return outputOptimizer.optimize(redacted).text
  } catch {
    return text
  }
}

/** Map a tool call name + decoded input to a policy-checkable action, or undefined if this tool isn't policy-gated. */
export function actionFor(toolName: string, input: unknown): AgentAction | undefined {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  switch (toolName) {
    case "bash":
      return typeof record.command === "string" ? { type: "shell", target: record.command } : undefined
    case "write":
      return typeof record.path === "string" ? { type: "file-write", target: record.path } : undefined
    case "edit":
      return typeof record.path === "string" ? { type: "file-write", target: record.path } : undefined
    case "apply_patch":
      return typeof record.patch === "string" ? { type: "file-write", target: "apply_patch" } : undefined
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

/** Policy check for a tool call. Returns a denial message, or undefined if allowed. */
export function checkPolicy(toolName: string, input: unknown): string | undefined {
  const action = actionFor(toolName, input)
  if (!action) return undefined
  try {
    const decision = policyEngine.evaluate(action)
    if (decision.verdict === "deny") {
      return `Blocked by policy: ${decision.reason ?? `${action.type} denied for ${decision.redactedTarget ?? action.target}`}`
    }
    return undefined
  } catch {
    // Policy engine failing open is safer than a bug here blocking all tool use.
    return undefined
  }
}
