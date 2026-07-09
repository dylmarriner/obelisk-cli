/**
 * ZoektSearchAdapter — subprocess-based adapter for Zoekt code search.
 *
 * Zoekt (https://github.com/sourcegraph/zoekt) is a fast trigram-based
 * code search engine. This adapter communicates with it via subprocess:
 *   zoekt-index <dir>  — index a directory
 *   zoekt <query>      — search indexed files
 *
 * The eval/zoekt/ directory contains the Go source for reference.
 * Build with: go build ./cmd/zoekt/ && go build ./cmd/zoekt-index/
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { SearchAdapter, SearchResult, SearchQuery, IndexRequest, IndexResult, IndexStatus } from "./types";

const execFile = promisify(cp.execFile);

// ─── Defaults ───────────────────────────────────────────────────

const DEFAULT_INDEX_DIR = ".obelisk/index/zoekt";
const ZOEKT_BINARY = "zoekt";
const ZOEKT_INDEX_BINARY = "zoekt-index";

// ─── Adapter ─────────────────────────────────────────────────────

export class ZoektSearchAdapter implements SearchAdapter {
  private indexDir: string;
  private zoektBin: string;
  private zoektIndexBin: string;

  constructor(options: {
    indexDir?: string;
    zoektBin?: string;
    zoektIndexBin?: string;
  } = {}) {
    this.indexDir = options.indexDir || DEFAULT_INDEX_DIR;
    this.zoektBin = options.zoektBin || ZOEKT_BINARY;
    this.zoektIndexBin = options.zoektIndexBin || ZOEKT_INDEX_BINARY;
  }

  // ─── Search ───────────────────────────────────────────────────

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const indexDir = query.indexDir || this.indexDir;

    // Ensure index exists
    if (!fs.existsSync(indexDir)) {
      throw new Error(`No index found at ${indexDir}. Run 'obelisk index' first.`);
    }

    const args: string[] = [];

    // Set index directory
    args.push("-index", indexDir);

    // Set max results
    if (query.maxResults) {
      args.push("-max_match_count", String(query.maxResults));
    }

    // Regex mode
    if (query.regex) {
      // Zoekt uses regex by default for complex patterns
    }

    // File filter
    if (query.file) {
      args.push("-f", query.file);
    }

    // The query itself
    args.push(query.query);

    try {
      const { stdout, stderr } = await execFile(this.zoektBin, args, {
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 30000, // 30s
      });

      if (stderr && !stdout) {
        throw new Error(stderr.trim());
      }

      return this.parseResults(stdout, query.query);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(
          `Zoekt binary not found. Install with: go install github.com/sourcegraph/zoekt/cmd/zoekt@latest`
        );
      }
      throw err;
    }
  }

  // ─── Index ────────────────────────────────────────────────────

  async index(input: IndexRequest): Promise<IndexResult> {
    const indexDir = input.indexDir || this.indexDir;
    const repoPath = path.resolve(input.repoPath);

    // Ensure repo exists
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    // Create index directory
    fs.mkdirSync(indexDir, { recursive: true });

    const start = Date.now();
    const args: string[] = [];

    // Set index directory
    args.push("-index", indexDir);

    // Set name
    if (input.name) {
      args.push("-name", input.name);
    }

    // Incremental (default)
    if (input.incremental !== false) {
      args.push("-incremental");
    }

    // The directory to index
    args.push(repoPath);

    try {
      const { stdout, stderr } = await execFile(this.zoektIndexBin, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300000, // 5min
      });

      const durationMs = Date.now() - start;

      // Parse file count from output
      const fileCount = this.parseFileCount(stdout + stderr);

      // Get index size
      const sizeBytes = this.getIndexSize(indexDir);

      return {
        fileCount,
        sizeBytes,
        durationMs,
        indexPath: indexDir,
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(
          `Zoekt-index binary not found. Install with: go install github.com/sourcegraph/zoekt/cmd/zoekt-index@latest`
        );
      }
      throw err;
    }
  }

  // ─── Status ───────────────────────────────────────────────────

  async status(input: { indexDir?: string }): Promise<IndexStatus> {
    const indexDir = input.indexDir || this.indexDir;

    if (!fs.existsSync(indexDir)) {
      return {
        indexed: false,
        fileCount: 0,
        sizeBytes: 0,
        shardCount: 0,
        indexPath: indexDir,
      };
    }

    const shardFiles = fs.readdirSync(indexDir).filter((f) => f.endsWith(".shard"));

    // Try to search with empty query to check if index is valid
    let indexed = false;
    try {
      await this.search({ query: "", indexDir, maxResults: 1 });
      indexed = true;
    } catch {
      indexed = false;
    }

    return {
      indexed,
      lastIndexed: this.getLastModified(indexDir),
      fileCount: 0, // Zoekt doesn't expose this directly
      sizeBytes: this.getIndexSize(indexDir),
      shardCount: shardFiles.length,
      indexPath: indexDir,
    };
  }

  // ─── Rebuild ──────────────────────────────────────────────────

  async rebuild(input: IndexRequest): Promise<IndexResult> {
    // Remove existing index and re-index
    const indexDir = input.indexDir || this.indexDir;
    if (fs.existsSync(indexDir)) {
      fs.rmSync(indexDir, { recursive: true, force: true });
    }
    return this.index(input);
  }

  // ─── Available ────────────────────────────────────────────────

  async available(): Promise<boolean> {
    try {
      await execFile(this.zoektBin, ["-h"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Private: Parse Results ───────────────────────────────────

  private parseResults(output: string, _query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      // Zoekt output format: file:line:column:content
      const match = line.match(/^([^:]+):(\d+):(\d+):(.*)$/);
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          content: match[4],
          matchLength: match[4].length,
        });
      }
    }

    return results;
  }

  private parseFileCount(output: string): number {
    const match = output.match(/(\d+)\s+files?/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  private getIndexSize(indexDir: string): number {
    if (!fs.existsSync(indexDir)) return 0;
    let total = 0;
    for (const file of fs.readdirSync(indexDir)) {
      try {
        total += fs.statSync(path.join(indexDir, file)).size;
      } catch {
        // skip
      }
    }
    return total;
  }

  private getLastModified(indexDir: string): string | undefined {
    if (!fs.existsSync(indexDir)) return undefined;
    let latest = 0;
    for (const file of fs.readdirSync(indexDir)) {
      try {
        const mtime = fs.statSync(path.join(indexDir, file)).mtimeMs;
        if (mtime > latest) latest = mtime;
      } catch {
        // skip
      }
    }
    return latest > 0 ? new Date(latest).toISOString() : undefined;
  }
}