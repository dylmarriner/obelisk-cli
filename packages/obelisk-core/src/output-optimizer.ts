/**
 * OutputOptimizer — aggressively compresses tool outputs for LLM context.
 *
 * Every transformation is reversible. Originals are stashed in the blob store.
 * This allows extremely aggressive compression — log folding, pattern dedup,
 * JSON key compaction, and more — because the original is always recoverable.
 *
 * === Compression Layers ===
 *
 *  Type-aware specialized:
 *    Git diff compact      40-65%   Keep only ± lines, limit context, fold hunks
 *    Build log compact     50-70%   Keep errors/warnings/results, drop noise
 *    Search dedup          30-50%   Deduplicate, truncate long matches
 *    JSON compact          20-40%   Remove whitespace, truncate deep structures
 *    Stack trace compact   40-60%   Deduplicate frames, truncate paths
 *    Directory listing     60-80%   Group by directory, show counts
 *    Test log compact      50-75%   Keep only failures and summary
 *    Lint output compact   40-60%   Keep only error lines, group by severity
 *
 *  Generic:
 *    Log folding           30-50%   Detect and compress repeated log patterns
 *    Cross-source dedup    10-20%   Remove duplicates across outputs
 *    Line truncation       config   Keep head + tail, summarize middle
 *    Token truncation      config   Budget-aware truncation
 */

import { ReversibleBlobStore } from "./reversible-blob-store";
import { estimateTokens } from "./input-optimizer";
import { SecretRedactor } from "./secret-redactor";

// ─── Types ──────────────────────────────────────────────────────

export interface OutputOptimizerOptions {
  maxOutputTokens: number;
  maxLines: number;
  keepHeadLines: number;
  keepTailLines: number;
  compactGitDiff: boolean;
  compactBuildLog: boolean;
  compactSearchResults: boolean;
  compactJson: boolean;
  compactStackTrace: boolean;
  compactDirectoryListing: boolean;
  compactTestLog: boolean;
  compactLintOutput: boolean;
  foldRepeatedLogs: boolean;
  crossSourceDedup: boolean;
  reversible: boolean;
  redactSecrets: boolean;
}

export const AGGRESSIVE_OUTPUT_OPTIONS: OutputOptimizerOptions = {
  maxOutputTokens: 8000,
  maxLines: 200,
  keepHeadLines: 50,
  keepTailLines: 50,
  compactGitDiff: true,
  compactBuildLog: true,
  compactSearchResults: true,
  compactJson: true,
  compactStackTrace: true,
  compactDirectoryListing: true,
  compactTestLog: true,
  compactLintOutput: true,
  foldRepeatedLogs: true,
  crossSourceDedup: true,
  reversible: true,
  redactSecrets: true,
};

export interface OutputOptimizerLayer {
  name: string;
  savedTokens: number;
  description: string;
}

export interface OutputOptimizerReport {
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savedPercent: number;
  layers: OutputOptimizerLayer[];
  handle?: string;
  truncated: boolean;
  detectedType: string;
  secretsRedacted: number;
}

// ─── Optimizer ──────────────────────────────────────────────────

export class OutputOptimizer {
  private options: OutputOptimizerOptions;
  private store: ReversibleBlobStore;
  private seenContent = new Set<string>();
  private redactor: SecretRedactor;

  constructor(options: Partial<OutputOptimizerOptions> = {}, store?: ReversibleBlobStore, redactor?: SecretRedactor) {
    this.options = { ...AGGRESSIVE_OUTPUT_OPTIONS, ...options };
    this.store = store || new ReversibleBlobStore();
    this.redactor = redactor || new SecretRedactor();
  }

  optimize(text: string, outputType?: string): { text: string; report: OutputOptimizerReport } {
    const inputTokens = estimateTokens(text);
    const layers: OutputOptimizerLayer[] = [];
    let current = text;
    let truncated = false;

    // Store original for reversible recovery — the unredacted original is
    // intentionally preserved here; redaction only applies to what flows
    // onward to the model, not to what `optimize restore` returns.
    let handle: string | undefined;
    if (this.options.reversible) {
      handle = this.store.store(text, outputType || "tool-output");
    }

    let secretsRedacted = 0;
    if (this.options.redactSecrets) {
      const before = estimateTokens(current);
      const redactResult = this.redactor.redact(current);
      if (redactResult.findings.length > 0) {
        current = redactResult.text;
        secretsRedacted = redactResult.findings.reduce((sum, f) => sum + f.count, 0);
        const after = estimateTokens(current);
        layers.push({
          name: "secret-redact",
          savedTokens: before - after,
          description: `Redacted ${secretsRedacted} secret(s): ${redactResult.findings.map((f) => f.pattern).join(", ")}`,
        });
      }
    }

    const detectedType = outputType || this.detectOutputType(current);

    // Apply type-specific compression
    switch (detectedType) {
      case "git-diff":
        current = this.compactGitDiff(current, layers);
        break;
      case "build-log":
        current = this.compactBuildLog(current, layers);
        break;
      case "test-log":
        if (this.options.compactTestLog) current = this.compactTestLog(current, layers);
        else current = this.compactBuildLog(current, layers);
        break;
      case "lint-output":
        if (this.options.compactLintOutput) current = this.compactLintOutput(current, layers);
        else current = this.compactBuildLog(current, layers);
        break;
      case "search-results":
        if (this.options.compactSearchResults) current = this.compactSearchResults(current, layers);
        break;
      case "json":
        if (this.options.compactJson) current = this.compactJsonOutput(current, layers);
        break;
      case "stack-trace":
        if (this.options.compactStackTrace) current = this.compactStackTrace(current, layers);
        break;
      case "directory-listing":
        if (this.options.compactDirectoryListing) current = this.compactDirectoryListing(current, layers);
        break;
      default:
        current = this.genericCompact(current, layers);
        break;
    }

    // Fold repeated log patterns
    if (this.options.foldRepeatedLogs) {
      current = this.foldRepeatedLogs(current, layers);
    }

    // Cross-source dedup
    if (this.options.crossSourceDedup) {
      current = this.crossSourceDedup(current, layers);
    }

    // Strip ANSI (belt and suspenders)
    current = current.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

    // Token budget truncation
    const estimated = estimateTokens(current);
    if (estimated > this.options.maxOutputTokens) {
      current = this.truncateByTokens(current, this.options.maxOutputTokens, layers);
      truncated = true;
    }

    // Line count truncation
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
        detectedType,
        secretsRedacted,
      },
    };
  }

  // ─── Output Type Detection ────────────────────────────────────

  private detectOutputType(text: string): string {
    if (text.startsWith("diff --git") || text.includes("\n--- a/") || text.includes("\n+++ b/"))
      return "git-diff";
    if (/\b(BUILD|FAILED|PASSED|test result:|ok|FAIL|✓|✗)\b/i.test(text) && /\d+\s+(passed|failed|error|test|example)/i.test(text))
      return "test-log";
    if (/\b(error|warning)\b/i.test(text) && /:\d+:\d+/.test(text) && /\b(lint|eslint|oxlint|biome|ruff|clippy)\b/i.test(text))
      return "lint-output";
    if (/\b(BUILD|ERROR|WARNING|FAILED|PASSED)\b/i.test(text) && /\d+\s+(passed|failed|error)/i.test(text))
      return "build-log";
    if (/:(\d+):(\d+):/.test(text) && text.split("\n").length > 5)
      return "search-results";
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try { JSON.parse(text.trim()); return "json"; } catch {}
    }
    if (/\bat\s+\S+\.\w+:\d+\b/.test(text) && /\bError\b/.test(text))
      return "stack-trace";
    if (text.split("\n").length > 5 && text.split("\n").every((l) => /^[\s/.\w-]+$/.test(l.trim())))
      return "directory-listing";
    return "generic";
  }

  // ─── Git Diff: 40-65% ────────────────────────────────────────

  private compactGitDiff(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");
    const result: string[] = [];
    let inHunk = false;
    let contextCount = 0;
    const MAX_CONTEXT = 2;
    let skippedContext = false;

    for (const line of lines) {
      if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
        if (skippedContext) result.push("  … [ctx]");
        result.push(line);
        inHunk = false;
        skippedContext = false;
        continue;
      }
      if (line.startsWith("@@")) {
        if (skippedContext) result.push("  … [ctx]");
        result.push(line);
        inHunk = true;
        contextCount = 0;
        skippedContext = false;
        continue;
      }
      if (inHunk) {
        if (line.startsWith("+") || line.startsWith("-")) {
          result.push(line);
          contextCount = 0;
          skippedContext = false;
        } else if (contextCount < MAX_CONTEXT) {
          result.push(line);
          contextCount++;
          skippedContext = false;
        } else if (!skippedContext) {
          skippedContext = true;
        }
      } else {
        result.push(line);
      }
    }
    if (skippedContext) result.push("  … [ctx]");

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "git-diff", savedTokens: before - after, description: "Keep ± lines, 2 context lines max" });
    return result.join("\n");
  }

  // ─── Build Log: 50-70% ────────────────────────────────────────

  private compactBuildLog(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");
    const result: string[] = [];
    let inCompilation = false;
    let compilationCount = 0;

    for (const line of lines) {
      const t = line.trim();

      // Always keep: errors, warnings, failures
      if (/\b(error|warning|failed|failure|panic|exception|fatal|traceback|cannot find|cannot resolve|undefined reference|unresolved|not found)\b/i.test(t)) {
        result.push(line);
        inCompilation = false;
        continue;
      }

      // Always keep: test results
      if (/\b(PASS|FAIL|✓|✗|×|test result:|passed|failed|ok|tests? completed|BUILD SUCCESS|BUILD FAILURE)\b/i.test(t)) {
        result.push(line);
        inCompilation = false;
        continue;
      }

      // Always keep: location lines
      if (/:\d+:\d+/.test(t) || /^\s*-->\s/.test(t)) {
        result.push(line);
        inCompilation = false;
        continue;
      }

      // Drop: compilation noise
      if (/^\s*(compiling|downloading|fetching|updating|building|resolving|reading|writing|reused|locking|preparing|added \d|packages in|running|checking|verifying|generating)\b/i.test(t)) {
        if (!inCompilation) {
          inCompilation = true;
          compilationCount = 1;
        } else {
          compilationCount++;
        }
        continue;
      }

      // Drop: cargo/rustc noise
      if (/^\s*(error\[|warning\[|note\[|help\[| =\s*note| =\s*help)/i.test(t)) {
        result.push(line);
        continue;
      }

      // Drop: npm/pip noise lines
      if (/^\s*(added|removed|updated|audited|found|packages in|what is)\b/i.test(t)) {
        continue;
      }

      result.push(line);
      inCompilation = false;
    }

    if (compilationCount > 5) {
      result.push(`  … [${compilationCount} compilation steps omitted]`);
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "build-log", savedTokens: before - after, description: "Keep errors/warnings/results, drop compilation noise" });
    return result.join("\n");
  }

  // ─── Test Log: 50-75% ─────────────────────────────────────────

  private compactTestLog(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");

    // Keep only: test failures, summary line, error details
    const result: string[] = [];
    let inPassingBlock = false;
    let passingCount = 0;

    for (const line of lines) {
      const t = line.trim();

      // Always keep failures
      if (/\b(FAIL|FAILED|✗|×|failure|ERROR|error)\b/i.test(t) && /:\d+/.test(t)) {
        if (inPassingBlock) {
          inPassingBlock = false;
        }
        result.push(line);
        continue;
      }

      // Always keep summary
      if (/\b(test result:|tests? completed|passed|failed|ok|FAILURES)\b/i.test(t)) {
        if (inPassingBlock) {
          inPassingBlock = false;
        }
        result.push(line);
        continue;
      }

      // Always keep error details
      if (/^\s*at\s/.test(t) || /^\s*#\s/.test(t) || /^\s*-->\s/.test(t)) {
        result.push(line);
        continue;
      }

      // Collapse passing tests
      if (/\b(PASS|✓|ok|passed)\b/i.test(t)) {
        if (!inPassingBlock) {
          inPassingBlock = true;
          passingCount = 1;
        } else {
          passingCount++;
        }
        continue;
      }

      result.push(line);
      inPassingBlock = false;
    }

    if (passingCount > 3) {
      result.push(`  … [${passingCount} passing tests omitted]`);
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "test-log", savedTokens: before - after, description: "Keep failures+summary, collapse passing tests" });
    return result.join("\n");
  }

  // ─── Lint Output: 40-60% ──────────────────────────────────────

  private compactLintOutput(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");

    // Group by severity, keep only error lines with locations
    const errors: string[] = [];
    const warnings: string[] = [];
    let summary = "";

    for (const line of lines) {
      const t = line.trim();
      if (/error/.test(t) && /:\d+:\d+/.test(t)) errors.push(line);
      else if (/warning/.test(t) && /:\d+:\d+/.test(t)) warnings.push(line);
      if (/\b(\d+ problems?|\d+ errors?|\d+ warnings?)\b/i.test(t)) summary = line;
    }

    const result: string[] = [];
    result.push(`[lint: ${errors.length} errors, ${warnings.length} warnings]`);
    if (errors.length > 0) {
      result.push("", "errors:", ...errors.slice(0, 20));
      if (errors.length > 20) result.push(`  … [${errors.length - 20} more errors]`);
    }
    if (warnings.length > 0) {
      result.push("", "warnings:", ...warnings.slice(0, 10));
      if (warnings.length > 10) result.push(`  … [${warnings.length - 10} more warnings]`);
    }
    if (summary) result.push("", summary);

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "lint-compact", savedTokens: before - after, description: "Group by severity, keep only error lines" });
    return result.join("\n");
  }

  // ─── Search Results: 30-50% ───────────────────────────────────

  private compactSearchResults(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const seen = new Set<string>();
    const lines = text.split("\n");
    const result: string[] = [];

    for (const line of lines) {
      const normalized = line.replace(/:\d+:\d+/, ":L:C").trim();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      if (line.length > 300) {
        result.push(line.substring(0, 150) + `… [+${line.length - 150}ch]`);
      } else {
        result.push(line);
      }
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "search-dedup", savedTokens: before - after, description: "Deduplicate results, truncate long lines" });
    return result.join("\n");
  }

  // ─── JSON: 20-40% ─────────────────────────────────────────────

  private compactJsonOutput(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    try {
      const parsed = JSON.parse(text.trim());
      const compact = JSON.stringify(parsed);

      if (compact.length > 5000) {
        const truncated = JSON.stringify(parsed, (key, value) => {
          if (typeof value === "string" && value.length > 200) {
            return value.substring(0, 100) + `… [+${value.length - 100}ch]`;
          }
          if (Array.isArray(value) && value.length > 30) {
            return value.slice(0, 30).concat(`… [${value.length - 30} more]`);
          }
          if (typeof value === "object" && value !== null && Object.keys(value).length > 20) {
            const keys = Object.keys(value).slice(0, 20);
            const result: Record<string, unknown> = {};
            for (const k of keys) result[k] = value[k];
            result["…"] = `[${Object.keys(value).length - 20} more keys]`;
            return result;
          }
          return value;
        });
        const after = estimateTokens(truncated);
        if (before > after) layers.push({ name: "json-compact", savedTokens: before - after, description: "Minify, truncate deep structures, limit arrays" });
        return truncated;
      }

      const after = estimateTokens(compact);
      if (before > after) layers.push({ name: "json-minify", savedTokens: before - after, description: "Remove JSON whitespace" });
      return compact;
    } catch {
      return text;
    }
  }

  // ─── Stack Trace: 40-60% ──────────────────────────────────────

  private compactStackTrace(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const seen = new Set<string>();
    const lines = text.split("\n");
    const result: string[] = [];
    let deduped = 0;

    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("Error:") || t.startsWith("error:")) {
        result.push(line);
        continue;
      }
      if (t.startsWith("at ")) {
        // Normalize line numbers for dedup
        const frame = t.replace(/:\d+:\d+/, ":L:C").replace(/\(.*\)/, "(…)");
        if (seen.has(frame)) {
          deduped++;
          continue;
        }
        seen.add(frame);
      }
      result.push(line);
    }

    if (deduped > 0) {
      result.push(`  … [${deduped} duplicate frames collapsed]`);
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "stack-dedup", savedTokens: before - after, description: "Deduplicate stack frames, normalize line numbers" });
    return result.join("\n");
  }

  // ─── Directory Listing: 60-80% ────────────────────────────────

  private compactDirectoryListing(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n").filter(Boolean);
    if (lines.length < 10) return text;

    // Group by directory depth
    const dirs = new Map<string, number>();
    const exts = new Map<string, number>();

    for (const line of lines) {
      const t = line.trim();
      // Count by extension
      const ext = t.includes(".") ? t.split(".").pop() || "(no ext)" : "(no ext)";
      exts.set(ext, (exts.get(ext) || 0) + 1);
      // Count by directory
      const dir = t.substring(0, t.lastIndexOf("/") + 1) || "./";
      dirs.set(dir, (dirs.get(dir) || 0) + 1);
    }

    const result: string[] = [];
    result.push(`[obelisk: ${lines.length} files in ${dirs.size} directories]`);
    result.push("");

    // Show directory structure
    const sortedDirs = [...dirs.entries()].sort((a, b) => b[1] - a[1]);
    for (const [dir, count] of sortedDirs.slice(0, 20)) {
      const indent = dir.split("/").length - 1;
      result.push(`${"  ".repeat(indent)}${dir} (${count} files)`);
    }
    if (sortedDirs.length > 20) {
      result.push(`  … [${sortedDirs.length - 20} more directories]`);
    }

    result.push("");
    result.push("File types:");
    const sortedExts = [...exts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [ext, count] of sortedExts.slice(0, 10)) {
      result.push(`  .${ext}: ${count}`);
    }
    if (sortedExts.length > 10) {
      result.push(`  … [${sortedExts.length - 10} more types]`);
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "dir-compact", savedTokens: before - after, description: "Group by directory and extension, show counts" });
    return result.join("\n");
  }

  // ─── Log Folding: 30-50% ──────────────────────────────────────

  private foldRepeatedLogs(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      // Look for repeated single-line patterns
      let count = 1;
      while (i + count < lines.length && lines[i + count] === lines[i]) {
        count++;
      }

      if (count >= 3) {
        const handle = this.store.store(lines[i]!, "repeated-log-line");
        result.push(`  … [×${count} — blob:${handle}]`);
        i += count;
        continue;
      }

      // Look for repeated multi-line patterns (2-3 lines, 3+ times)
      if (i + 6 <= lines.length) {
        let bestLen = 0;
        let bestCount = 0;
        for (let pl = 1; pl <= 3; pl++) {
          const pattern = lines.slice(i, i + pl).join("\n");
          let c = 1;
          for (let j = i + pl; j + pl <= lines.length; j += pl) {
            if (lines.slice(j, j + pl).join("\n") === pattern) c++;
            else break;
          }
          if (c >= 3 && c * pl > bestCount * bestLen) {
            bestLen = pl;
            bestCount = c;
          }
        }
        if (bestCount >= 3) {
          const pattern = lines.slice(i, i + bestLen).join("\n");
          const handle = this.store.store(pattern, "repeated-pattern");
          result.push(`  … [pattern ×${bestCount} — blob:${handle}]`);
          i += bestCount * bestLen;
          continue;
        }
      }

      result.push(lines[i]!);
      i++;
    }

    const after = estimateTokens(result.join("\n"));
    if (before > after) layers.push({ name: "log-fold", savedTokens: before - after, description: "Fold repeated log lines and patterns" });
    return result.join("\n");
  }

  // ─── Cross-Source Dedup: 10-20% ───────────────────────────────

  private crossSourceDedup(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");
    const result: string[] = [];
    let deduped = 0;

    for (const line of lines) {
      const t = line.trim();
      if (t.length > 30 && this.seenContent.has(t)) {
        deduped++;
        continue;
      }
      if (t.length > 30) this.seenContent.add(t);
      result.push(line);
    }

    const after = estimateTokens(result.join("\n"));
    if (deduped > 0) layers.push({ name: "cross-source", savedTokens: before - after, description: `Removed ${deduped} duplicate lines across outputs` });
    return result.join("\n");
  }

  // ─── Generic Compact ──────────────────────────────────────────

  private genericCompact(text: string, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    result = result.replace(/\n{4,}/g, "\n\n\n");
    result = result.replace(/[ \t]+\n/g, "\n");

    const after = estimateTokens(result);
    if (before > after) layers.push({ name: "generic", savedTokens: before - after, description: "Strip ANSI, collapse blanks, trim whitespace" });
    return result;
  }

  // ─── Truncation ───────────────────────────────────────────────

  private truncateByTokens(text: string, maxTokens: number, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const chars = maxTokens * 4;
    if (text.length <= chars) return text;

    const headLen = Math.floor(chars * 0.45);
    const tailLen = Math.floor(chars * 0.45);
    const head = text.substring(0, headLen);
    const tail = text.substring(text.length - tailLen);
    const omitted = estimateTokens(text.substring(headLen, text.length - tailLen));

    const result = `${head}\n\n… [obelisk: ${omitted} tokens omitted — restore with \`obelisk optimize restore ${this.store.store(text, "truncated-output")}\`]\n\n${tail}`;
    const after = estimateTokens(result);
    layers.push({ name: "token-truncate", savedTokens: before - after, description: `Budget-aware truncation to ${maxTokens.toLocaleString()} tokens` });
    return result;
  }

  private truncateByLines(text: string, maxLines: number, layers: OutputOptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");
    if (lines.length <= maxLines) return text;

    const head = lines.slice(0, this.options.keepHeadLines);
    const tail = lines.slice(-this.options.keepTailLines);
    const omitted = lines.length - head.length - tail.length;

    const handle = this.store.store(text, "truncated-output");
    const result = [...head, `… [obelisk: ${omitted} lines omitted — restore with \`obelisk optimize restore ${handle}\`]`, ...tail].join("\n");
    const after = estimateTokens(result);
    layers.push({ name: "line-truncate", savedTokens: before - after, description: `Head+tail truncation, keep ${this.options.keepHeadLines}+${this.options.keepTailLines} lines` });
    return result;
  }
}