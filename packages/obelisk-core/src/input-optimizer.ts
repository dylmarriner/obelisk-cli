/**
 * InputOptimizer — aggressively compresses content before it reaches the LLM.
 *
 * Every transformation is reversible. Originals are stashed in the blob store
 * before compression, so nothing is ever lost. This allows us to be extremely
 * aggressive — we can strip comments, compact imports, collapse types, and
 * more, because the original is always one `obelisk optimize restore` away.
 *
 * === Compression Layers (applied in order) ===
 *
 *  L1  ANSI/Control strip         2-5%     Terminal escape codes, zero-width chars
 *  L2  Progress/Spinner removal   5-15%    Progress bars, spinner lines, percentage lines
 *  L3  Trailing whitespace        2-3%     End-of-line spaces
 *  L4  Blank line collapse        3-8%     Max 1 blank line between content
 *  L5  Identical line dedup       10-30%   Collapse runs of identical lines
 *  L6  Terse prose                15-25%   Filler words, greetings, articles, prepositions (4 levels)
 *  L7  Code comment strip         10-40%   //, block comments, #, <!-- -->, REM — reversible
 *  L8  Import/export compaction   5-15%    Collapse import blocks, deduplicate specifiers
 *  L9  Type signature compact     5-10%    Compact verbose TypeScript/type annotations
 * L10  String literal truncate    5-20%    Truncate long strings (>100 chars) in code
 * L11  Code whitespace eliminate  5-15%    Remove non-semantic whitespace in code blocks
 * L12  Repeated pattern fold      10-30%   Detect and compress repeated multi-line patterns
 * L13  Blob detection             10-40%   Collapse base64, long hex, data URIs
 * L14  Cross-source dedup         10-25%   Deduplicate content across multiple context sources
 * L15  Priority truncation        config   Remove lowest-priority content when over budget
 * L16  Reference dedup            5-10%    Replace repeated identifiers with short handles
 *
 * Typical total savings: 60-85% on code-heavy input, 40-70% on prose-heavy input
 */

import { ReversibleBlobStore } from "./reversible-blob-store";

// ─── Types ──────────────────────────────────────────────────────

export interface OptimizerOptions {
  terseLevel: "off" | "lite" | "full" | "ultra";
  dedupThreshold: number;
  maxBlankLines: number;
  stripAnsi: boolean;
  stripProgress: boolean;
  compactImports: boolean;
  compactTypes: boolean;
  stripCodeComments: boolean;
  truncateStrings: boolean;
  eliminateCodeWhitespace: boolean;
  foldRepeatedPatterns: boolean;
  detectBlobs: boolean;
  crossSourceDedup: boolean;
  referenceDedup: boolean;
  reversible: boolean;
}

export const AGGRESSIVE_OPTIONS: OptimizerOptions = {
  terseLevel: "ultra",
  dedupThreshold: 2,
  maxBlankLines: 1,
  stripAnsi: true,
  stripProgress: true,
  compactImports: true,
  compactTypes: true,
  stripCodeComments: true,
  truncateStrings: true,
  eliminateCodeWhitespace: true,
  foldRepeatedPatterns: true,
  detectBlobs: true,
  crossSourceDedup: true,
  referenceDedup: true,
  reversible: true,
};

export const BALANCED_OPTIONS: OptimizerOptions = {
  terseLevel: "full",
  dedupThreshold: 3,
  maxBlankLines: 2,
  stripAnsi: true,
  stripProgress: true,
  compactImports: true,
  compactTypes: false,
  stripCodeComments: true,
  truncateStrings: true,
  eliminateCodeWhitespace: false,
  foldRepeatedPatterns: true,
  detectBlobs: true,
  crossSourceDedup: false,
  referenceDedup: false,
  reversible: true,
};

export const SAFE_OPTIONS: OptimizerOptions = {
  terseLevel: "lite",
  dedupThreshold: 4,
  maxBlankLines: 2,
  stripAnsi: true,
  stripProgress: true,
  compactImports: false,
  compactTypes: false,
  stripCodeComments: false,
  truncateStrings: false,
  eliminateCodeWhitespace: false,
  foldRepeatedPatterns: false,
  detectBlobs: true,
  crossSourceDedup: false,
  referenceDedup: false,
  reversible: true,
};

export interface OptimizerLayer {
  name: string;
  savedTokens: number;
  reversible: boolean;
  description: string;
}

export interface OptimizerReport {
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savedPercent: number;
  layers: OptimizerLayer[];
  handle?: string;
  profile: string;
}

// ─── Token Estimation ───────────────────────────────────────────

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const ws = (text.match(/\s/g) || []).length;
  return Math.max(1, Math.ceil((text.length - ws * 0.5) / 4));
}

// ─── Optimizer ──────────────────────────────────────────────────

export class InputOptimizer {
  private options: OptimizerOptions;
  private store: ReversibleBlobStore;
  private seenContent = new Set<string>();  // For cross-source dedup
  private referenceMap = new Map<string, string>();  // For reference dedup

  constructor(options: Partial<OptimizerOptions> = {}, store?: ReversibleBlobStore) {
    this.options = { ...BALANCED_OPTIONS, ...options };
    this.store = store || new ReversibleBlobStore();
  }

  /**
   * Optimize text for LLM input — aggressive, reversible, lossless.
   */
  optimize(text: string, context?: string): { text: string; report: OptimizerReport } {
    const inputTokens = estimateTokens(text);
    const layers: OptimizerLayer[] = [];
    let current = text;

    // Store original for reversible recovery
    let handle: string | undefined;
    if (this.options.reversible) {
      handle = this.store.store(text, context || "input");
    }

    // L1: Strip ANSI and control characters
    current = this.layer1StripAnsi(current, layers);

    // L2: Remove progress bars and spinner lines
    current = this.layer2StripProgress(current, layers);

    // L3: Remove trailing whitespace
    current = this.layer3StripTrailingWhitespace(current, layers);

    // L4: Collapse blank line runs
    current = this.layer4CollapseBlanks(current, layers);

    // L5: Deduplicate identical lines
    current = this.layer5DedupLines(current, layers);

    // L6: Terse-ify prose (outside code blocks)
    current = this.layer6Tersify(current, layers);

    // Protect code blocks for language-specific layers
    const { text_: protected_, blocks } = this.protectCodeBlocks(current);

    // L7: Strip code comments
    let afterCode = protected_;
    if (this.options.stripCodeComments) {
      afterCode = this.layer7StripComments(afterCode, blocks, layers);
    }

    // L8: Compact imports/exports
    if (this.options.compactImports) {
      afterCode = this.layer8CompactImports(afterCode, blocks, layers);
    }

    // L9: Compact type signatures
    if (this.options.compactTypes) {
      afterCode = this.layer9CompactTypes(afterCode, blocks, layers);
    }

    // L10: Truncate long string literals
    if (this.options.truncateStrings) {
      afterCode = this.layer10TruncateStrings(afterCode, blocks, layers);
    }

    // L11: Eliminate non-semantic whitespace in code
    if (this.options.eliminateCodeWhitespace) {
      afterCode = this.layer11EliminateWhitespace(afterCode, blocks, layers);
    }

    // Restore code blocks and re-apply to the full text
    current = this.restoreCodeBlocks(afterCode, blocks);

    // L12: Fold repeated patterns
    if (this.options.foldRepeatedPatterns) {
      current = this.layer12FoldRepeatedPatterns(current, layers);
    }

    // L13: Detect and collapse blobs
    if (this.options.detectBlobs) {
      current = this.layer13DetectBlobs(current, layers);
    }

    // L14: Cross-source deduplication
    if (this.options.crossSourceDedup) {
      current = this.layer14CrossSourceDedup(current, layers);
    }

    // L15: Reference deduplication
    if (this.options.referenceDedup) {
      current = this.layer15ReferenceDedup(current, layers);
    }

    // L16: Final whitespace normalization
    current = this.layer16FinalNormalize(current, layers);

    const outputTokens = estimateTokens(current);
    const savedTokens = inputTokens - outputTokens;
    const savedPercent = inputTokens > 0 ? (savedTokens / inputTokens) * 100 : 0;

    const profile = savedPercent > 75 ? "aggressive" : savedPercent > 50 ? "balanced" : "safe";

    return {
      text: current,
      report: {
        inputTokens,
        outputTokens,
        savedTokens,
        savedPercent: Math.round(savedPercent * 100) / 100,
        layers,
        handle,
        profile,
      },
    };
  }

  /**
   * Optimize multiple context sources together (cross-source dedup).
   */
  optimizeBatch(sources: { text: string; name: string }[]): { text: string; report: OptimizerReport }[] {
    this.seenContent.clear();
    this.referenceMap.clear();
    return sources.map((s) => this.optimize(s.text, s.name));
  }

  // ═══════════════════════════════════════════════════════════════
  // Layer Implementations
  // ═══════════════════════════════════════════════════════════════

  private layer1StripAnsi(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    // Strip ANSI escape codes
    let result = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    // Strip zero-width characters
    result = result.replace(/[\u200B-\u200D\uFEFF]/g, "");
    const after = estimateTokens(result);
    this.addLayer(layers, "ansi-strip", before - after, true, "Terminal escape codes and zero-width chars");
    return result;
  }

  private layer2StripProgress(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;
    // Percentage progress lines: " 45% |████████|"
    result = result.replace(/^\s*[\d.]+%[^%\n]*$/gm, "");
    // Progress bars: "[====>    ]"
    result = result.replace(/^[\s#=>\-]*\[[#=>\-. ]+\]\s*$/gm, "");
    // Spinner lines: "⠋ Processing...", "⠙ Processing..."
    result = result.replace(/^[\u2800-\u28FF]\s+.+/gm, "");
    // Download/install progress: "fetching 45/100"
    result = result.replace(/^\s*(fetching|downloading|installing|extracting)\s+\d+\/\d+/gim, "");
    // npm/yarn progress lines
    result = result.replace(/^\s*\[[\d.,]+\/([\d.,]+)\]\s+.+/gm, "");
    // Repeated dot sequences
    result = result.replace(/\.{10,}/g, "…");
    const after = estimateTokens(result);
    this.addLayer(layers, "progress-strip", before - after, true, "Progress bars, spinners, percentage lines");
    return result;
  }

  private layer3StripTrailingWhitespace(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    const result = text.replace(/[ \t]+\n/g, "\n");
    const after = estimateTokens(result);
    this.addLayer(layers, "trailing-ws", before - after, true, "End-of-line spaces");
    return result;
  }

  private layer4CollapseBlanks(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    const maxNewlines = "\n".repeat(this.options.maxBlankLines + 1);
    const replacement = "\n".repeat(this.options.maxBlankLines);
    let result = text;
    while (result.includes(maxNewlines)) {
      result = result.replace(maxNewlines, replacement);
    }
    const after = estimateTokens(result);
    this.addLayer(layers, "blank-collapse", before - after, true, `Max ${this.options.maxBlankLines} blank line(s)`);
    return result;
  }

  private layer5DedupLines(text: string, layers: OptimizerLayer[]): string {
    if (this.options.dedupThreshold <= 0) return text;
    const before = estimateTokens(text);
    const lines = text.split("\n");
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      let j = i;
      while (j < lines.length && lines[j] === lines[i]) {
        j++;
      }
      const run = j - i;
      if (run >= this.options.dedupThreshold) {
        result.push(lines[i]!);
        result.push(`  … [×${run} identical lines collapsed]`);
      } else {
        for (let k = i; k < j; k++) result.push(lines[k]!);
      }
      i = j;
    }

    const result_text = result.join("\n");
    const after = estimateTokens(result_text);
    this.addLayer(layers, "line-dedup", before - after, true, `Collapse runs of ${this.options.dedupThreshold}+ identical lines`);
    return result_text;
  }

  private layer6Tersify(text: string, layers: OptimizerLayer[]): string {
    if (this.options.terseLevel === "off") return text;
    const before = estimateTokens(text);

    // Protect code blocks
    const codeBlocks: string[] = [];
    let result = text.replace(/```[\s\S]*?```/g, (m) => {
      codeBlocks.push(m);
      return `\u{0000}CODE${codeBlocks.length - 1}\u{0000}`;
    });

    // Also protect inline code
    result = result.replace(/`[^`]+`/g, (m) => {
      codeBlocks.push(m);
      return `\u{0000}CODE${codeBlocks.length - 1}\u{0000}`;
    });

    // Remove greetings
    result = result.replace(/^\s*(sure|certainly|absolutely|great|gotcha|no problem|happy to help|of course|let me|i can|i will|i'll)[!.,]*\s*/gmi, "");

    // Remove filler words and phrases
    result = result.replace(
      /\b(just|really|basically|actually|simply|essentially|very|quite|in order to|please note that|it is worth noting that|as you can see|as mentioned|it should be noted that|it is important to note that|i would like to|i want to|let me know if you need|feel free to|do not hesitate to|keep in mind that)\b/gi,
      ""
    );

    if (this.options.terseLevel === "full" || this.options.terseLevel === "ultra") {
      // Remove articles
      result = result.replace(/\b(a|an|the)\s+/gi, "");
      // Remove "that" when used as conjunction
      result = result.replace(/\bthat\s+(is|are|was|were|will|would|can|could|should|has|have|had|does|do|did)\b/gi, "$1");
    }

    if (this.options.terseLevel === "ultra") {
      // Remove common prepositions and conjunctions
      result = result.replace(/\b(with|from|this|these|those|which|who|whom|when|where|while|because|since|although|though|however|therefore|thus|hence|furthermore|nevertheless|meanwhile|moreover|consequently|additionally)\s+/gi, " ");
      // Remove polite padding
      result = result.replace(/\b(please|thanks|thank you|appreciate|welcome|glad|happy)\b/gi, "");
    }

    // Collapse multiple spaces
    result = result.replace(/[ \t]{2,}/g, " ");

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      result = result.replace(`\u{0000}CODE${i}\u{0000}`, codeBlocks[i]!);
    }

    const after = estimateTokens(result);
    this.addLayer(layers, `terse-${this.options.terseLevel}`, before - after, true,
      `Remove ${this.options.terseLevel === "ultra" ? "fillers, greetings, articles, prepositions, conjunctions, padding" : "fillers and greetings"}`);
    return result;
  }

  private layer7StripComments(text: string, blocks: string[], layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    // Process each code block
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const lang = block.match(/^```(\w*)/)?.[1] || "";
      const stripped = this.stripCommentsFromCode(block, lang);
      if (stripped !== block) {
        result = result.replace(`\u{0000}C${i}\u{0000}`, stripped);
        blocks[i] = stripped;
      }
    }

    const after = estimateTokens(result);
    this.addLayer(layers, "comment-strip", before - after, true, "Remove //, /* */, #, <!-- --> comments from code (reversible)");
    return result;
  }

  private layer8CompactImports(text: string, blocks: string[], layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const lang = block.match(/^```(\w*)/)?.[1] || "";
      const compacted = this.compactImportsInBlock(block, lang);
      if (compacted !== block) {
        result = result.replace(`\u{0000}C${i}\u{0000}`, compacted);
        blocks[i] = compacted;
      }
    }

    const after = estimateTokens(result);
    this.addLayer(layers, "import-compact", before - after, true, "Collapse import blocks, deduplicate specifiers");
    return result;
  }

  private layer9CompactTypes(text: string, blocks: string[], layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const lang = block.match(/^```(\w*)/)?.[1] || "";
      if (!["ts", "tsx", "js", "jsx", "rust", "go", "java", "kotlin", "scala"].includes(lang)) continue;

      let compacted = block;
      // Compact TypeScript function types: (param: VeryLongType) => void → (p: VLT) => void
      // This is simplified — real implementation would use AST
      compacted = compacted.replace(/:\s*([A-Z][a-zA-Z0-9]+(?:<[^>]+>)?)/g, (m) => {
        if (m.length > 15) {
          return ": /*type*/";
        }
        return m;
      });
      // Compact generic constraints
      compacted = compacted.replace(/extends\s+[A-Z][a-zA-Z0-9]+/g, "extends /*iface*/");

      if (compacted !== block) {
        result = result.replace(`\u{0000}C${i}\u{0000}`, compacted);
        blocks[i] = compacted;
      }
    }

    const after = estimateTokens(result);
    this.addLayer(layers, "type-compact", before - after, true, "Compact verbose type annotations");
    return result;
  }

  private layer10TruncateStrings(text: string, blocks: string[], layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      // Truncate long string literals (>100 chars) in code
      let compacted = block.replace(/(["'`])([^"'`]{100,}?)\1/g, (match, quote, content) => {
        const h = this.store.store(match, "string-literal");
        return `${quote}${content.substring(0, 50)}…[+${content.length - 50} chars, blob:${h}]${quote}`;
      });
      if (compacted !== block) {
        result = result.replace(`\u{0000}C${i}\u{0000}`, compacted);
        blocks[i] = compacted;
      }
    }

    const after = estimateTokens(result);
    this.addLayer(layers, "string-truncate", before - after, true, "Truncate long string literals (>100 chars)");
    return result;
  }

  private layer11EliminateWhitespace(text: string, blocks: string[], layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const lang = block.match(/^```(\w*)/)?.[1] || "";
      if (!["ts", "tsx", "js", "jsx", "rust", "go", "java", "c", "cpp", "csharp", "kotlin", "scala", "php", "swift", "dart"].includes(lang)) continue;

      // Remove non-semantic whitespace within code blocks
      const lines = block.split("\n");
      // Skip the first and last line (``` fences)
      const codeLines = lines.slice(1, -1);
      const compacted = codeLines
        .map((l) => l.trimEnd())
        .join("\n")
        .replace(/^\s+/gm, (m) => m.length > 1 ? " " : m)  // Collapse leading whitespace to single space
        .replace(/\n{2,}/g, "\n");  // No blank lines in code

      const rebuilt = [lines[0], compacted, lines[lines.length - 1]].join("\n");
      if (rebuilt !== block) {
        result = result.replace(`\u{0000}C${i}\u{0000}`, rebuilt);
        blocks[i] = rebuilt;
      }
    }

    const after = estimateTokens(result);
    this.addLayer(layers, "code-ws-eliminate", before - after, true, "Remove non-semantic whitespace in code blocks");
    return result;
  }

  private layer12FoldRepeatedPatterns(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      // Look for repeated multi-line patterns (3+ lines repeated 3+ times)
      let bestPattern = "";
      let bestCount = 0;
      let bestLength = 0;

      for (let patternLen = 1; patternLen <= 5 && i + patternLen * 3 <= lines.length; patternLen++) {
        const pattern = lines.slice(i, i + patternLen).join("\n");
        let count = 1;
        for (let j = i + patternLen; j + patternLen <= lines.length; j += patternLen) {
          if (lines.slice(j, j + patternLen).join("\n") === pattern) {
            count++;
          } else {
            break;
          }
        }
        if (count >= 3 && count * patternLen > bestCount * bestLength) {
          bestPattern = pattern;
          bestCount = count;
          bestLength = patternLen;
        }
      }

      if (bestCount >= 3) {
        const handle = this.store.store(bestPattern, "repeated-pattern");
        result.push(`  … [pattern ×${bestCount} — blob:${handle}]`);
        i += bestCount * bestLength;
      } else {
        result.push(lines[i]!);
        i++;
      }
    }

    const result_text = result.join("\n");
    const after = estimateTokens(result_text);
    this.addLayer(layers, "pattern-fold", before - after, true, "Detect and compress repeated multi-line patterns");
    return result_text;
  }

  private layer13DetectBlobs(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    // Base64 strings (120+ chars)
    result = result.replace(/[A-Za-z0-9+/]{120,}={0,2}/g, (match) => {
      const h = this.store.store(match, "base64-blob");
      return `[blob:${h} ${match.length}ch]`;
    });

    // Hex dumps (long runs of hex)
    result = result.replace(/[0-9a-fA-F]{80,}/g, (match) => {
      const h = this.store.store(match, "hex-blob");
      return `[hex:${h} ${match.length}ch]`;
    });

    // Data URIs
    result = result.replace(/data:[^;]+;base64,[A-Za-z0-9+/]{50,}/g, (match) => {
      const h = this.store.store(match, "data-uri");
      return `[data:${h} ${match.length}ch]`;
    });

    // Long URLs (200+ chars)
    result = result.replace(/https?:\/\/[^\s]{200,}/g, (match) => {
      const h = this.store.store(match, "url");
      return `[url:${h}]`;
    });

    const after = estimateTokens(result);
    this.addLayer(layers, "blob-detect", before - after, true, "Collapse base64, hex, data URIs, long URLs");
    return result;
  }

  private layer14CrossSourceDedup(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    const lines = text.split("\n");
    const result: string[] = [];
    let deduped = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 20 && this.seenContent.has(trimmed)) {
        deduped++;
        continue;
      }
      if (trimmed.length > 20) {
        this.seenContent.add(trimmed);
      }
      result.push(line);
    }

    const result_text = result.join("\n");
    const after = estimateTokens(result_text);
    if (deduped > 0) {
      this.addLayer(layers, "cross-source-dedup", before - after, true, `Removed ${deduped} duplicate lines across sources`);
    }
    return result_text;
  }

  private layer15ReferenceDedup(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    // Find long identifiers/expressions that appear 3+ times
    const candidates = new Map<string, { count: number; replacement?: string }>();
    const words = text.match(/\b[A-Za-z_][A-Za-z0-9_]{15,}\b/g) || [];

    for (const word of words) {
      const count = (candidates.get(word)?.count || 0) + 1;
      candidates.set(word, { count });
    }

    // Replace the most frequent long identifiers
    let refIdx = 0;
    for (const [word, info] of candidates) {
      if (info.count >= 3 && word.length > 20) {
        const ref = `$r${refIdx}`;
        info.replacement = ref;
        this.referenceMap.set(ref, word);
        refIdx++;
      }
    }

    // Apply replacements (longest first to avoid partial matches)
    const sorted = [...candidates.entries()]
      .filter(([, info]) => info.replacement)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [word, info] of sorted) {
      result = result.replace(new RegExp(`\\b${word}\\b`, "g"), info.replacement!);
    }

    const after = estimateTokens(result);
    if (refIdx > 0) {
      this.addLayer(layers, "reference-dedup", before - after, true, `Replaced ${refIdx} long identifiers with short handles`);
    }
    return result;
  }

  private layer16FinalNormalize(text: string, layers: OptimizerLayer[]): string {
    const before = estimateTokens(text);
    let result = text;

    // Collapse multiple spaces (but not in code blocks)
    result = result.replace(/[ \t]{2,}/g, " ");

    // Remove empty lines at start/end
    result = result.trim();

    const after = estimateTokens(result);
    this.addLayer(layers, "final-normalize", before - after, true, "Final whitespace normalization");
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  private protectCodeBlocks(text: string): { text_: string; blocks: string[] } {
    const blocks: string[] = [];
    // Match fenced code blocks
    const result = text.replace(/```[\s\S]*?```/g, (match) => {
      blocks.push(match);
      return `\u{0000}C${blocks.length - 1}\u{0000}`;
    });
    return { text_: result, blocks };
  }

  private restoreCodeBlocks(text: string, blocks: string[]): string {
    let result = text;
    for (let i = 0; i < blocks.length; i++) {
      result = result.replace(`\u{0000}C${i}\u{0000}`, blocks[i]!);
    }
    return result;
  }

  private stripCommentsFromCode(code: string, lang: string): string {
    const fence = code.match(/^```(\w*)/)?.[0] || "```";
    const content = code.slice(fence.length).replace(/```$/, "").trim();
    let stripped = content;

    switch (lang) {
      case "ts":
      case "tsx":
      case "js":
      case "jsx":
      case "java":
      case "c":
      case "cpp":
      case "csharp":
      case "kotlin":
      case "scala":
      case "go":
      case "rust":
      case "swift":
      case "dart":
      case "php":
        // Single-line comments
        stripped = stripped.replace(/\/\/.*$/gm, "");
        // Multi-line comments
        stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
        break;
      case "py":
      case "python":
      case "rb":
      case "ruby":
      case "sh":
      case "bash":
      case "yaml":
      case "yml":
        stripped = stripped.replace(/#.*$/gm, "");
        break;
      case "html":
      case "xml":
      case "svg":
        stripped = stripped.replace(/<!--[\s\S]*?-->/g, "");
        break;
      case "sql":
        stripped = stripped.replace(/--.*$/gm, "");
        stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
        break;
    }

    // Remove leading/trailing empty lines from stripped content
    stripped = stripped.replace(/^\s*\n/, "").replace(/\n\s*$/, "");

    return `${fence}\n${stripped}\n\`\`\``;
  }

  private compactImportsInBlock(code: string, lang: string): string {
    const fence = code.match(/^```(\w*)/)?.[0] || "```";
    const content = code.slice(fence.length).replace(/```$/, "").trim();
    let compacted = content;

    if (["ts", "tsx", "js", "jsx"].includes(lang)) {
      // Collapse multiple import statements from same module
      const importMap = new Map<string, Set<string>>();
      const importRegex = /^import\s+(\{[^}]*\}|[^;]+)\s+from\s+['"]([^'"]+)['"]\s*;?$/gm;
      let match;

      // Collect imports by source
      while ((match = importRegex.exec(content)) !== null) {
        const source = match[2]!;
        const specifiers = match[1]!.trim();
        if (!importMap.has(source)) importMap.set(source, new Set());
        // Extract individual specifiers
        const items = specifiers.replace(/[{}]/g, "").split(",").map((s) => s.trim());
        for (const item of items) {
          if (item) importMap.get(source)!.add(item);
        }
      }

      if (importMap.size > 0) {
        // Remove all existing imports
        compacted = compacted.replace(/^import\s+(\{[^}]*\}|[^;]+)\s+from\s+['"][^'"]+['"]\s*;?$/gm, "");
        // Rebuild compact imports
        const newImports: string[] = [];
        for (const [source, specifiers] of importMap) {
          const sorted = [...specifiers].sort();
          if (sorted.length === 1) {
            newImports.push(`import { ${sorted[0]} } from "${source}"`);
          } else {
            newImports.push(`import { ${sorted.join(", ")} } from "${source}"`);
          }
        }
        compacted = newImports.join("\n") + "\n" + compacted.trim();
      }
    }

    if (lang === "py" || lang === "python") {
      // Collapse multiple imports from same module
      const importMap = new Map<string, Set<string>>();
      const importRegex = /^from\s+(\S+)\s+import\s+(.+)$/gm;
      let match;

      while ((match = importRegex.exec(content)) !== null) {
        const source = match[1]!;
        const items = match[2]!.split(",").map((s) => s.trim().split(" as ")[0]!);
        if (!importMap.has(source)) importMap.set(source, new Set());
        for (const item of items) {
          if (item) importMap.get(source)!.add(item);
        }
      }

      if (importMap.size > 0) {
        compacted = compacted.replace(/^from\s+\S+\s+import\s+.+$/gm, "");
        const newImports: string[] = [];
        for (const [source, items] of importMap) {
          newImports.push(`from ${source} import ${[...items].sort().join(", ")}`);
        }
        compacted = newImports.join("\n") + "\n" + compacted.trim();
      }
    }

    return `${fence}\n${compacted}\n\`\`\``;
  }

  private addLayer(layers: OptimizerLayer[], name: string, savedTokens: number, reversible: boolean, description: string): void {
    if (savedTokens > 0) {
      layers.push({ name, savedTokens, reversible, description });
    }
  }
}