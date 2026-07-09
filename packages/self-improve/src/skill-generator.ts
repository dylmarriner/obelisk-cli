/**
 * SkillGenerator — analyzes learnings and usage patterns to generate new skills.
 *
 * Skills are reusable instruction files stored in .qwen/skills/<name>/SKILL.md
 * that teach the agent how to handle specific tasks. This generator:
 *   1. Analyzes learning records for recurring patterns
 *   2. Identifies tasks done repeatedly that could be automated
 *   3. Generates new skill files with proper frontmatter
 *   4. Updates existing skills when better patterns are found
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Learning } from "./learning-tracker";

const SKILLS_DIR = ".qwen/skills";

// ─── Types ──────────────────────────────────────────────────────

export interface SkillMeta {
  name: string;
  description: string;
  source: "auto-skill" | "user" | "curated";
  extracted_at: string;
  version?: number;
  triggers?: string[];
  tags?: string[];
}

export interface Skill {
  meta: SkillMeta;
  body: string;
  filePath: string;
}

export interface SkillGenerationResult {
  created: Skill[];
  updated: Skill[];
  skipped: number;
}

// ─── Generator ──────────────────────────────────────────────────

export class SkillGenerator {
  private skillsDir: string;

  constructor(baseDir?: string) {
    this.skillsDir = path.join(baseDir || process.cwd(), SKILLS_DIR);
    fs.mkdirSync(this.skillsDir, { recursive: true });
  }

  /**
   * Analyze learnings and generate new skills.
   */
  async generateFromLearnings(learnings: Learning[]): Promise<SkillGenerationResult> {
    const created: Skill[] = [];
    const updated: Skill[] = [];
    let skipped = 0;

    // Group learnings by recurring patterns
    const patterns = this.extractPatterns(learnings);

    for (const pattern of patterns) {
      const existing = this.findSkill(pattern.name);

      if (existing) {
        // Update existing skill if pattern is stronger
        if (pattern.confidence > 0.8) {
          const updatedSkill = this.updateSkill(existing, pattern);
          updated.push(updatedSkill);
        } else {
          skipped++;
        }
      } else {
        // Create new skill
        const skill = this.createSkill(pattern);
        if (skill) {
          created.push(skill);
        }
      }
    }

    return { created, updated, skipped };
  }

  /**
   * Generate a skill from a specific learning record.
   */
  async generateFromLearning(learning: Learning): Promise<Skill | null> {
    const name = this.sanitizeName(learning.type.replace(/[^a-z0-9-]/g, "-"));

    // Check if skill already exists
    const existing = this.findSkill(name);
    if (existing) return null;

    const skill = this.createSkill({
      name,
      description: this.describeFromLearning(learning),
      confidence: 0.7,
      triggers: learning.tags,
      body: this.buildBodyFromLearning(learning),
    });

    return skill;
  }

  /**
   * List all auto-generated skills.
   */
  listSkills(): Skill[] {
    if (!fs.existsSync(this.skillsDir)) return [];

    const skills: Skill[] = [];
    for (const entry of fs.readdirSync(this.skillsDir)) {
      const skillPath = path.join(this.skillsDir, entry, "SKILL.md");
      if (fs.existsSync(skillPath)) {
        const skill = this.readSkill(skillPath);
        if (skill) skills.push(skill);
      }
    }
    return skills;
  }

  // ─── Pattern Extraction ───────────────────────────────────────

  private extractPatterns(learnings: Learning): Pattern[] {
    const patterns: Pattern[] = [];
    const groups = new Map<string, Learning[]>();

    // Group by type
    for (const l of learnings) {
      const key = l.type;
      const list = groups.get(key) || [];
      list.push(l);
      groups.set(key, list);
    }

    // Analyze each group for patterns
    for (const [type, items] of groups) {
      if (items.length < 2) continue; // Need at least 2 occurrences

      const commonTags = this.findCommonTags(items);
      patterns.push({
        name: this.sanitizeName(type.replace(/[^a-z0-9-]/g, "-")),
        description: `Auto-generated skill for handling ${type} tasks based on ${items.length} observations`,
        confidence: Math.min(0.5 + items.length * 0.05, 0.95),
        triggers: commonTags,
        body: this.buildPatternBody(type, items),
      });
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  private findCommonTags(learnings: Learning[]): string[] {
    const tagCounts = new Map<string, number>();
    for (const l of learnings) {
      for (const tag of l.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    return Array.from(tagCounts.entries())
      .filter(([, count]) => count >= learnings.length * 0.3)
      .map(([tag]) => tag)
      .slice(0, 5);
  }

  // ─── Skill CRUD ───────────────────────────────────────────────

  private findSkill(name: string): Skill | null {
    const skillPath = path.join(this.skillsDir, name, "SKILL.md");
    if (fs.existsSync(skillPath)) {
      return this.readSkill(skillPath);
    }
    return null;
  }

  private readSkill(filePath: string): Skill | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const metaMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!metaMatch) return null;

      const meta = this.parseFrontmatter(metaMatch[1]);
      return { meta, body: metaMatch[2].trim(), filePath };
    } catch {
      return null;
    }
  }

  private createSkill(pattern: Pattern): Skill | null {
    const name = pattern.name;
    const dir = path.join(this.skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });

    const meta: SkillMeta = {
      name,
      description: pattern.description,
      source: "auto-skill",
      extracted_at: new Date().toISOString(),
      version: 1,
      triggers: pattern.triggers,
      tags: pattern.triggers,
    };

    const body = pattern.body || this.buildDefaultBody(name, pattern.description);
    const content = this.formatSkill(meta, body);

    const filePath = path.join(dir, "SKILL.md");
    fs.writeFileSync(filePath, content, "utf-8");

    return { meta, body, filePath };
  }

  private updateSkill(existing: Skill, pattern: Pattern): Skill {
    const updatedMeta: SkillMeta = {
      ...existing.meta,
      version: (existing.meta.version || 1) + 1,
      extracted_at: new Date().toISOString(),
      triggers: [...new Set([...(existing.meta.triggers || []), ...(pattern.triggers || [])])],
    };

    const body = pattern.body || existing.body;
    const content = this.formatSkill(updatedMeta, body);

    fs.writeFileSync(existing.filePath, content, "utf-8");

    return { meta: updatedMeta, body, filePath: existing.filePath };
  }

  private formatSkill(meta: SkillMeta, body: string): string {
    const frontmatter = [
      "---",
      `name: ${meta.name}`,
      `description: ${meta.description}`,
      `source: ${meta.source}`,
      `extracted_at: '${meta.extracted_at}'`,
      meta.version ? `version: ${meta.version}` : null,
      meta.triggers?.length ? `triggers:\n${meta.triggers.map((t) => `  - ${t}`).join("\n")}` : null,
      meta.tags?.length ? `tags:\n${meta.tags.map((t) => `  - ${t}`).join("\n")}` : null,
      "---",
    ]
      .filter(Boolean)
      .join("\n");

    return `${frontmatter}\n\n${body}\n`;
  }

  private parseFrontmatter(raw: string): SkillMeta {
    const meta: Partial<SkillMeta> = { name: "", description: "", source: "auto-skill", extracted_at: "" };
    for (const line of raw.split("\n")) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim().replace(/^'|'$/g, "");
      if (key === "name") meta.name = value;
      else if (key === "description") meta.description = value;
      else if (key === "source") meta.source = value as any;
      else if (key === "extracted_at") meta.extracted_at = value;
      else if (key === "version") meta.version = parseInt(value, 10);
    }
    return meta as SkillMeta;
  }

  // ─── Builders ─────────────────────────────────────────────────

  private buildPatternBody(type: string, learnings: Learning[]): string {
    const examples = learnings.slice(0, 3).map((l) => l.content).join("\n");
    const tags = [...new Set(learnings.flatMap((l) => l.tags))].join(", ");

    return [
      `# ${type}`,
      "",
      `Auto-generated from ${learnings.length} observations.`,
      "",
      "## When to use",
      "",
      `- When you encounter tasks related to "${type}"`,
      `- When the context includes: ${tags || "general patterns"}`,
      "",
      "## Examples from past usage",
      "",
      examples ? `\`\`\`\n${examples}\n\`\`\`` : "",
      "",
      "## Steps",
      "",
      "1. Analyze the current context for relevant patterns",
      "2. Apply the learned approach from past observations",
      "3. Verify the result matches expected outcomes",
      "",
    ].join("\n");
  }

  private buildBodyFromLearning(learning: Learning): string {
    return [
      `# ${learning.type}`,
      "",
      `Auto-generated from observation.`,
      "",
      "## Context",
      `\`\`\`\n${learning.context || learning.content}\n\`\`\``,
      "",
      "## When to use",
      `- When the task matches: "${learning.content}"`,
      `- Tags: ${learning.tags.join(", ")}`,
      "",
    ].join("\n");
  }

  private buildDefaultBody(name: string, description: string): string {
    return [
      `# ${name}`,
      "",
      `${description}`,
      "",
      "## When to use",
      `- When the task matches this skill's purpose`,
      "",
      "## Steps",
      "",
      "1. Understand the current context",
      "2. Apply the appropriate approach",
      "3. Verify the result",
      "",
    ].join("\n");
  }

  private describeFromLearning(learning: Learning): string {
    return `Auto-generated skill for ${learning.type} patterns based on observed usage`;
  }

  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 60);
  }
}

// ─── Internal Types ─────────────────────────────────────────────

interface Pattern {
  name: string;
  description: string;
  confidence: number;
  triggers?: string[];
  body?: string;
}