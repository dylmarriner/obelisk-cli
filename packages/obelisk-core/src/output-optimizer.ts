/**
 * OutputOptimizer — compresses tool outputs and LLM responses.
 *
 * After the LLM responds, tool outputs can be massive (git diffs, build logs,
 * search results). This optimizer compresses them before they go back into
 * context, storing the originals in the ReversibleBlobStore for recovery.
 *
 * Techniques:
 *   1. Git diff compaction — collapse unchanged hunks, summarize
 *   2. Build log compaction — keep only errors, warnings, results
 *   3. Search result compaction — deduplicate, truncate long matches
 *   4. JSON compaction — remove whitespace, truncate deep structures
 *   5. Stack trace compaction — keep only unique frames
 *   6. List/directory compaction — collapse repeated patterns
 *   7. Generic output truncation — keep head + tail, summarize middle
 */

import { ReversibleBlobStore } from "./reversible-blob-store";
import { estimateTokens } from "./input-optimizer";

// ─── Types ──────────────────────────────────────────────────────

export interface OutputOptimizerOptions {
  maxOutputTokens: number;       // Max tokens per tool output (default: 24000)
  maxLines: number;              // Max lines per output (default: 500)
  keepHeadLines: number;         // Lines to keep from the start (default: 100)
  keepTailLines: number;         // Lines to keep from the end (default: 100)
  compactGitDiff: boolean;       // Compact git diff output
  compactBuildLog: boolean;      // Compact build/test logs
  compactSearchResults: boolean; // Compact search/grep results
  compactJson: boolean;          // Compact JSON output
  reversible: boolean;           // Store originals for recovery
}

export const DEFAULT_OUTPUT_OPTIONS: OutputOptimizerOptions = {
  maxOutputTokens: 24000,
  maxLines: 500,
  keepHeadLines: 100,
  keepTailLines: 100,
  compactGitDiff: true,
  compactBuildLog: true,
  compactSearchResults: true,
  compactJson: true,
  reversible: true,
};

export interface OutputOptimizerReport {
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savedPercent: number;
  layers: { name: string; savedTokens: number }[];
  handle?: string;
  truncated: boolean;
}

// ─── Optimizer ──────────────────────────────────────────────────

export class OutputOptimizer {
  private options: OutputOptimizerOptions;
  private store: ReversibleBlobStore;

  constructor(options: Partial<OutputOptimizerOptions> = {}, store?: ReversibleBlobStore) {
    this.options = { ...DEFAULT_OUTPUT_OPTIONS, ...options };
    this.store = store || new ReversibleBlobStore();
  }

  /**
   * Optimize a tool output for LLM context — compress without losing signal.
   */
  optimize(text: string, outputType?: string): { text: string; report: OutputOptimizerReport } {
    const inputTokens = estimateTokens(text);
    const layers: OutputOptimizerReport["layers"] = [];
    let current = text;
    let truncated = false;

    // Store original for reversible recovery
    let handle: string | undefined;
    if (this.options.reversible) {
      handle = this.store.store(text, outputType || "tool-output");
    }

    // Detect output type and apply specialized compression
    const detectedType = outputType || this.detectOutputType(text);

    switch (detectedType) {
      case "git-diff":
        current = this.compactGitDiff(current, layers);
        break;
      case "build-log":
        current = this.compactBuildLog(current, layers);
        break;
      case "search-results":
        current = this.compactSearchResults(current, layers);
        break;
      case "json":
        if (this.options.compactJson) {
          current = this.compactJsonOutput(current, layers);
        }
        break;
      case "stack-trace":
        current = this.compactStackTrace(current, layers);
        break;
      case "directory-listing":
        current = this.compactDirectoryListing(current, layers);
        break;
      default:
        // Generic compaction
        current = this.genericCompact(current, layers);
        break;
    }

    // Ensure we don't exceed max tokens
    const estimatedTokens = estimateTokens(current);
    if (estimatedTokens > this.options.maxOutputTokens) {
      current = this.truncateByTokens(current, this.options.maxOutputTokens, layers);
      truncated = true;
    }

    // Ensure we don't exceed max lines
    const lineCount = current.split("\n").length;
    if (lineCount > this.options.maxLines) {
      current = this.truncateByLines(current, this.options.maxLines, layers);
      truncated = true;
    }

    const outputTokens = estimateTokens(current);
    const savedTokens = inputTokens - outputTokens;
    const savedPercent = inputTokens > 0 ? (savedTokens / inputTokens) * 100 : 0;

    return {
      text: current,
      report: {
        inputTokens,
        outputTokens,
        savedTokens,
        savedPercent: Math.round(savedPercent * 100) / 100,
        layers,
        handle,
        truncated,
      },
    };
  }

  // ─── Output Type Detection ────────────────────────────────────

  private detectOutputType(text: string): string {
    if (text.startsWith("diff --git") || text.includes("\n--- a/") || text.includes("\n+++ b/")) {
      return "git-diff";
    }
    if (/\b(BUILD|ERROR|WARNING|FAILED|PASSED|test result:)\b/i.test(text) && /\d+\s+(passed|failed|error)/i.test(text)) {
      return "build-log";
    }
    if (text.includes(":.ts:") || text.includes(":.rs:") || text.includes(":.py:") || /:\d+:\d+:/.test(text)) {
      return "search-results";
    }
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try { JSON.parse(text.trim()); return "json"; } catch {}
    }
    if (/\bat\s+\S+\.\w+:\d+\b/.test(text) && /\bError\b/.test(text)) {
      return "stack-trace";
    }
    if (text.split("\n").length > 10 && text.split("\n").every((l) => l.startsWith("/") || l.startsWith("./") || l.startsWith(".."))) {
      return "directory-listing";
    }
    return "generic";
  }

  // ─── Git Diff Compaction ──────────────────────────────────────

  private compactGitDiff(text: string, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);

    const lines = text.split("\n");
    const result: string[] = [];
    let inHunk = false;
    let contextLines = 0;
    let skippedContext = false;
    const MAX_CONTEXT = 3;

    for (const line of lines) {
      if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
        if (skippedContext) result.push("  … [context truncated]");
        result.push(line);
        inHunk = false;
        skippedContext = false;
        continue;
      }

      if (line.startsWith("@@")) {
        if (skippedContext) result.push("  … [context truncated]");
        result.push(line);
        inHunk = true;
        contextLines = 0;
        skippedContext = false;
        continue;
      }

      if (inHunk) {
        if (line.startsWith("+") || line.startsWith("-")) {
          result.push(line);
          contextLines = 0;
          skippedContext = false;
        } else if (contextLines < MAX_CONTEXT) {
          result.push(line);
          contextLines++;
          skippedContext = false;
        } else {
          if (!skippedContext) {
            skippedContext = true;
          }
        }
      } else {
        result.push(line);
      }
    }

    if (skippedContext) result.push("  … [context truncated]");

    const after = estimateTokens(result.join("\n"));
    if (before > after) {
      layers.push({ name: "git-diff-compact", savedTokens: before - after });
    }

    return result.join("\n");
  }

  // ─── Build Log Compaction ─────────────────────────────────────

  private compactBuildLog(text: string, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);

    const lines = text.split("\n");
    const result: string[] = [];

    // Keep: errors, warnings, results, test names, location lines
    // Drop: progress, compilation steps, downloading, etc.
    for (const line of lines) {
      const trimmed = line.trim();

      // Always keep errors and warnings
      if (/\b(error|warning|failed|failure|panic|exception|fatal|traceback)\b/i.test(trimmed)) {
        result.push(line);
        continue;
      }

      // Always keep test results
      if (/\b(PASS|FAIL|✓|✗|×|test result:|passed|failed|ok)\b/i.test(trimmed)) {
        result.push(line);
        continue;
      }

      // Always keep location lines
      if (/:\d+:\d+/.test(trimmed) || /^\s*-->\s/.test(trimmed)) {
        result.push(line);
        continue;
      }

      // Drop noise lines
      if (/^\s*(compiling|downloading|fetching|updating|building|resolving|reading|writing|reused|locking|preparing|added \d)/i.test(trimmed)) {
        continue;
      }

      // Keep everything else (but it will be truncated later if needed)
      result.push(line);
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) {
      layers.push({ name: "build-log-compact", savedTokens: before - after });
    }

    return result.join("\n");
  }

  // ─── Search Results Compaction ────────────────────────────────

  private compactSearchResults(text: string, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);

    // Deduplicate and truncate long matches
    const seen = new Set<string>();
    const lines = text.split("\n");
    const result: string[] = [];

    for (const line of lines) {
      // Deduplicate identical lines
      if (seen.has(line)) continue;
      seen.add(line);

      // Truncate very long lines
      if (line.length > 500) {
        result.push(line.substring(0, 200) + `… [truncated ${line.length - 200} chars]`);
      } else {
        result.push(line);
      }
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) {
      layers.push({ name: "search-compact", savedTokens: before - after });
    }

    return result.join("\n");
  }

  // ─── JSON Compaction ──────────────────────────────────────────

  private compactJsonOutput(text: string, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);

    try {
      const parsed = JSON.parse(text.trim());
      // Re-stringify without whitespace
      const compact = JSON.stringify(parsed);

      // If still too large, truncate deep structures
      if (compact.length > 10000) {
        const truncated = JSON.stringify(parsed, (key, value) => {
          if (typeof value === "string" && value.length > 500) {
            return value.substring(0, 200) + `… [truncated ${value.length - 200} chars]`;
          }
          if (Array.isArray(value) && value.length > 50) {
            return value.slice(0, 50).concat(`… [${value.length - 50} more items]`);
          }
          return value;
        });

        const after = estimateTokens(truncated);
        if (before > after) {
          layers.push({ name: "json-compact", savedTokens: before - after });
        }
        return truncated;
      }

      const after = estimateTokens(compact);
      if (before > after) {
        layers.push({ name: "json-compact", savedTokens: before - after });
      }
      return compact;
    } catch {
      return text;
    }
  }

  // ─── Stack Trace Compaction ───────────────────────────────────

  private compactStackTrace(text: string, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);

    // Deduplicate repeated frames
    const seen = new Set<string>();
    const lines = text.split("\n");
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Keep error messages always
      if (trimmed.startsWith("Error:") || trimmed.startsWith("error:")) {
        result.push(line);
        continue;
      }
      // Deduplicate stack frames
      if (trimmed.startsWith("at ")) {
        const frame = trimmed.replace(/\d+:\d+/, "line:col");
        if (seen.has(frame)) continue;
        seen.add(frame);
      }
      result.push(line);
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) {
      layers.push({ name: "stack-compact", savedTokens: before - after });
    }

    return result.join("\n");
  }

  // ─── Directory Listing Compaction ─────────────────────────────

  private compactDirectoryListing(text: string, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);

    // Group by directory and show counts
    const lines = text.split("\n").filter(Boolean);
    if (lines.length < 20) return text;

    const dirs = new Map<string, number>();
    for (const line of lines) {
      const dir = line.substring(0, line.lastIndexOf("/") + 1) || "./";
      dirs.set(dir, (dirs.get(dir) || 0) + 1);
    }

    const result: string[] = [];
    result.push(`[obelisk: directory listing compacted — ${lines.length} entries in ${dirs.size} directories]`);
    for (const [dir, count] of dirs) {
      result.push(`  ${dir} (${count} entries)`);
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) {
      layers.push({ name: "dir-compact", savedTokens: before - after });
    }

    return result.join("\n");
  }

  // ─── Generic Compaction ───────────────────────────────────────

  private genericCompact(text: string, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);

    // Strip ANSI
    let result = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

    // Collapse blank lines
    result = result.replace(/\n{4,}/g, "\n\n\n");

    // Remove trailing whitespace
    result = result.replace(/[ \t]+\n/g, "\n");

    const after = estimateTokens(result);
    if (before > after) {
      layers.push({ name: "generic-compact", savedTokens: before - after });
    }

    return result;
  }

  // ─── Truncation ───────────────────────────────────────────────

  private truncateByTokens(text: string, maxTokens: number, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);
    const chars = maxTokens * 4;

    if (text.length <= chars) return text;

    // Keep head + tail, summarize middle
    const headLen = Math.floor(chars * 0.4);
    const tailLen = Math.floor(chars * 0.4);
    const head = text.substring(0, headLen);
    const tail = text.substring(text.length - tailLen);
    const middle = text.substring(headLen, text.length - tailLen);

    const after = estimateTokens(head + tail);
    layers.push({ name: "token-truncate", savedTokens: before - after });

    return `${head}\n\n… [obelisk: ${estimateTokens(middle)} tokens omitted — use \`obelisk restore\` for full output]\n\n${tail}`;
  }

  private truncateByLines(text: string, maxLines: number, layers: { name: string; savedTokens: number }[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");

    if (lines.length <= maxLines) return text;

    const head = lines.slice(0, this.options.keepHeadLines);
    const tail = lines.slice(-this.options.keepTailLines);
    const omitted = lines.length - head.length - tail.length;

    const result = [...head, `… [obelisk: ${omitted} lines omitted — use \`obelisk restore\` for full output]`, ...tail].join("\n");

    const after = estimateTokens(result);
    layers.push({ name: "line-truncate", savedTokens: before - after });

    return result;
  }
}