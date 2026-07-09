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
    this.startCommand = options.command || "uvx";
    this.startArgs = options.args || [
      "--from", "git+https://github.com/oraios/serena",
      "serena", "start-mcp-server",
    ];
  }

  // ─── Status ───────────────────────────────────────────────────

  async status(): Promise<SemanticToolStatus> {
    try {
      if (!this.started) {
        await this.ensureRunning();
      }

      // Try calling a simple tool to verify connectivity
      const result = await this.callTool("serena_info", { topic: "status" });

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

      this.pending.set(id, { resolve, reject });

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

  private parseSymbolsOverview(output: unknown): CodeSymbol[] {
    if (!output || typeof output !== "string") return [];

    const symbols: CodeSymbol[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.match(/^(\s*)(\S+)\s+(\S+)\s+(\d+):(\d+)/);
      if (match) {
        symbols.push({
          name: match[2],
          kind: match[3] || "symbol",
          file: "",
          line: parseInt(match[4], 10),
          column: parseInt(match[5], 10),
        });
      }
    }

    return symbols;
  }

  private parseSymbolResults(output: unknown): CodeSymbol[] {
    if (!output || typeof output !== "string") return [];

    const symbols: CodeSymbol[] = [];
    const lines = output.split("\n");
    let current: Partial<CodeSymbol> | null = null;

    for (const line of lines) {
      const headerMatch = line.match(/^([\w.]+)\s+\((\w+)\)\s+at\s+([^:]+):(\d+):(\d+)/);
      if (headerMatch) {
        if (current && current.name) {
          symbols.push(current as CodeSymbol);
        }
        current = {
          name: headerMatch[1],
          kind: headerMatch[2],
          file: headerMatch[3],
          line: parseInt(headerMatch[4], 10),
          column: parseInt(headerMatch[5], 10),
        };
      } else if (current && line.trim().startsWith("//") || line.trim().startsWith("/*")) {
        current.documentation = (current.documentation || "") + line.trim() + "\n";
      } else if (current && line.trim() && !line.startsWith(" ")) {
        // Signature line
        current.signature = (current.signature || "") + line.trim();
      }
    }

    if (current && current.name) {
      symbols.push(current as CodeSymbol);
    }

    return symbols;
  }

  private parseReferenceResults(output: unknown): CodeReference[] {
    if (!output || typeof output !== "string") return [];

    const refs: CodeReference[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(\d+):(.+)/);
      if (match) {
        refs.push({
          symbol: match[4].trim(),
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          context: match[4].trim(),
        });
      }
    }

    return refs;
  }
}