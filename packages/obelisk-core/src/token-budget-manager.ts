/**
 * TokenBudgetManager — estimates and enforces token budgets for model calls.
 *
 * Port of the eval/obelisk pack.rs token-budgeting logic to TypeScript.
 * Provides budget estimation, compaction decisions, and reporting.
 */

// ─── Rough token estimation ──────────────────────────────────────
// ~4 characters per token for English text, ~2 for code
// This is intentionally conservative — actual token counts depend on
// the specific model's tokenizer.

export function estimateTokens(text: string, isCode = false): number {
  const charsPerToken = isCode ? 2.5 : 4;
  return Math.ceil(text.length / charsPerToken);
}

export function estimateTokensFromParts(parts: { text: string; isCode?: boolean }[]): number {
  return parts.reduce((sum, p) => sum + estimateTokens(p.text, p.isCode), 0);
}

// ─── Budget Config ───────────────────────────────────────────────

export interface TokenBudgetConfig {
  maxInputTokens: number;
  reserveOutputTokens: number;
  maxToolResultTokens: number;
  compactionThreshold: number; // percentage of maxInputTokens that triggers compaction
  contextPolicy: "compact-first" | "warn-only" | "strict-truncate";
}

export const DEFAULT_BUDGET_CONFIG: TokenBudgetConfig = {
  maxInputTokens: 120_000,
  reserveOutputTokens: 12_000,
  maxToolResultTokens: 24_000,
  compactionThreshold: 0.85,
  contextPolicy: "compact-first",
};

// ─── Budget Report ───────────────────────────────────────────────

export interface TokenBudgetReport {
  totalTokens: number;
  inputTokens: number;
  reservedOutputTokens: number;
  maxTokens: number;
  availableTokens: number;
  usedPercentage: number;
  exceedsBudget: boolean;
  needsCompaction: boolean;
  sources: TokenSource[];
}

export interface TokenSource {
  name: string;
  tokens: number;
  percentage: number;
  isCode: boolean;
}

export interface CompactionSuggestion {
  recommended: boolean;
  reason: string;
  estimatedTokensToFree: number;
  suggestedActions: string[];
}

// ─── Manager ─────────────────────────────────────────────────────

export class TokenBudgetManager {
  private config: TokenBudgetConfig;

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
  }

  /**
   * Inspect a set of context sources and produce a budget report.
   */
  inspect(sources: TokenSource[]): TokenBudgetReport {
    const totalTokens = sources.reduce((s, src) => s + src.tokens, 0);
    const availableTokens = this.config.maxInputTokens - this.config.reserveOutputTokens;
    const usedPercentage = (totalTokens / this.config.maxInputTokens) * 100;

    const exceedsBudget = totalTokens > this.config.maxInputTokens;
    const needsCompaction = totalTokens > availableTokens * this.config.compactionThreshold;

    return {
      totalTokens,
      inputTokens: totalTokens,
      reservedOutputTokens: this.config.reserveOutputTokens,
      maxTokens: this.config.maxInputTokens,
      availableTokens,
      usedPercentage: Math.round(usedPercentage * 100) / 100,
      exceedsBudget,
      needsCompaction,
      sources,
    };
  }

  /**
   * Get a compaction suggestion based on the current budget state.
   */
  getCompactionSuggestion(report: TokenBudgetReport): CompactionSuggestion {
    if (!report.needsCompaction) {
      return {
        recommended: false,
        reason: "Within budget",
        estimatedTokensToFree: 0,
        suggestedActions: [],
      };
    }

    const overBy = report.totalTokens - report.availableTokens;
    const actions: string[] = [];

    // Sort sources by size, largest first
    const sorted = [...report.sources].sort((a, b) => b.tokens - a.tokens);

    // Suggest actions based on policy
    switch (this.config.contextPolicy) {
      case "compact-first":
        actions.push("Summarize large sources with compact representations");
        actions.push("Remove redundant tool outputs");
        actions.push("Use symbol-level outlines instead of full file contents");
        break;
      case "strict-truncate":
        actions.push("Truncate largest sources until within budget");
        break;
      case "warn-only":
        actions.push("Warn user about high token usage");
        break;
    }

    // Source-specific suggestions
    for (const src of sorted.slice(0, 3)) {
      if (src.tokens > 10_000) {
        actions.push(`Consider compacting "${src.name}" (${src.tokens} tokens, ${src.percentage.toFixed(1)}%)`);
      }
    }

    return {
      recommended: true,
      reason: `Context uses ${report.usedPercentage.toFixed(1)}% of budget (${report.totalTokens}/${report.availableTokens} available)`,
      estimatedTokensToFree: overBy + Math.round(this.config.maxInputTokens * 0.1), // free 10% extra
      suggestedActions: actions,
    };
  }

  /**
   * Estimate tokens for a piece of text.
   */
  estimate(text: string, isCode = false): number {
    return estimateTokens(text, isCode);
  }

  /**
   * Get the current config.
   */
  getConfig(): TokenBudgetConfig {
    return { ...this.config };
  }

  /**
   * Update config at runtime.
   */
  updateConfig(partial: Partial<TokenBudgetConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}