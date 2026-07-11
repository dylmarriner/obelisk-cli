/**
 * AutoTriggerEngine — automatically activates skills based on context.
 *
 * Analyzes the current context (command, directory, recent errors, etc.)
 * and matches it against available skills. When a skill matches, it
 * auto-triggers with the appropriate parameters.
 *
 * This is the agent-side equivalent of how the AI assistant automatically
 * selects and invokes skills based on the user's request.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Learning } from "./learning-tracker";

const SKILLS_DIR = ".qwen/skills";

// ─── Types ──────────────────────────────────────────────────────

export interface TriggerMatch {
  skillName: string;
  skillPath: string;
  confidence: number;
  reason: string;
  matchedOn: ("keyword" | "tag" | "pattern" | "recent" | "error")[];
}

export interface TriggerContext {
  command?: string;        // The CLI command being run (e.g. "obelisk search")
  args?: string[];         // Command arguments
  cwd?: string;            // Current working directory
  recentErrors?: string[]; // Recent error messages
  recentLearnings?: Learning[]; // Recent learnings
  activeTags?: string[];   // Tags from current session
}

// ─── Engine ─────────────────────────────────────────────────────

export class AutoTriggerEngine {
  private skillsDir: string;

  constructor(baseDir?: string) {
    this.skillsDir = path.join(baseDir || process.cwd(), SKILLS_DIR);
  }

  /**
   * Evaluate the current context and return matching skills.
   */
  evaluate(context: TriggerContext): TriggerMatch[] {
    const matches: TriggerMatch[] = [];
    const skills = this.loadAllSkills();

    for (const skill of skills) {
      const match = this.matchSkill(skill, context);
      if (match) {
        matches.push(match);
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get the best matching skill for a given context.
   */
  getBestMatch(context: TriggerContext): TriggerMatch | null {
    const matches = this.evaluate(context);
    return matches[0] || null;
  }

  /**
   * Check if a skill should be auto-triggered (high confidence match).
   */
  shouldAutoTrigger(context: TriggerContext): TriggerMatch | null {
    const matches = this.evaluate(context);
    return matches.find((m) => m.confidence >= 0.7) || null;
  }

  /**
   * Register a new trigger pattern from a learning.
   */
  async learnTriggerPattern(learning: Learning): Promise<void> {
    const triggersDir = path.join(this.skillsDir, ".triggers");
    fs.mkdirSync(triggersDir, { recursive: true });

    const triggerFile = path.join(triggersDir, "learned-triggers.jsonl");
    const entry = {
      type: learning.type,
      tags: learning.tags,
      content: learning.content.substring(0, 200),
      timestamp: learning.timestamp,
    };

    fs.appendFileSync(triggerFile, JSON.stringify(entry) + "\n", "utf-8");
  }

  // ─── Private ──────────────────────────────────────────────────

  private matchSkill(skill: SkillEntry, context: TriggerContext): TriggerMatch | null {
    const matchedOn: TriggerMatch["matchedOn"] = [];
    let confidence = 0;

    // Match by keywords in command
    if (context.command && skill.triggers) {
      for (const trigger of skill.triggers) {
        if (context.command.toLowerCase().includes(trigger.toLowerCase())) {
          confidence += 0.3;
          if (!matchedOn.includes("keyword")) matchedOn.push("keyword");
        }
      }
    }

    // Match by tags
    if (context.activeTags && skill.tags) {
      const tagOverlap = context.activeTags.filter((t) => skill.tags!.includes(t));
      if (tagOverlap.length > 0) {
        confidence += 0.2 * tagOverlap.length;
        if (!matchedOn.includes("tag")) matchedOn.push("tag");
      }
    }

    // Match by recent errors
    if (context.recentErrors && skill.name) {
      for (const error of context.recentErrors) {
        if (error.toLowerCase().includes(skill.name.toLowerCase())) {
          confidence += 0.4;
          if (!matchedOn.includes("error")) matchedOn.push("error");
        }
      }
    }

    // Match by recent learnings
    if (context.recentLearnings && skill.tags) {
      const matchingLearnings = context.recentLearnings.filter((l) =>
        l.tags.some((t) => skill.tags!.includes(t))
      );
      if (matchingLearnings.length > 0) {
        confidence += 0.15 * matchingLearnings.length;
        if (!matchedOn.includes("recent")) matchedOn.push("recent");
      }
    }

    if (matchedOn.length === 0) return null;

    return {
      skillName: skill.name,
      skillPath: skill.filePath,
      confidence: Math.min(confidence, 1.0),
      reason: `Matched on ${matchedOn.join(", ")}`,
      matchedOn,
    };
  }

  private loadAllSkills(): SkillEntry[] {
    if (!fs.existsSync(this.skillsDir)) return [];

    const entries: SkillEntry[] = [];
    for (const entry of fs.readdirSync(this.skillsDir)) {
      const skillPath = path.join(this.skillsDir, entry, "SKILL.md");
      if (fs.existsSync(skillPath)) {
        const parsed = this.parseSkillFile(skillPath);
        if (parsed) entries.push(parsed);
      }
    }
    return entries;
  }

  private parseSkillFile(filePath: string): SkillEntry | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const metaMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!metaMatch) return null;

      const meta = metaMatch[1]!;
      const name = meta.match(/^name:\s*(.+)$/m)?.[1] || "";
      const desc = meta.match(/^description:\s*(.+)$/m)?.[1] || "";
      const triggersMatch = meta.match(/^triggers:\n((?:\s+- .+\n?)*)/m);
      const triggers = triggersMatch
        ? triggersMatch[1]!.split("\n").map((l) => l.trim().replace(/^- /, "")).filter(Boolean)
        : [];
      const tagsMatch = meta.match(/^tags:\n((?:\s+- .+\n?)*)/m);
      const tags = tagsMatch
        ? tagsMatch[1]!.split("\n").map((l) => l.trim().replace(/^- /, "")).filter(Boolean)
        : [];

      return { name, description: desc, triggers, tags, filePath };
    } catch {
      return null;
    }
  }
}

interface SkillEntry {
  name: string;
  description: string;
  triggers: string[];
  tags: string[];
  filePath: string;
}