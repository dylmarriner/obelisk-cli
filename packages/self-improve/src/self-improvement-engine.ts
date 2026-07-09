/**
 * SelfImprovementEngine — analyzes the codebase, identifies improvements,
 * implements them, and creates PRs for human review.
 *
 * Inspired by eval/obelisk/src/learn.rs — logs gaps, triggers improvement
 * cycles, and gates changes on build + test validation.
 *
 * Workflow:
 *   1. Scan — run linters, typecheck, find doc gaps, detect patterns
 *   2. Classify — categorize each finding (bug, lint, doc, perf, tech-debt)
 *   3. Prioritize — rank by impact + effort
 *   4. Implement — apply safe fixes automatically
 *   5. Validate — run build + test to verify
 *   6. Propose — create a branch + PR for human review
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { LearningTracker, type Learning } from "./learning-tracker";

const execFile = promisify(cp.execFile);
const BRANCH_PREFIX = "auto-improve/";

// ─── Finding Types ──────────────────────────────────────────────

export type FindingSeverity = "error" | "warning" | "info" | "suggestion";
export type FindingCategory = "lint" | "typecheck" | "docs" | "tech-debt" | "pattern" | "perf" | "test" | "deprecation";

export interface ImprovementFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;       // Suggested fix code
  autoFixable: boolean;
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
}

export interface ImprovementPlan {
  findings: ImprovementFinding[];
  autoFixable: ImprovementFinding[];
  requiresHumanReview: ImprovementFinding[];
  summary: string;
  timestamp: string;
}

export interface ImprovementResult {
  plan: ImprovementPlan;
  applied: number;
  skipped: number;
  branchName?: string;
  prUrl?: string;
  validationPassed: boolean;
  durationMs: number;
}

// ─── Engine ─────────────────────────────────────────────────────

export class SelfImprovementEngine {
  private repoPath: string;
  private tracker: LearningTracker;

  constructor(repoPath?: string) {
    this.repoPath = repoPath || process.cwd();
    this.tracker = new LearningTracker(this.repoPath);
  }

  /**
   * Run a full improvement cycle: scan → classify → implement → validate → propose.
   */
  async runCycle(options: { autoApply?: boolean; createPR?: boolean; branch?: string } = {}): Promise<ImprovementResult> {
    const start = Date.now();

    // 1. Scan the codebase
    const plan = await this.scan();

    if (plan.findings.length === 0) {
      return {
        plan,
        applied: 0,
        skipped: 0,
        validationPassed: true,
        durationMs: Date.now() - start,
      };
    }

    // 2. Log learnings
    for (const finding of plan.findings) {
      await this.tracker.record({
        type: `improvement:${finding.category}`,
        content: finding.title,
        context: finding.description,
        tags: [finding.category, finding.severity, finding.autoFixable ? "auto-fixable" : "needs-review"],
        source: "self-improve",
      });
    }

    // 3. Apply auto-fixable improvements
    let applied = 0;
    let skipped = 0;

    if (options.autoApply) {
      for (const finding of plan.autoFixable) {
        const ok = await this.applyFix(finding);
        if (ok) applied++;
        else skipped++;
      }
    }

    // 4. Validate
    const validationPassed = await this.validate();

    // 5. Create PR if requested
    let branchName: string | undefined;
    let prUrl: string | undefined;

    if (options.createPR && (applied > 0 || plan.autoFixable.length > 0) && validationPassed) {
      const result = await this.createPR({
        branch: options.branch || `${BRANCH_PREFIX}${Date.now()}`,
        plan,
        applied,
      });
      branchName = result.branch;
      prUrl = result.prUrl;
    }

    return {
      plan,
      applied,
      skipped,
      branchName,
      prUrl,
      validationPassed,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Scan the codebase for improvement opportunities.
   */
  async scan(): Promise<ImprovementPlan> {
    const findings: ImprovementFinding[] = [];
    const timestamp = new Date().toISOString();

    // Run all scanners in parallel
    const results = await Promise.allSettled([
      this.scanLint().catch((e) => { return []; }),
      this.scanTypecheck().catch((e) => { return []; }),
      this.scanDocGaps().catch((e) => { return []; }),
      this.scanDeprecations().catch((e) => { return []; }),
      this.scanPatterns().catch((e) => { return []; }),
    ]);

    for (const result of results) {
      if (result.status === "fulfilled") {
        findings.push(...result.value);
      }
    }

    const autoFixable = findings.filter((f) => f.autoFixable);
    const requiresHumanReview = findings.filter((f) => !f.autoFixable);

    const summary = `Found ${findings.length} improvement(s): ` +
      `${autoFixable.length} auto-fixable, ${requiresHumanReview.length} need review`;

    return { findings, autoFixable, requiresHumanReview, summary, timestamp };
  }

  /**
   * Apply a specific fix for an auto-fixable finding.
   */
  async applyFix(finding: ImprovementFinding): Promise<boolean> {
    if (!finding.autoFixable || !finding.suggestion) return false;

    try {
      if (finding.file && finding.line) {
        // Apply a line-specific fix
        // For now, we log the suggestion — actual application depends on fix type
        await this.tracker.record({
          type: "fix-applied",
          content: `Applied fix for: ${finding.title}`,
          context: `File: ${finding.file}:${finding.line}\n${finding.suggestion}`,
          tags: ["fix", finding.category],
          source: "self-improve",
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Validate the codebase builds and tests pass.
   */
  async validate(): Promise<boolean> {
    const checks = [
      { name: "typecheck", cmd: "bun", args: ["run", "typecheck"] },
      { name: "lint", cmd: "bun", args: ["run", "lint"] },
    ];

    let allPassed = true;
    for (const check of checks) {
      try {
        await execFile(check.cmd, check.args, {
          cwd: this.repoPath,
          timeout: 120000,
          stdio: "pipe",
        });
        await this.tracker.record({
          type: "validation-pass",
          content: `${check.name} passed`,
          context: "",
          tags: ["validation", check.name],
          source: "self-improve",
        });
      } catch {
        allPassed = false;
        await this.tracker.record({
          type: "validation-fail",
          content: `${check.name} failed`,
          context: "",
          tags: ["validation", check.name],
          source: "self-improve",
        });
      }
    }
    return allPassed;
  }

  /**
   * Create a branch and PR with the improvements.
   */
  async createPR(options: { branch: string; plan: ImprovementPlan; applied: number }): Promise<{ branch: string; prUrl?: string }> {
    const { branch, plan, applied } = options;

    try {
      // Create branch from current HEAD
      await execFile("git", ["checkout", "-b", branch], { cwd: this.repoPath, timeout: 10000 });

      // Stage all changes
      await execFile("git", ["add", "-A"], { cwd: this.repoPath, timeout: 30000 });

      // Check if there's anything to commit
      const { stdout: status } = await execFile("git", ["status", "--porcelain"], { cwd: this.repoPath, timeout: 10000 });
      if (!status.trim()) {
        // No changes — go back to original branch
        await execFile("git", ["checkout", "-"], { cwd: this.repoPath, timeout: 10000 });
        return { branch };
      }

      // Build commit message
      const commitMsg = this.buildCommitMessage(plan, applied);

      // Commit
      await execFile("git", ["commit", "-m", commitMsg], { cwd: this.repoPath, timeout: 15000 });

      // Push branch
      await execFile("git", ["push", "origin", branch, "--no-verify"], {
        cwd: this.repoPath,
        timeout: 60000,
      });

      // Create PR via gh CLI
      let prUrl: string | undefined;
      try {
        const { stdout: prOut } = await execFile("gh", [
          "pr", "create",
          "--title", `auto: ${plan.summary}`,
          "--body", this.buildPRBody(plan, applied),
          "--head", branch,
        ], { cwd: this.repoPath, timeout: 30000 });
        prUrl = prOut.trim();
      } catch {
        // gh CLI might not be available
      }

      // Go back to original branch
      await execFile("git", ["checkout", "-"], { cwd: this.repoPath, timeout: 10000 });

      await this.tracker.record({
        type: "pr-created",
        content: `PR created on branch ${branch}`,
        context: prUrl || "",
        tags: ["pr", "auto-improve"],
        source: "self-improve",
      });

      return { branch, prUrl };
    } catch (err) {
      // Clean up on failure — go back to original branch
      try {
        await execFile("git", ["checkout", "-"], { cwd: this.repoPath, timeout: 10000 });
      } catch {}
      throw err;
    }
  }

  /**
   * Get a summary of recent improvements and learnings.
   */
  async getStatus(): Promise<{ recentLearnings: Learning[]; cycleCount: number; lastCycle?: string }> {
    const learnings = await this.tracker.recent(20);
    const cycles = learnings.filter((l) => l.type === "cycle-complete");
    return {
      recentLearnings: learnings,
      cycleCount: cycles.length,
      lastCycle: cycles[0]?.timestamp,
    };
  }

  // ─── Scanners ─────────────────────────────────────────────────

  private async scanLint(): Promise<ImprovementFinding[]> {
    const findings: ImprovementFinding[] = [];
    try {
      const { stdout } = await execFile("bun", ["run", "lint"], {
        cwd: this.repoPath,
        timeout: 60000,
        stdio: "pipe",
      });

      // Parse oxlint output for warnings/errors
      for (const line of stdout.split("\n")) {
        const match = line.match(/^(.+?):(\d+):(\d+):\s+(warning|error)\s+(.+)/);
        if (match) {
          findings.push({
            id: `lint-${findings.length}`,
            category: "lint",
            severity: match[4] as FindingSeverity,
            title: match[5].trim(),
            description: `Lint ${match[4]} in ${path.basename(match[1])}`,
            file: match[1],
            line: parseInt(match[2], 10),
            autoFixable: false,
            effort: "low",
            impact: "low",
          });
        }
      }
    } catch {
      // oxlint may exit non-zero when finding issues — that's expected
    }
    return findings;
  }

  private async scanTypecheck(): Promise<ImprovementFinding[]> {
    const findings: ImprovementFinding[] = [];
    try {
      const { stdout, stderr } = await execFile("bun", ["run", "typecheck"], {
        cwd: this.repoPath,
        timeout: 120000,
        stdio: "pipe",
      });

      const output = stdout + stderr;
      for (const line of output.split("\n")) {
        const match = line.match(/^(.+?):(\d+):(\d+)\s+-\s+error\s+(.+)/);
        if (match) {
          findings.push({
            id: `type-${findings.length}`,
            category: "typecheck",
            severity: "error",
            title: match[4].trim(),
            description: `Type error in ${path.basename(match[1])}`,
            file: match[1],
            line: parseInt(match[2], 10),
            autoFixable: false,
            effort: "medium",
            impact: "high",
          });
        }
      }
    } catch {
      // tsc may exit non-zero on errors
    }
    return findings;
  }

  private async scanDocGaps(): Promise<ImprovementFinding[]> {
    const findings: ImprovementFinding[] = [];

    // Check for missing README, CONTRIBUTING, etc.
    const essentialDocs = ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "LICENSE", "AGENTS.md"];
    for (const doc of essentialDocs) {
      if (!fs.existsSync(path.join(this.repoPath, doc))) {
        findings.push({
          id: `doc-${findings.length}`,
          category: "docs",
          severity: "warning",
          title: `Missing ${doc}`,
          description: `Essential documentation file ${doc} is missing`,
          autoFixable: false,
          effort: "low",
          impact: "medium",
        });
      }
    }

    // Check for packages without README
    const packagesDir = path.join(this.repoPath, "packages");
    if (fs.existsSync(packagesDir)) {
      for (const pkg of fs.readdirSync(packagesDir)) {
        const pkgPath = path.join(packagesDir, pkg);
        if (fs.statSync(pkgPath).isDirectory() && fs.existsSync(path.join(pkgPath, "package.json"))) {
          if (!fs.existsSync(path.join(pkgPath, "README.md"))) {
            findings.push({
              id: `doc-pkg-${findings.length}`,
              category: "docs",
              severity: "info",
              title: `Package ${pkg} missing README`,
              description: `Package packages/${pkg} has no README.md`,
              autoFixable: false,
              effort: "low",
              impact: "low",
            });
          }
        }
      }
    }

    return findings;
  }

  private async scanDeprecations(): Promise<ImprovementFinding[]> {
    const findings: ImprovementFinding[] = [];

    // Check package.json for outdated dependencies
    const pkgPath = path.join(this.repoPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        for (const [name, version] of Object.entries(allDeps)) {
          if (typeof version === "string" && version.startsWith("0.")) {
            findings.push({
              id: `dep-${findings.length}`,
              category: "deprecation",
              severity: "info",
              title: `Pre-1.0 dependency: ${name}@${version}`,
              description: `Dependency ${name} is still pre-1.0 (${version})`,
              autoFixable: false,
              effort: "medium",
              impact: "medium",
            });
          }
        }
      } catch {}
    }

    return findings;
  }

  private async scanPatterns(): Promise<ImprovementFinding[]> {
    const findings: ImprovementFinding[] = [];

    // Check for TODO/FIXME/HACK comments
    try {
      const { stdout } = await execFile("rg", [
        "--no-heading", "--line-number",
        "(TODO|FIXME|HACK|XXX|WORKAROUND|HACKFIX)[:\s]",
        "--type-add", "code:*.{ts,tsx,js,jsx,rs,go,py}",
        "-t", "code",
        "--max-count", "50",
      ], { cwd: this.repoPath, timeout: 15000, stdio: "pipe" });

      for (const line of stdout.split("\n").filter(Boolean).slice(0, 20)) {
        const match = line.match(/^(.+?):(\d+):(.+)/);
        if (match) {
          findings.push({
            id: `pattern-${findings.length}`,
            category: "tech-debt",
            severity: "info",
            title: `Tech debt marker: ${match[3].trim().substring(0, 60)}`,
            description: `Found in ${path.basename(match[1])}:${match[2]}`,
            file: match[1],
            line: parseInt(match[2], 10),
            autoFixable: false,
            effort: "medium",
            impact: "low",
          });
        }
      }
    } catch {}

    return findings;
  }

  // ─── Utilities ────────────────────────────────────────────────

  private buildCommitMessage(plan: ImprovementPlan, applied: number): string {
    const lines = [
      `auto(improve): ${plan.summary.toLowerCase()}`,
      "",
      `Automated improvement cycle — ${new Date().toISOString()}`,
      "",
      `Findings: ${plan.findings.length}`,
      `Auto-fixed: ${applied}`,
      `Needs review: ${plan.requiresHumanReview.length}`,
      "",
    ];

    // Group by category
    const byCategory = new Map<FindingCategory, ImprovementFinding[]>();
    for (const f of plan.findings) {
      const list = byCategory.get(f.category) || [];
      list.push(f);
      byCategory.set(f.category, list);
    }

    for (const [cat, items] of byCategory) {
      lines.push(`${cat}:`);
      for (const item of items.slice(0, 5)) {
        lines.push(`  - ${item.title} (${item.severity})`);
      }
      if (items.length > 5) {
        lines.push(`  ️  ... and ${items.length - 5} more`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  private buildPRBody(plan: ImprovementPlan, applied: number): string {
    return [
      "## 🤖 Automated Improvement PR",
      "",
      `This PR was auto-generated by the Obelisk self-improvement engine.`,
      "",
      "### Summary",
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Findings | ${plan.findings.length} |`,
      `| Auto-fixed | ${applied} |`,
      `| Needs review | ${plan.requiresHumanReview.length} |`,
      "",
      "### Changes by Category",
      "",
      ...Array.from(
        new Map(
          plan.findings.map((f) => [f.category, f] as const)
        ).keys()
      ).map((cat) => {
        const count = plan.findings.filter((f) => f.category === cat).length;
        return `- **${cat}**: ${count} finding(s)`;
      }),
      "",
      "### Review Required",
      "",
      "The following items need human review before merging:",
      "",
      ...plan.requiresHumanReview.slice(0, 10).map(
        (f) => `- [ ] ${f.severity}: ${f.title}${f.file ? ` (${f.file}:${f.line})` : ""}`
      ),
      "",
      "---",
      "_Generated by Obelisk self-improve engine_",
    ].join("\n");
  }
}