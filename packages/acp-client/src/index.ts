/**
 * AcpClient — drives an external coding agent (Claude Code, Codex, Hermes,
 * OpenClaw, Cline) as an ACP (Agent Client Protocol) server subprocess.
 *
 * obelisk-cli acts as the ACP *client* here — the same role Zed plays when
 * it drives Claude Code or Codex — spawning the tool's ACP server mode and
 * driving a persistent session/new + repeated session/prompt round-trips,
 * collecting the agent's text output as it streams in via session/update
 * notifications.
 */
export * as AcpClient from "./index"

// Re-exported so the dynamic provider-loader in packages/obelisk/src/provider/provider.ts
// (which imports this package's entrypoint and picks the first export whose name
// starts with "create") can find it.
export { createAcpProvider } from "./language-model"

import * as cp from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { Readable, Writable } from "node:stream"
import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type InitializeRequest,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PromptRequest,
} from "@agentclientprotocol/sdk"

const SESSION_STORE_DIR = ".obelisk/acp-sessions"

/** Where a lane's delegate sessionId is durably remembered across process
 * restarts, so a brand new obelisk process can reconnect to the same
 * ongoing delegate conversation instead of starting over. */
function sessionStorePath(cwd: string, persistKey: string): string {
  const hash = crypto.createHash("sha256").update(persistKey).digest("hex").slice(0, 16)
  return path.join(cwd, SESSION_STORE_DIR, `${hash}.json`)
}

interface SavedSession {
  readonly sessionId: string
  /** How many of the caller's prompt messages had already been sent when
   * this was saved — a resumed session needs this to avoid re-sending
   * (and duplicating) turns the delegate already has in its own history. */
  readonly sentCount: number
}

function loadSavedSession(cwd: string, persistKey: string): SavedSession | undefined {
  try {
    const raw = fs.readFileSync(sessionStorePath(cwd, persistKey), "utf-8")
    const parsed = JSON.parse(raw) as Partial<SavedSession>
    if (!parsed.sessionId) return undefined
    return { sessionId: parsed.sessionId, sentCount: parsed.sentCount ?? 0 }
  } catch {
    return undefined
  }
}

function saveSession(cwd: string, persistKey: string, saved: SavedSession): void {
  try {
    const file = sessionStorePath(cwd, persistKey)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...saved, savedAt: new Date().toISOString() }), "utf-8")
  } catch {
    // Best-effort — losing the saved session just means the next process starts fresh.
  }
}

export interface AcpAgentSpec {
  /** Stable id used to select this agent, e.g. "claude", "codex", "hermes". */
  readonly id: string
  readonly label: string
  readonly command: string
  readonly args: readonly string[]
}

export const AGENTS: Record<string, AcpAgentSpec> = {
  claude: { id: "claude", label: "Claude Code", command: "claude-agent-acp", args: [] },
  codex: { id: "codex", label: "Codex", command: "codex-acp", args: [] },
  hermes: { id: "hermes", label: "Hermes", command: "hermes", args: ["acp", "--accept-hooks"] },
  openclaw: { id: "openclaw", label: "OpenClaw", command: "openclaw", args: ["acp"] },
  cline: { id: "cline", label: "Cline", command: "cline", args: ["--acp"] },
}

export interface AcpRunUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cachedReadTokens?: number
  readonly cachedWriteTokens?: number
}

export interface AcpRunResult {
  readonly text: string
  readonly stopReason: string
  readonly usage?: AcpRunUsage
}

export interface AcpRunOptions {
  readonly cwd?: string
  readonly onChunk?: (text: string) => void
  readonly timeoutMs?: number
}

function toRunUsage(usage: unknown): AcpRunUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined
  const u = usage as Record<string, unknown>
  return {
    inputTokens: u.inputTokens as number | undefined,
    outputTokens: u.outputTokens as number | undefined,
    totalTokens: u.totalTokens as number | undefined,
    cachedReadTokens: u.cachedReadTokens as number | undefined,
    cachedWriteTokens: u.cachedWriteTokens as number | undefined,
  }
}

/**
 * AcpSession — a persistent connection to one ACP-backed agent process.
 *
 * The subprocess and its ACP session are created lazily on the first
 * `send()` and then reused for every subsequent turn, so the delegate
 * agent keeps its own memory of prior turns instead of every message
 * replaying the whole conversation into a fresh process. Call `close()`
 * when the owning obelisk session ends (or the delegate model changes) to
 * release the subprocess.
 */
export class AcpSession {
  private proc: cp.ChildProcess | undefined
  private connection: ClientSideConnection | undefined
  private sessionId: string | undefined
  private stderrLines: string[] = []
  private starting: Promise<void> | undefined
  // The session process is spawned once and its `sessionUpdate` handler
  // registered once, but `send()` is called repeatedly across turns — this
  // indirection lets each turn's chunks route to *that* turn's caller
  // instead of whichever `onChunk` happened to be current when the process
  // first started.
  private currentSink: ((text: string) => void) | undefined
  /** Set once `start()` resumes a saved session — how many prompt messages
   * the delegate already has, so the first `send()` after resuming can
   * skip re-sending them. Undefined for a brand new session. */
  resumedSentCount: number | undefined

  constructor(
    private readonly spec: AcpAgentSpec,
    private readonly cwd: string = process.cwd(),
    /** Stable identifier for this conversation, used to save/reload its
     * delegate sessionId across process restarts. Omit for a session that
     * should never survive past this process (e.g. one-shot `run()`). */
    private readonly persistKey?: string,
  ) {}

  get isOpen(): boolean {
    return !!this.proc && !this.proc.killed
  }

  private async ensureStarted(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = this.start()
    return this.starting
  }

  /** Ensure the subprocess and ACP session exist (spawning/loading them if
   * needed) without sending a turn. Callers that need to know
   * `resumedSentCount` before deciding what to send should await this
   * first — `send()` alone only guarantees it's started by the time it
   * resolves, which is too late to affect what gets sent that same call. */
  async prepare(): Promise<void> {
    await this.ensureStarted()
  }

  private async start(): Promise<void> {
    const proc = cp.spawn(this.spec.command, this.spec.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // Own process group so close() can kill any children the delegate
      // agent itself spawns (e.g. claude-agent-acp spawning `claude`),
      // not just the immediate ACP bridge process.
      detached: true,
    })
    this.proc = proc

    proc.stderr?.on("data", (chunk: Buffer) => {
      this.stderrLines.push(chunk.toString())
      if (this.stderrLines.length > 200) this.stderrLines.shift()
    })
    proc.on("exit", () => {
      this.proc = undefined
      this.connection = undefined
      this.sessionId = undefined
      this.starting = undefined
    })

    const toClient = (_agent: Agent): Client => ({
      sessionUpdate: async (params) => {
        const update = params.update
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          this.currentSink?.(update.content.text)
        }
      },
      async requestPermission(params) {
        // Autopilot posture: allow the delegated agent to act without a
        // human in the loop, mirroring "yolo"/auto-approve flags each of
        // these tools already supports natively.
        const allowOption = params.options.find((o) => o.kind === "allow_always" || o.kind === "allow_once")
        return {
          outcome: allowOption
            ? { outcome: "selected", optionId: allowOption.optionId }
            : { outcome: "cancelled" },
        }
      },
      async readTextFile(params) {
        const fs = await import("node:fs/promises")
        const content = await fs.readFile(params.path, "utf-8")
        return { content }
      },
      async writeTextFile(params) {
        const fs = await import("node:fs/promises")
        await fs.writeFile(params.path, params.content, "utf-8")
        return {}
      },
    })

    const stream = ndJsonStream(
      Writable.toWeb(proc.stdin!) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout!) as unknown as ReadableStream<Uint8Array>,
    )
    const connection = new ClientSideConnection(toClient, stream)
    this.connection = connection

    const init = await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    } as InitializeRequest)

    const saved = this.persistKey ? loadSavedSession(this.cwd, this.persistKey) : undefined
    if (saved && init.agentCapabilities?.loadSession) {
      try {
        await connection.loadSession({
          sessionId: saved.sessionId,
          cwd: this.cwd,
          mcpServers: [],
        } as LoadSessionRequest)
        this.sessionId = saved.sessionId
        this.resumedSentCount = saved.sentCount
        return
      } catch {
        // Saved session is gone or unloadable (e.g. delegate storage was
        // cleared) — fall through and start a fresh one below.
      }
    }

    const session = await connection.newSession({ cwd: this.cwd, mcpServers: [] } as NewSessionRequest)
    this.sessionId = session.sessionId
    if (this.persistKey) saveSession(this.cwd, this.persistKey, { sessionId: session.sessionId, sentCount: 0 })
  }

  /** Persist how far this conversation has progressed, so a future process
   * resuming this session knows how many messages to skip re-sending. */
  persistProgress(sentCount: number): void {
    if (this.persistKey && this.sessionId) saveSession(this.cwd, this.persistKey, { sessionId: this.sessionId, sentCount })
  }

  /**
   * Send one turn to the persistent session. The delegate agent retains
   * memory of every prior `send()` call on this same AcpSession — callers
   * should only pass the *new* message(s) for this turn, not the full
   * conversation history.
   */
  async send(prompt: string, options: AcpRunOptions = {}): Promise<AcpRunResult> {
    await this.ensureStarted()
    const proc = this.proc
    const connection = this.connection
    const sessionId = this.sessionId
    if (!proc || !connection || !sessionId) {
      throw new Error(`${this.spec.label} ACP session failed to start: ${this.stderrLines.join("").slice(-2000)}`)
    }

    let text = ""
    this.currentSink = (chunk) => {
      text += chunk
      options.onChunk?.(chunk)
    }

    const exited = new Promise<never>((_, reject) => {
      proc.once("error", reject)
      proc.once("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`${this.spec.label} ACP process exited with code ${code}: ${this.stderrLines.join("").slice(-2000)}`))
        } else if (signal) {
          reject(new Error(`${this.spec.label} ACP process killed by signal ${signal}`))
        }
      })
    })

    const work = connection
      .prompt({ sessionId, prompt: [{ type: "text", text: prompt }] } as PromptRequest)
      .then((result) => ({ text, stopReason: result.stopReason, usage: toRunUsage(result.usage) }))

    const timeout = options.timeoutMs ?? 10 * 60 * 1000
    try {
      return await Promise.race([
        work,
        exited,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${this.spec.label} ACP turn timed out`)), timeout)),
      ])
    } finally {
      this.currentSink = undefined
    }
  }

  close(): void {
    if (this.proc?.pid) {
      try {
        // Negative pid targets the whole process group (see `detached: true`
        // above), killing any children the delegate agent spawned too.
        process.kill(-this.proc.pid, "SIGTERM")
      } catch {
        this.proc.kill("SIGTERM")
      }
      // Explicitly tear down the pipes — an unclosed stdio handle can keep
      // the host process's event loop alive even after the child is dead.
      this.proc.stdin?.destroy()
      this.proc.stdout?.destroy()
      this.proc.stderr?.destroy()
      this.proc.unref()
    }
    this.proc = undefined
    this.connection = undefined
    this.sessionId = undefined
    this.starting = undefined
  }
}

/**
 * One-shot convenience wrapper: opens a session, sends a single prompt,
 * and closes it. Prefer `AcpSession` directly for multi-turn conversations
 * — every call to `run()` starts a brand new delegate process with no
 * memory of previous calls.
 */
export async function run(spec: AcpAgentSpec, prompt: string, options: AcpRunOptions = {}): Promise<AcpRunResult> {
  const session = new AcpSession(spec, options.cwd)
  try {
    return await session.send(prompt, options)
  } finally {
    session.close()
  }
}
