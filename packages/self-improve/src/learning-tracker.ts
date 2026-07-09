/**
 * LearningTracker — persists observations and learnings from CLI usage.
 *
 * Stores structured learning records in .obelisk/learnings/ as JSONL files.
 * Learnings are used by the SelfImprovementEngine to identify patterns and
 * prioritize improvements.
 *
 * Each learning record captures:
 *   - What was observed (type, content)
 *   - Context (file, command, error)
 *   - When it happened (timestamp)
 *   - Tags for categorization
 */

import * as fs from "node:fs";
import * as path from "node:path";

const LEARNINGS_DIR = ".obelisk/learnings";
const MAX_LEARNINGS = 1000;

// ─── Types ──────────────────────────────────────────────────────

export interface Learning {
  id: string;
  type: string;
  content: string;
  context: string;
  tags: string[];
  source: string;
  timestamp: string;
}

export interface LearningStats {
  total: number;
  byType: Record<string, number>;
  byTag: Record<string, number>;
  recent: Learning[];
}

// ─── Tracker ────────────────────────────────────────────────────

export class LearningTracker {
  private learningsDir: string;
  private logFile: string;

  constructor(baseDir?: string) {
    this.learningsDir = path.join(baseDir || process.cwd(), LEARNINGS_DIR);
    this.logFile = path.join(this.learningsDir, "learnings.jsonl");
    fs.mkdirSync(this.learningsDir, { recursive: true });
  }

  /**
   * Record a new learning observation.
   */
  async record(input: Omit<Learning, "id" | "timestamp">): Promise<Learning> {
    const learning: Learning = {
      ...input,
      id: `lrn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };

    // Append to JSONL file
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(learning) + "\n", "utf-8");
      this.prune();
    } catch {
      // Silently fail — learning is non-critical
    }

    return learning;
  }

  /**
   * Get the most recent learnings.
   */
  async recent(count = 20): Promise<Learning[]> {
    return this.query({ limit: count });
  }

  /**
   * Search learnings by type or tags.
   */
  async query(options: { type?: string; tags?: string[]; limit?: number } = {}): Promise<Learning[]> {
    const all = this.loadAll();
    let filtered = all;

    if (options.type) {
      filtered = filtered.filter((l) => l.type === options.type);
    }
    if (options.tags && options.tags.length > 0) {
      filtered = filtered.filter((l) => options.tags!.some((t) => l.tags.includes(t)));
    }

    // Sort by timestamp descending (most recent first)
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Get learning statistics.
   */
  async stats(): Promise<LearningStats> {
    const all = this.loadAll();
    const byType: Record<string, number> = {};
    const byTag: Record<string, number> = {};

    for (const l of all) {
      byType[l.type] = (byType[l.type] || 0) + 1;
      for (const tag of l.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    return {
      total: all.length,
      byType,
      byTag,
      recent: all.slice(0, 10),
    };
  }

  /**
   * Clear all learnings.
   */
  async clear(): Promise<void> {
    try {
      fs.writeFileSync(this.logFile, "", "utf-8");
    } catch {}
  }

  // ─── Private ──────────────────────────────────────────────────

  private loadAll(): Learning[] {
    try {
      if (!fs.existsSync(this.logFile)) return [];
      const data = fs.readFileSync(this.logFile, "utf-8");
      return data
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Learning)
        .filter((l) => l.id && l.type);
    } catch {
      return [];
    }
  }

  private prune(): void {
    try {
      const all = this.loadAll();
      if (all.length > MAX_LEARNINGS) {
        // Keep only the most recent MAX_LEARNINGS
        const pruned = all
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, MAX_LEARNINGS);
        fs.writeFileSync(
          this.logFile,
          pruned.map((l) => JSON.stringify(l)).join("\n") + "\n",
          "utf-8",
        );
      }
    } catch {}
  }
}