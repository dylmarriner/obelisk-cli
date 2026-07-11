/**
 * AcpLanguageModel — adapts an ACP-backed delegate agent (Claude Code,
 * Codex, Hermes, OpenClaw, Cline) to the AI SDK's LanguageModelV2
 * interface, so it can be selected as a normal "model" via /model.
 *
 * Each AcpModel instance holds one persistent AcpSession, reused across
 * every turn for as long as the process lives — the delegate agent keeps
 * its own memory of the conversation, so only the messages new since the
 * last call are sent, not the full history every time. There is no true
 * token-level streaming from these tools (they're subprocess agents, not
 * token-streaming APIs) — text arrives in the chunks the underlying agent
 * itself emits, which this wraps as text-delta stream parts as they occur,
 * so the rest of the pipeline (and the UI) sees a normal live stream.
 */
export * as AcpLanguageModel from "./language-model"

import { AGENTS, AcpSession, type AcpAgentSpec, type AcpRunUsage } from "./index"

// ─── Minimal AI SDK v2 type surface (avoid a hard dependency on @ai-sdk/provider) ──

interface TextPart {
  type: "text"
  text: string
}
interface Message {
  role: string
  content: string | Array<TextPart | { type: string; [key: string]: unknown }>
}
interface CallOptions {
  prompt: Message[]
}
interface StreamPart {
  type: string
  [key: string]: unknown
}

function partsToText(content: Message["content"]): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function flattenPrompt(prompt: Message[]): string {
  return prompt
    .map((msg) => `[${msg.role}]\n${partsToText(msg.content)}`)
    .join("\n\n")
}

// This workspace's `ai` package (v6) expects the LanguageModelV3 usage
// shape — nested { total, ... } objects, not flat numbers — even when a
// model declares specificationVersion "v2". Producing V3-shaped usage
// directly avoids a buggy v2→v3 normalization path that crashes on
// undefined fields.
function toV3Usage(usage: AcpRunUsage | undefined) {
  return {
    inputTokens: {
      total: usage?.inputTokens,
      noCache: usage?.inputTokens,
      cacheRead: usage?.cachedReadTokens,
      cacheWrite: usage?.cachedWriteTokens,
    },
    outputTokens: {
      total: usage?.outputTokens,
      text: usage?.outputTokens,
      reasoning: undefined,
    },
  }
}

interface ConversationLane {
  session: AcpSession
  sentCount: number
}

// obelisk-cli calls a single model id for logically independent
// conversations that happen to share a provider/model — e.g. its own
// "title", "compaction", and "build" sub-agents all resolve to the same
// cached AcpModel instance. Without partitioning, a title-generation
// aside would land in the same delegate session as the real conversation
// and corrupt its context. A conversation's first message (its system
// prompt / instructions) reliably differs between these roles and stays
// stable across turns of the *same* conversation, so it doubles as a
// cheap, stable partition key.
function laneKey(prompt: Message[]): string {
  const first = prompt[0]
  if (!first) return "empty"
  return `${first.role}:${partsToText(first.content).slice(0, 500)}`
}

class AcpModel {
  readonly specificationVersion = "v3" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls = {}

  private lanes = new Map<string, ConversationLane>()

  constructor(private readonly spec: AcpAgentSpec) {
    this.provider = "acp"
    this.modelId = spec.id
  }

  /** New messages for this turn, plus the lane (persistent delegate
   * session) this conversation belongs to. Restarts the lane's session if
   * history looks shorter than what was already sent to it — e.g. after
   * compaction — since that means it no longer matches this history.
   *
   * For a freshly-created lane, awaits the session's startup first: if it
   * resumes a session saved by a previous process, `resumedSentCount`
   * tells us how much of `prompt` the delegate already has, so we don't
   * re-send (and duplicate) those turns. */
  private async resolve(prompt: Message[]): Promise<{ lane: ConversationLane; turn: string }> {
    const key = laneKey(prompt)
    // Prefixed with the agent id: two different delegates could otherwise
    // coincidentally share a first-message signature (e.g. the same
    // system prompt) and collide on the same saved-session file on disk.
    const persistKey = `${this.spec.id}:${key}`
    let lane = this.lanes.get(key)
    let isFresh = false
    if (!lane || !lane.session.isOpen) {
      lane = { session: new AcpSession(this.spec, undefined, persistKey), sentCount: 0 }
      this.lanes.set(key, lane)
      isFresh = true
    } else if (prompt.length < lane.sentCount) {
      lane.session.close()
      lane = { session: new AcpSession(this.spec, undefined, persistKey), sentCount: 0 }
      this.lanes.set(key, lane)
      isFresh = true
    }
    if (isFresh) {
      await lane.session.prepare()
      lane.sentCount = Math.min(lane.session.resumedSentCount ?? 0, prompt.length)
    }
    const turn = flattenPrompt(prompt.slice(lane.sentCount))
    return { lane, turn }
  }

  async doGenerate(options: CallOptions) {
    const { lane, turn } = await this.resolve(options.prompt)
    const result = await lane.session.send(turn)
    lane.sentCount = options.prompt.length
    lane.session.persistProgress(lane.sentCount)
    return {
      content: [{ type: "text" as const, text: result.text }],
      finishReason: "stop" as const,
      usage: toV3Usage(result.usage),
      warnings: [],
    }
  }

  async doStream(options: CallOptions) {
    const { lane, turn } = await this.resolve(options.prompt)
    const id = crypto.randomUUID()

    const stream = new ReadableStream<StreamPart>({
      start: async (controller) => {
        controller.enqueue({ type: "text-start", id })
        try {
          const result = await lane.session.send(turn, {
            onChunk: (chunk) => controller.enqueue({ type: "text-delta", id, delta: chunk }),
          })
          lane.sentCount = options.prompt.length
          lane.session.persistProgress(lane.sentCount)
          controller.enqueue({ type: "text-end", id })
          controller.enqueue({
            type: "finish",
            finishReason: result.stopReason === "end_turn" ? "stop" : "other",
            usage: toV3Usage(result.usage),
          })
        } catch (err) {
          controller.enqueue({ type: "text-end", id })
          controller.enqueue({ type: "error", error: err })
        } finally {
          controller.close()
        }
      },
    })

    return { stream }
  }
}

/**
 * AI SDK-style provider factory. The dynamic-import machinery in
 * provider.ts picks up any exported function whose name starts with
 * "create" and calls it as `createAcpProvider({ name, ...options })`,
 * expecting back an object with a `.languageModel(id)` method.
 */
export function createAcpProvider(_options: { name: string; [key: string]: unknown } = { name: "acp" }) {
  return {
    languageModel(id: string) {
      const spec = AGENTS[id]
      if (!spec) throw new Error(`Unknown ACP agent id: ${id}`)
      return new AcpModel(spec)
    },
  }
}
