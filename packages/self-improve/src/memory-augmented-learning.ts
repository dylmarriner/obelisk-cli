/**
 * MemoryAugmentedLearning — uses past learnings to improve future cycles.
 *
 * This is the core meta-learning system. It analyzes what previous improvement
 * cycles produced, what worked, what didn't, and adjusts future scans
 * accordingly. This mirrors how the AI assistant uses memory to get better
 * over time.
 *
 * Key capabilities:
 *   - Analyzes improvement cycle outcomes to refine scanner priorities
 *   - Tracks which fix types were accepted/rejected in PRs
 *   - Adjusts confidence thresholds based on past accuracy
 *   - Identifies new patterns from recent learnings
 *   - Prunes low-value patterns to keep the system focused
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Learning, LearningTracker } from "./learning-tracker";
import type { ImprovementFinding } from "./self-improvement-engine";

const META_DIR = ".obelisk/meta-learning";

// ─── Types ──────────────────────────────────────────────────────

export interface CycleOutcome {
  cycleId: string;
  timestamp: string;
  findingsCount: number;
  autoFixedCount: number;
  prCreated: boolean;
  prAccepted?: boolean;
  validationPassed: boolean;
  durationMs: number;
  categories: string[];
}

export interface ScannerWeight {
  scanner: string;
  weight: number;       // 0.0 - 1.0, how much to prioritize this scanner
  accuracy: number;     // 0.0 - 1.0, how often its findings are useful
  lastRun: string;
  avgFindings: number;
}

export interface MetaLearningState {
  cycleCount: number;
  lastCycleOutcome?: CycleOutcome;
  scannerWeights: ScannerWeight[];
  accuracyHistory: { cycle: number; accuracy: number }[];
  learnedPatterns: string[];
  prunedPatterns: string[];
}

// ─── Meta Learner ───────────────────────────────────────────────

export class MemoryAugmentedLearning {
  private metaDir: string;
  private tracker: LearningTracker;

  constructor(tracker: LearningTracker, baseDir?: string) {
    this.metaDir = path.join(baseDir || process.cwd(), META_DIR);
    this.tracker = tracker;
    fs.mkdirSync(this.metaDir, { recursive: true });
  }

  /**
   * Record a cycle outcome and update meta-learning state.
   */
  async recordCycleOutcome(outcome: Omit<CycleOutcome, "cycleId">): Promise<void> {
    const cycle: CycleOutcome = {
      ...outcome,
      cycleId: `cycle-${Date.now()}`,
    };

    // Persist outcome
    const outcomesPath = path.join(this.metaDir, "cycle-outcomes.jsonl");
    fs.appendFileSync(outcomesPath, JSON.stringify(cycle) + "\n", "utf-8");

    // Update scanner weights based on results
    await this.updateScannerWeights(cycle);

    // Record as learning
    await this.tracker.record({
      type: "cycle-complete",
      content: `Improvement cycle completed: ${cycle.findingsCount} findings, ${cycle.autoFixedCount} auto-fixed`,
      context: JSON.stringify({ categories: cycle.categories, validationPassed: cycle.validationPassed }),
      tags: ["meta-learning", "cycle", ...cycle.categories],
      source: "meta-learner",
    });
  }

  /**
   * Get the current meta-learning state.
   */
  async getState(): Promise<MetaLearningState> {
    const outcomes = this.loadCycleOutcomes();
    const lastOutcome = outcomes[outcomes.length - 1];
    const scannerWeights = this.loadScannerWeights();

    // Calculate accuracy history
    const accuracyHistory = outcomes
      .filter((o) => o.prAccepted !== undefined)
      .map((o, i) => ({
        cycle: i + 1,
        accuracy: o.prAccepted ? o.autoFixedCount / Math.max(o.findingsCount, 1) : 0,
      }));

    // Calculate overall accuracy
    const totalFindings = outcomes.reduce((s, o) => s + o.findingsCount, 0);
    const totalAccepted = outcomes
      .filter((o) => o.prAccepted)
      .reduce((s, o) => s + o.autoFixedCount, 0);
    const overallAccuracy = totalFindings > 0 ? totalAccepted / totalFindings : 0;

    // If accuracy is low, adjust scanner weights
    if (overallAccuracy < 0.3 && outcomes.length > 2) {
      await this.penalizeLowAccuracyScanners();
    }

    return {
      cycleCount: outcomes.length,
      lastCycleOutcome: lastOutcome,
      scannerWeights: this.loadScannerWeights(),
      accuracyHistory,
      learnedPatterns: this.loadList("learned-patterns.txt"),
      prunedPatterns: this.loadList("pruned-patterns.txt"),
    };
  }

  /**
   * Learn a new pattern from observed behavior.
   */
  async learnPattern(pattern: string, context: string): Promise<void> {
    const patterns = this.loadList("learned-patterns.txt");
    if (!patterns.includes(pattern)) {
      patterns.push(pattern);
      this.saveList("learned-patterns.txt", patterns);
    }

    await this.tracker.record({
      type: "pattern-learned",
      content: pattern,
      context,
      tags: ["meta-learning", "pattern"],
      source: "meta-learner",
    });
  }

  /**
   * Prune a pattern that proved low-value.
   */
  async prunePattern(pattern: string, reason: string): Promise<void> {
    const patterns = this.loadList("learned-patterns.txt");
    const pruned = this.loadList("pruned-patterns.txt");

    const updated = patterns.filter((p) => p !== pattern);
    if (updated.length !== patterns.length) {
      this.saveList("learned-patterns.txt", updated);
      pruned.push(`${pattern} — ${reason}`);
      this.saveList("pruned-patterns.txt", pruned);
    }

    await this.tracker.record({
      type: "pattern-pruned",
      content: pattern,
      context: reason,
      tags: ["meta-learning", "pruned"],
      source: "meta-learner",
    });
  }

  /**
   * Get scanner priority recommendations based on past accuracy.
   */
  getScannerPriorities(): { scanner: string; priority: "high" | "medium" | "low" }[] {
    const weights = this.loadScannerWeights();

    // Sort by weight descending
    const sorted = [...weights].sort((a, b) => b.weight - a.weight);

    if (sorted.length === 0) {
      // Default priorities
      return [
        { scanner: "typecheck", priority: "high" },
        { scanner: "lint", priority: "high" },
        { scanner: "docs", priority: "medium" },
        { scanner: "deprecations", priority: "medium" },
        { scanner: "patterns", priority: "low" },
      ];
    }

    return sorted.map((s) => ({
      scanner: s.scanner,
      priority: s.weight > 0.7 ? "high" : s.weight > 0.4 ? "medium" : "low",
    }));
  }

  // ─── Private: Weight Management ───────────────────────────────

  private async updateScannerWeights(outcome: CycleOutcome): Promise<void> {
    const weights = this.loadScannerWeights();

    for (const cat of outcome.categories) {
      let w = weights.find((w) => w.scanner === cat);
      if (!w) {
        w = { scanner: cat, weight: 0.5, accuracy: 0.5, lastRun: outcome.timestamp, avgFindings: 0 };
        weights.push(w);
      }

      // Update weight based on cycle outcome
      if (outcome.validationPassed) {
        w.weight = Math.min(w.weight + 0.05, 1.0);
      } else {
        w.weight = Math.max(w.weight - 0.05, 0.1);
      }

      w.lastRun = outcome.timestamp;
    }

    this.saveScannerWeights(weights);
  }

  private async penalizeLowAccuracyScanners(): Promise<void> {
    const weights = this.loadScannerWeights();
    for (const w of weights) {
      // Reduce weight for scanners with low accuracy
      if (w.accuracy < 0.3) {
        w.weight = Math.max(w.weight * 0.5, 0.1);
      }
    }
    this.saveScannerWeights(weights);
  }

  // ─── Private: Persistence ─────────────────────────────────────

  private loadCycleOutcomes(): CycleOutcome[] {
    const path = `${this.metaDir}/cycle-outcomes.jsonl`;
    if (!fs.existsSync(path)) return [];
    return fs
      .readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  private loadScannerWeights(): ScannerWeight[] {
    const path = `${this.metaDir}/scanner-weights.json`;
    if (!fs.existsSync(path)) {
      // Default weights
      const defaults: ScannerWeight[] = [
        { scanner: "typecheck", weight: 0.9, accuracy: 0.8, lastRun: "", avgFindings: 5 },
        { scanner: "lint", weight: 0.8, accuracy: 0.7, lastRun: "", avgFindings: 10 },
        { scanner: "docs", weight: 0.5, accuracy: 0.6, lastRun: "", avgFindings: 3 },
        { scanner: "deprecations", weight: 0.4, accuracy: 0.5, lastRun: "", avgFindings: 2 },
        { scanner: "patterns", weight: 0.3, accuracy: 0.4, lastRun: "", avgFindings: 8 },
      ];
      return defaults;
    }
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  }

  private saveScannerWeights(weights: ScannerWeight[]): void {
    fs.writeFileSync(`${this.metaDir}/scanner-weights.json`, JSON.stringify(weights, null, 2), "utf-8");
  }

  private loadList(name: string): string[] {
    const p = path.join(this.metaDir, name);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf-8").split("\n").filter(Boolean);
  }

  private saveList(name: string, items: string[]): void {
    fs.writeFileSync(path.join(this.metaDir, name), items.join("\n"), "utf-8");
  }
}