/**
 * SerenaMcpAdapter — MCP client adapter for Serena semantic code intelligence.
 *
 * Serena (https://github.com/oraios/serena) is an MCP server that provides
 * symbol-level code understanding via language servers for 40+ languages.
 *
 * Communication: MCP protocol over stdio transport.
 * Start with: `serena start-mcp-server` or `uvx serena-agent start-mcp-server`
 *
 * Eval reference: eval/serena/ (Python source)
 */

import * as cp from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  SemanticCodeAdapter,
  SemanticToolStatus,
  CodeSymbol,
  CodeReference,
  ListSymbolsRequest,
  FindSymbolRequest,
  FindReferencesRequest,
  RenameSymbolRequest,
  EditPlan,
} from "./types";

// ─── MCP JSON-RPC Message Types ─────────────────────────────────

interface MCPRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ─── Adapter ─────────────────────────────────────────────────────

export class SerenaMcpAdapter implements SemanticCodeAdapter {
  private process: cp.ChildProcess | null = null;
  private requestId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private emitter = new EventEmitter();
  private started = false;
  private startCommand: string;
  private startArgs: string[];

  constructor(options: {
    command?: string;
    args?: string[];
  } = {}) {
    // Uses the "serena" entrypoint installed from the vendored eval/serena/
    // source (see docs/roadmap.md) rather than pulling from GitHub at
    // runtime via uvx. Without --project, the server starts with no active
    // project and all symbol tools silently return empty results.
    this.startCommand = options.command || "serena";
    this.startArgs = options.args || ["start-mcp-server", "--project", process.cwd()];
  }

  // ─── Status ───────────────────────────────────────────────────

  async status(): Promise<SemanticToolStatus> {
    try {
      if (!this.started) {
        await this.ensureRunning();
      }

      // Try calling a simple tool to verify connectivity.
      // "serena_info" is not a registered tool for the default toolset —
      // use "get_current_config", which reliably is.
      await this.callTool("get_current_config", {});

      return {
        available: true,
        version: "serena (MCP)",
        project: process.cwd(),
        error: undefined,
      };
    } catch (err) {
      return {
        available: false,
        error: (err as Error).message,
      };
    }
  }

  // ─── List Symbols ─────────────────────────────────────────────

  async listSymbols(input: ListSymbolsRequest): Promise<CodeSymbol[]> {
    await this.ensureRunning();

    const result = await this.callTool("get_symbols_overview", {
      relative_path: input.file || "",
      depth: input.depth ?? -1,
    });

    return this.parseSymbolsOverview(result as string);
  }

  // ─── Find Symbol ──────────────────────────────────────────────

  async findSymbol(input: FindSymbolRequest): Promise<CodeSymbol[]> {
    await this.ensureRunning();

    const result = await this.callTool("find_symbol", {
      name_path_pattern: input.name,
      relative_path: input.file || "",
      include_body: input.includeBody ?? false,
      include_info: input.includeInfo ?? false,
      max_matches: input.maxMatches ?? -1,
    });

    return this.parseSymbolResults(result as string);
  }

  // ─── Find References ──────────────────────────────────────────

  async findReferences(input: FindReferencesRequest): Promise<CodeReference[]> {
    await this.ensureRunning();

    const result = await this.callTool("find_referencing_symbols", {
      name_path: input.name,
      relative_path: input.file,
    });

    return this.parseReferenceResults(result as string);
  }

  // ─── Prepare Rename ───────────────────────────────────────────

  async prepareRename(input: RenameSymbolRequest): Promise<EditPlan> {
    await this.ensureRunning();

    // Get current symbol info
    const symbolResult = await this.callTool("find_symbol", {
      name_path_pattern: input.name,
      relative_path: input.file,
      include_body: true,
      max_matches: 1,
    });

    const symbols = this.parseSymbolResults(symbolResult as string);

    // Get references
    const refResult = await this.callTool("find_referencing_symbols", {
      name_path: input.name,
      relative_path: input.file,
    });

    const references = this.parseReferenceResults(refResult as string);

    const changes = references.map((ref) => ({
      file: ref.file,
      oldContent: `${input.name}`,
      newContent: input.newName,
      line: ref.line,
    }));

    return {
      changes,
      summary: `Rename "${input.name}" to "${input.newName}" — ${changes.length} reference(s) across ${new Set(changes.map((c) => c.file)).size} file(s)`,
    };
  }

  // ─── Available ────────────────────────────────────────────────

  async available(): Promise<boolean> {
    try {
      const status = await this.status();
      return status.available;
    } catch {
      return false;
    }
  }

  // ─── MCP Call Tool ────────────────────────────────────────────

  private async callTool(tool: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request: MCPRequest = {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: tool, arguments: params },
      };

      // MCP tool results arrive as { content: [{ type: "text", text: "..." }], structuredContent, isError }
      // — unwrap to the text payload the parse* helpers expect.
      this.pending.set(id, {
        resolve: (raw: unknown) => {
          const result = raw as { content?: { type?: string; text?: string }[]; structuredContent?: { result?: string }; isError?: boolean } | undefined;
          if (result?.isError) {
            reject(new Error(result.content?.[0]?.text || "Serena tool call failed"));
            return;
          }
          const text = result?.content?.find((c) => c.type === "text")?.text ?? result?.structuredContent?.result;
          resolve(text);
        },
        reject,
      });

      if (!this.process?.stdin) {
        this.pending.delete(id);
        reject(new Error("Serena process not running"));
        return;
      }

      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  // ─── Process Management ───────────────────────────────────────

  private async ensureRunning(): Promise<void> {
    if (this.started && this.process && !this.process.killed) {
      return;
    }

    return new Promise((resolve, reject) => {
      const proc = cp.spawn(this.startCommand, this.startArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process = proc;
      this.buffer = "";

      proc.stdout?.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        // Serena logs to stderr — capture for debugging
        const text = data.toString();
        if (text.includes("error") || text.includes("Error")) {
          this.emitter.emit("log", { level: "error", message: text });
        }
      });

      proc.on("error", (err) => {
        this.started = false;
        reject(err);
      });

      proc.on("exit", (code) => {
        this.started = false;
        this.process = null;
        // Reject all pending requests
        for (const [id, pending] of this.pending) {
          pending.reject(new Error(`Serena process exited with code ${code}`));
          this.pending.delete(id);
        }
      });

      // Listen for the initialize response
      const onInit = (msg: MCPResponse) => {
        if (msg.id === 0) {
          this.emitter.off("message", onInit);
          // MCP requires the client to notify the server once initialize
          // completes — without this, servers may ignore later requests.
          proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          this.started = true;
          resolve();
        }
      };

      this.emitter.on("message", onInit);

      // Send initialize request
      const initRequest: MCPRequest = {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "obelisk-cli", version: "0.1.0" },
        },
      };

      proc.stdin?.write(JSON.stringify(initRequest) + "\n");

      // Timeout after 15s
      setTimeout(() => {
        if (!this.started) {
          proc.kill();
          reject(new Error("Serena MCP server failed to initialize within 15s"));
        }
      }, 15000);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as MCPResponse;
        this.emitter.emit("message", msg);

        if (msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(`Serena error: ${msg.error.message}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch {
        // Non-JSON output — ignore (Serena may log to stdout)
      }
    }
  }

  // ─── Result Parsers ───────────────────────────────────────────

  // get_symbols_overview returns { "<Kind>": [name | { name: { <Kind>: [...] } }, ...] }
  // — a kind-keyed map of names, with nested symbols represented as
  // single-key objects rather than a flat list with positions.
  private parseSymbolsOverview(output: unknown): CodeSymbol[] {
    if (!output || typeof output !== "string") return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

    const symbols: CodeSymbol[] = [];
    const collect = (kind: string, entry: unknown) => {
      if (typeof entry === "string") {
        symbols.push({ name: entry, kind, file: "", line: 0, column: 0 });
        return;
      }
      if (entry && typeof entry === "object") {
        for (const [name, nested] of Object.entries(entry as Record<string, unknown>)) {
          const children: CodeSymbol[] = [];
          if (nested && typeof nested === "object") {
            for (const [childKind, childEntries] of Object.entries(nested as Record<string, unknown>)) {
              if (Array.isArray(childEntries)) {
                for (const child of childEntries) {
                  const before = symbols.length;
                  collect(childKind, child);
                  children.push(...symbols.splice(before));
                }
              }
            }
          }
          symbols.push({ name, kind, file: "", line: 0, column: 0, children: children.length ? children : undefined });
        }
      }
    };

    for (const [kind, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(entries)) {
        for (const entry of entries) collect(kind, entry);
      }
    }

    return symbols;
  }

  // find_symbol returns a JSON array of:
  //   { name_path, kind, relative_path, body_location: { start_line, end_line } }
  // with 0-indexed lines.
  private parseSymbolResults(output: unknown): CodeSymbol[] {
    if (!output || typeof output !== "string") return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      name: item.name_path ?? "",
      kind: item.kind ?? "symbol",
      file: item.relative_path ?? "",
      line: (item.body_location?.start_line ?? -1) + 1,
      column: 0,
      body: item.body,
    }));
  }

  // find_referencing_symbols returns:
  //   { "<relative_path>": { "<Kind>": [{ name_path, body_location, content_around_reference }] } }
  private parseReferenceResults(output: unknown): CodeReference[] {
    if (!output || typeof output !== "string") return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

    const refs: CodeReference[] = [];
    for (const [file, byKind] of Object.entries(parsed as Record<string, unknown>)) {
      if (!byKind || typeof byKind !== "object") continue;
      for (const entries of Object.values(byKind as Record<string, unknown>)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries as any[]) {
          refs.push({
            symbol: entry.name_path ?? "",
            file,
            line: (entry.body_location?.start_line ?? -1) + 1,
            column: 0,
            context: entry.content_around_reference ?? "",
          });
        }
      }
    }

    return refs;
  }
}