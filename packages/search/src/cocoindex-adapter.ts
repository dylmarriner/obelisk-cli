/**
 * CocoIndexAdapter — subprocess-based adapter for CocoIndex incremental indexing.
 *
 * CocoIndex (https://github.com/cocoindex-io/cocoindex) is an incremental
 * indexing framework for AI agents. It processes codebases and other data
 * sources into vector embeddings and structured data, keeping indexes fresh
 * by only reprocessing what changed.
 *
 * Integration: subprocess calling the `cocoindex` Python CLI.
 *   cocoindex update <app.py>  — one-shot catch-up
 *   cocoindex update -L <app.py> — live mode (file watching)
 *   cocoindex ls — list apps
 *   cocoindex show — inspect state
 *   cocoindex init <name> — scaffold a project
 *
 * Eval reference: eval/cocoindex/ (Rust + Python source)
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(cp.execFile);
const writeFile = promisify(fs.writeFile);

// ─── Types ──────────────────────────────────────────────────────

export interface CocoIndexRunRequest {
  appScript: string;       // Path to Python app script, or inline script content
  appName?: string;        // App name within the script (e.g. "MyApp")
  envName?: string;        // Environment name
  live?: boolean;          // Watch mode
  reset?: boolean;         // Reset before running
  fullReprocess?: boolean; // Reprocess everything
  preview?: boolean;       // Dry run — show what would change
}

export interface CocoIndexRunResult {
  success: boolean;
  appName?: string;
  durationMs: number;
  output: string;
  error?: string;
}

export interface CocoIndexAppInfo {
  name: string;
  status: string;
  lastUpdated?: string;
}

export interface CocoIndexStatus {
  available: boolean;
  version?: string;
  apps?: CocoIndexAppInfo[];
  error?: string;
}

// ─── Defaults ───────────────────────────────────────────────────

const COCO_BINARY = "cocoindex";
const SCRIPTS_DIR = ".obelisk/index/coco";

// ─── Adapter ────────────────────────────────────────────────────

export class CocoIndexAdapter {
  private binary: string;

  constructor(options: { binary?: string } = {}) {
    this.binary = options.binary || COCO_BINARY;
  }

  /**
   * Check if CocoIndex is installed.
   */
  async available(): Promise<boolean> {
    try {
      const { stdout } = await execFile(this.binary, ["--version"], { timeout: 10000 });
      return !!stdout;
    } catch {
      return false;
    }
  }

  /**
   * Get CocoIndex version and status.
   */
  async status(): Promise<CocoIndexStatus> {
    try {
      const { stdout: versionOut } = await execFile(this.binary, ["--version"], { timeout: 10000 });
      // Output is "cocoindex version X.Y.Z" — keep just the version number.
      const version = versionOut.trim().replace(/^cocoindex\s+version\s+/i, "");

      // List apps
      const apps = await this.listApps();

      return {
        available: true,
        version,
        apps,
      };
    } catch (err) {
      return {
        available: false,
        error: (err as Error).message,
      };
    }
  }

  /**
   * List registered CocoIndex apps.
   */
  async listApps(): Promise<CocoIndexAppInfo[]> {
    try {
      const { stdout } = await execFile(this.binary, ["ls", "--json"], { timeout: 15000 });
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        return parsed.map((app: any) => ({
          name: app.name || app.path || "unknown",
          status: app.status || "unknown",
          lastUpdated: app.last_updated,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Run a CocoIndex update pipeline.
   */
  async update(request: CocoIndexRunRequest): Promise<CocoIndexRunResult> {
    const start = Date.now();
    const appTarget = this.buildAppTarget(request);

    const args: string[] = ["update"];

    if (request.live) args.push("-L");
    if (request.preview) args.push("--preview");
    if (request.reset) args.push("--reset");
    if (request.fullReprocess) args.push("--full-reprocess");

    args.push(appTarget);

    try {
      const { stdout, stderr } = await execFile(this.binary, args, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 600000, // 10 min for large indexes
      });

      return {
        success: true,
        appName: request.appName,
        durationMs: Date.now() - start,
        output: stdout + (stderr || ""),
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return {
          success: false,
          durationMs: Date.now() - start,
          output: "",
          error: "CocoIndex not installed. Install with: pip install cocoindex",
        };
      }
      return {
        success: false,
        durationMs: Date.now() - start,
        output: err.stdout || "",
        error: err.stderr || err.message,
      };
    }
  }

  /**
   * Scaffold a new CocoIndex project.
   */
  async init(projectName: string, targetDir?: string): Promise<{ success: boolean; path: string; error?: string }> {
    const dir = targetDir || path.join(process.cwd(), projectName);

    try {
      // CocoIndex init creates the project in the current directory
      const { stdout, stderr } = await execFile(this.binary, ["init", projectName], {
        cwd: path.dirname(dir),
        timeout: 30000,
      });

      return { success: true, path: dir, error: stderr || undefined };
    } catch (err: any) {
      return { success: false, path: dir, error: err.message };
    }
  }

  /**
   * Drop a CocoIndex app and its data.
   */
  async drop(appTarget: string, force = false): Promise<{ success: boolean; error?: string }> {
    const args = ["drop"];
    if (force) args.push("--force");
    args.push(appTarget);

    try {
      await execFile(this.binary, args, { timeout: 30000 });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Generate a simple code embedding pipeline script.
   * Returns the path to the generated script.
   */
  generateEmbeddingScript(
    sourceDir: string,
    options: {
      chunkSize?: number;
      model?: string;
      tableName?: string;
    } = {},
  ): string {
    const scriptsDir = path.resolve(SCRIPTS_DIR);
    fs.mkdirSync(scriptsDir, { recursive: true });

    const chunkSize = options.chunkSize || 1000;
    const model = options.model || "sentence-transformers/all-MiniLM-L6-v2";
    const tableName = options.tableName || "code_embeddings";

    const script = `
import cocoindex
import cocoindex.ops.text as text_ops
import cocoindex.ops.sentence_transformers as embed_ops
from cocoindex.connectors import localfs

@cocoindex.fn(memo=True, version=1)
def detect_language(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    lang_map = {
        "py": "python", "js": "javascript", "ts": "typescript", "tsx": "typescript",
        "rs": "rust", "go": "go", "java": "java", "kt": "kotlin",
        "rb": "ruby", "php": "php", "c": "c", "cpp": "cpp", "h": "c",
        "cs": "csharp", "swift": "swift", "scala": "scala",
        "rs": "rust", "ex": "elixir", "exs": "elixir",
    }
    return lang_map.get(ext, "text")

@cocoindex.fn(memo=True, version=1)
def chunk_code(filename: str, content: str) -> list:
    language = detect_language(filename)
    splitter = text_ops.RecursiveSplitter()
    chunks = splitter.split(content, chunk_size=${chunkSize}, language=language)
    return [{"filename": filename, "language": language, "code": chunk, "chunk_index": i}
            for i, chunk in enumerate(chunks)]

@cocoindex.fn(memo=True, version=2)
def embed_chunk(chunk: dict) -> dict:
    embedder = embed_ops.SentenceTransformerEmbedder("${model}")
    embedding = embedder.embed(chunk["code"])
    return {**chunk, "embedding": embedding}

def main():
    with cocoindex.lifespan() as ctx:
        files = localfs.walk_dir("${sourceDir}")
        chunks = cocoindex.map(chunk_code, files, lambda f: (f.filename, f.content))
        embedded = cocoindex.map(embed_chunk, chunks)
        table = ctx.target("${tableName}")
        for item in embedded:
            table.declare_row(row=item)

app = cocoindex.App(
    cocoindex.AppConfig(name="${tableName}"),
    main,
)
`.trimStart();

    const scriptPath = path.join(scriptsDir, "code_embedding.py");
    fs.writeFileSync(scriptPath, script, "utf-8");
    return scriptPath;
  }

  private buildAppTarget(request: CocoIndexRunRequest): string {
    let target = request.appScript;

    // If the script content is provided inline, write it to a file
    if (!fs.existsSync(request.appScript) && request.appScript.includes("import")) {
      const scriptsDir = path.resolve(SCRIPTS_DIR);
      fs.mkdirSync(scriptsDir, { recursive: true });
      const scriptPath = path.join(scriptsDir, "generated_app.py");
      fs.writeFileSync(scriptPath, request.appScript, "utf-8");
      target = scriptPath;
    }

    if (request.appName) {
      target += `:${request.appName}`;
    }
    if (request.envName) {
      target += `@${request.envName}`;
    }
    return target;
  }
}