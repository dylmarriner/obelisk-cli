/**
 * PromptAssembler — builds compact, token-budgeted context bundles.
 *
 * Port of the eval/obelisk pack.rs context assembly logic to TypeScript.
 * Assembles context sources into a prioritized, budget-constrained prompt.
 */

import { TokenBudgetManager, type TokenSource, type TokenBudgetReport } from "./token-budget-manager";

// ─── Context Source ──────────────────────────────────────────────

export interface ContextSource {
  name: string;
  content: string;
  priority: number; // Higher = included first when budget is tight
  isCode: boolean;
  reversible: boolean; // Can be omitted and re-fetched later
}

export interface PromptAssemblyInput {
  sources: ContextSource[];
  budget: number;
  reserveOutput: number;
}

export interface PromptAssemblyResult {
  prompt: string;
  sources: { name: string; included: boolean; tokens: number }[];
  report: TokenBudgetReport;
  omitted: string[];
}

// ─── Assembler ───────────────────────────────────────────────────

export class PromptAssembler {
  private budgetManager: TokenBudgetManager;

  constructor(budgetManager?: TokenBudgetManager) {
    this.budgetManager = budgetManager || new TokenBudgetManager();
  }

  /**
   * Assemble a prompt from context sources, respecting the token budget.
   */
  assemble(input: PromptAssemblyInput): PromptAssemblyResult {
    const { sources, budget, reserveOutput } = input;
    const maxTokens = budget - reserveOutput;
    const omitted: string[] = [];

    // Sort by priority (highest first), then by name
    const sorted = [...sources].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.name.localeCompare(b.name);
    });

    // Build token sources for budget tracking
    const tokenSources: TokenSource[] = sorted.map((s) => ({
      name: s.name,
      tokens: this.budgetManager.estimate(s.content, s.isCode),
      percentage: 0,
      isCode: s.isCode,
    }));

    // Greedy inclusion by priority
    const included: { name: string; included: boolean; tokens: number }[] = [];
    let usedTokens = 0;
    const parts: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const source = sorted[i];
      const estimated = tokenSources[i].tokens;

      if (usedTokens + estimated <= maxTokens || parts.length === 0) {
        // Include
        parts.push(source.content);
        usedTokens += estimated;
        included.push({ name: source.name, included: true, tokens: estimated });
      } else if (source.reversible) {
        // Omit reversible sources
        omitted.push(source.name);
        included.push({ name: source.name, included: false, tokens: estimated });
      } else {
        // Include non-reversible even if over budget (trimmed)
        const available = maxTokens - usedTokens;
        if (available > 100) {
          const trimmed = source.content.substring(0, Math.max(available * 4, 500));
          parts.push(`[TRUNCATED] ${trimmed}`);
          usedTokens += maxTokens - usedTokens;
          included.push({ name: source.name, included: true, tokens: estimated, note: "truncated" });
        } else {
          omitted.push(`${source.name} (non-reversible, but no room)`);
          included.push({ name: source.name, included: false, tokens: estimated });
        }
      }
    }

    const report = this.budgetManager.inspect(tokenSources);

    return {
      prompt: parts.join("\n\n"),
      sources: included,
      report,
      omitted,
    };
  }

  /**
   * Compact a set of sources by summarizing or removing low-priority content.
   */
  compact(sources: ContextSource[], targetBudget: number): ContextSource[] {
    const totalTokens = sources.reduce((s, src) => s + this.budgetManager.estimate(src.content, src.isCode), 0);

    if (totalTokens <= targetBudget) {
      return sources;
    }

    // Sort by priority and remove/compact low-priority sources
    const sorted = [...sources].sort((a, b) => b.priority - a.priority);
    const result: ContextSource[] = [];
    let used = 0;

    for (const source of sorted) {
      const estimated = this.budgetManager.estimate(source.content, source.isCode);

      if (used + estimated <= targetBudget) {
        result.push(source);
        used += estimated;
      } else if (source.reversible) {
        // Skip reversible sources when over budget
        continue;
      } else {
        // Trim non-reversible source
        const available = targetBudget - used;
        const charBudget = Math.max(available * 4, 200);
        result.push({
          ...source,
          content: `[COMPACTED] ${source.content.substring(0, charBudget)}`,
        });
        used = targetBudget;
      }
    }

    return result;
  }
}