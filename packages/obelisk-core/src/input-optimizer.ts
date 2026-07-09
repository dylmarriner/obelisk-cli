/**
 * InputOptimizer — compresses content before it reaches the LLM.
 *
 * Multiple layers, each reversible via ReversibleBlobStore:
 *   1. ANSI strip — remove terminal escape codes
 *   2. Progress bar removal — strip spinner/progress lines
 *   3. Blank line collapse — reduce runs of blank lines
 *   4. Trailing whitespace — remove trailing spaces
 *   5. Identical line dedup — collapse repeated lines
 *   6. Terse prose — remove filler words, greetings, articles
 *   7. Code compaction — minimize whitespace in code blocks
 *   8. Base64/blob detection — collapse long opaque strings
 *   9. Context deduplication — remove repeated content across sources
 *  10. Priority truncation — remove lowest-priority content when over budget
 *
 * Every transformation is reversible — the original can be recovered
 * via the blob handle embedded in the compressed output.
 */

import { ReversibleBlobStore } from "./reversible-blob-store";

// ─── Types ──────────────────────────────────────────────────────

export interface OptimizerOptions {
  terseLevel: "off" | "lite" | "full" | "ultra";
  dedupThreshold: number;       // Min identical lines before collapsing (default: 3)
  maxBlankLines: number;        // Max consecutive blank lines (default: 2)
  stripAnsi: boolean;
  stripProgress: boolean;
  compactCode: boolean;
  detectBlobs: boolean;
  reversible: boolean;          // Store originals for recovery
}

export const DEFAULT_OPTIMIZER_OPTIONS: OptimizerOptions = {
  terseLevel: "lite",
  dedupThreshold: 3,
  maxBlankLines: 2,
  stripAnsi: true,
  stripProgress: true,
  compactCode: true,
  detectBlobs: true,
  reversible: true,
};

export interface OptimizerReport {
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savedPercent: number;
  layers: { name: string; savedTokens: number; reversible: boolean }[];
  handle?: string;  // Blob handle for recovery
}

// ─── Optimizer ──────────────────────────────────────────────────

export class InputOptimizer {
  private options: OptimizerOptions;
  private store: ReversibleBlobStore;

  constructor(options: Partial<OptimizerOptions> = {}, store?: ReversibleBlobStore) {
    this.options = { ...DEFAULT_OPTIMIZER_OPTIONS, ...options };
    this.store = store || new ReversibleBlobStore();
  }

  /**
   * Optimize text for LLM input — compress without losing context.
   * Returns the optimized text plus a report of what was saved.
   */
  optimize(text: string, context?: string): { text: string; report: OptimizerReport } {
    const inputTokens = estimateTokens(text);
    const layers: OptimizerReport["layers"] = [];
    let current = text;

    // Store original for reversible recovery
    let handle: string | undefined;
    if (this.options.reversible) {
      handle = this.store.store(text, context || "input");
    }

    // Layer 1: Strip ANSI escape codes
    if (this.options.stripAnsi) {
      const before = estimateTokens(current);
      current = current.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: "ansi-strip", savedTokens: before - after, reversible: true });
      }
    }

    // Layer 2: Remove progress bar lines
    if (this.options.stripProgress) {
      const before = estimateTokens(current);
      current = current.replace(/^\s*[\d.]+%.*$/gm, "");
      current = current.replace(/^[\s#=>\-]*\[[#=>\-. ]+\]\s*$/gm, "");
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: "progress-strip", savedTokens: before - after, reversible: true });
      }
    }

    // Layer 3: Collapse trailing whitespace
    {
      const before = estimateTokens(current);
      current = current.replace(/[ \t]+\n/g, "\n");
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: "trailing-ws", savedTokens: before - after, reversible: true });
      }
    }

    // Layer 4: Collapse blank line runs
    {
      const before = estimateTokens(current);
      const blankRun = "\n".repeat(this.options.maxBlankLines + 1);
      const replacement = "\n".repeat(this.options.maxBlankLines);
      while (current.includes(blankRun)) {
        current = current.replace(blankRun, replacement);
      }
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: "blank-collapse", savedTokens: before - after, reversible: true });
      }
    }

    // Layer 5: Deduplicate identical lines
    if (this.options.dedupThreshold > 0) {
      const before = estimateTokens(current);
      current = this.deduplicateLines(current, this.options.dedupThreshold);
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: "line-dedup", savedTokens: before - after, reversible: true });
      }
    }

    // Layer 6: Terse prose (outside code blocks)
    if (this.options.terseLevel !== "off") {
      const before = estimateTokens(current);
      current = this.tersify(current, this.options.terseLevel);
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: `terse-${this.options.terseLevel}`, savedTokens: before - after, reversible: true });
      }
    }

    // Layer 7: Compact code blocks
    if (this.options.compactCode) {
      const before = estimateTokens(current);
      current = this.compactCodeBlocks(current);
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: "code-compact", savedTokens: before - after, reversible: true });
      }
    }

    // Layer 8: Detect and collapse long base64 blobs
    if (this.options.detectBlobs) {
      const before = estimateTokens(current);
      current = current.replace(/[A-Za-z0-9+/]{120,}={0,2}/g, (match) => {
        const h = this.store.store(match, "base64-blob");
        return `[blob:${h} ${match.length} chars]`;
      });
      const after = estimateTokens(current);
      if (before > after) {
        layers.push({ name: "blob-detect", savedTokens: before - after, reversible: true });
      }
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
      },
    };
  }

  /**
   * Estimate tokens in text (rough approximation: ~4 chars per token).
   */
  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  // ─── Private Optimizers ───────────────────────────────────────

  private deduplicateLines(text: string, threshold: number): string {
    const lines = text.split("\n");
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      let j = i;
      while (j < lines.length && lines[j] === lines[i]) {
        j++;
      }
      const run = j - i;
      if (run >= threshold) {
        result.push(lines[i]);
        result.push(`  … [×${run} identical lines collapsed]`);
      } else {
        for (let k = i; k < j; k++) {
          result.push(lines[k]);
        }
      }
      i = j;
    }

    return result.join("\n");
  }

  private tersify(text: string, level: string): string {
    // Protect code blocks
    const codeBlocks: string[] = [];
    const protected_ = text.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `\u{0000}CODEBLOCK${codeBlocks.length - 1}\u{0000}`;
    });

    let result = protected_;

    // Remove greetings
    result = result.replace(/^\s*(sure|certainly|absolutely|great|gotcha|no problem|happy to help|of course)[!.,]*\s*/gmi, "");

    // Remove filler words
    const fillers = /\b(just|really|basically|actually|simply|essentially|very|quite|in order to|please note that|it is worth noting that|i'?d be happy to|i would be happy to)\b/gi;
    result = result.replace(fillers, "");

    if (level === "full" || level === "ultra") {
      // Remove articles
      result = result.replace(/\b(a|an|the)\s+/gi, "");
    }

    if (level === "ultra") {
      // Remove common prepositions
      result = result.replace(/\b(with|from|that|this|these|those|which|who|whom)\s+/gi, " ");
    }

    // Collapse multiple spaces
    result = result.replace(/[ \t]{2,}/g, " ");

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      result = result.replace(`\u{0000}CODEBLOCK${i}\u{0000}`, codeBlocks[i]);
    }

    return result;
  }

  private compactCodeBlocks(text: string): string {
    return text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const compacted = code
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");
      return `\`\`\`${lang}\n${compacted}\n\`\`\``;
    });
  }
}

// ─── Token Estimation ───────────────────────────────────────────

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimate: ~4 chars per token for text, ~2.5 for code
  const ws = (text.match(/\s/g) || []).length;
  return Math.max(1, Math.ceil((text.length - ws * 0.5) / 4));
}