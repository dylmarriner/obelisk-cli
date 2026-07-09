/**
 * SelfImprovementEngine — scans a repository, records findings, optionally
 * applies explicit line-level fixes, validates the repository, and can open a PR.
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { LearningTracker, type Learning } from "./learning-tracker";

const execFile = promisify(cp.execFile);
const BRANCH_PREFIX = "auto-improve/";

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
  suggestion?: string;
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

export class SelfImprovementEngine {
  private repoPath: string;
  private tracker: LearningTracker;

  constructor(repoPath?: string) {
    this.repoPath = path.resolve(repoPath || process.cwd());
    this.tracker = new LearningTracker(this.repoPath);
  }

  async runCycle(options: { autoApply?: boolean; createPR?: boolean; branch?: string } = {}): Promise<ImprovementResult> {
    const start = Date.now();
    const plan = await this.scan();

    for (const finding of plan.findings) {
      await this.tracker.record({
        type: `improvement:${finding.category}`,
        content: finding.title,
        context: finding.description,
        tags: [finding.category, finding.severity, finding.autoFixable ? "auto-fixable" : "needs-review"],
        source: "self-improve",
      });
    }

    let applied = 0;
    let skipped = 0;

    if (options.autoApply) {
      for (const finding of plan.autoFixable) {
        const ok = await this.applyFix(finding);
        if (ok) applied++;
        else skipped++;
      }
    }

    const validationPassed = await this.validate();
    let branchName: string | undefined;
    let prUrl: string | undefined;

    if (options.createPR && applied > 0 && validationPassed) {
      const result = await this.createPR({
        branch: options.branch || `${BRANCH_PREFIX}${Date.now()}`,
        plan,
        applied,
      });
      branchName = result.branch;
      prUrl = result.prUrl;
    }

    await this.tracker.record({
      type: "cycle-complete",
      content: plan.summary,
      context: JSON.stringify({ applied, skipped, validationPassed, branchName, prUrl }),
      tags: ["cycle", validationPassed ? "valid" : "invalid"],
      source: "self-improve",
    });

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

  async scan(): Promise<ImprovementPlan> {
    const timestamp = new Date().toISOString();
    const results = await Promise.allSettled([
      this.scanLint(),
      this.scanTypecheck(),
      this.scanDocGaps(),
      this.scanDeprecations(),
      this.scanPatterns(),
    ]);

    const findings = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const autoFixable = findings.filter((f) => f.autoFixable);
    const requiresHumanReview = findings.filter((f) => !f.autoFixable);
    const summary = `Found ${findings.length} improvement(s): ${autoFixable.length} auto-fixable, ${requiresHumanReview.length} need review`;

    return { findings, autoFixable, requiresHumanReview, summary, timestamp };
  }

  async applyFix(finding: ImprovementFinding): Promise<boolean> {
    if (!finding.autoFixable || !finding.suggestion || !finding.file || !finding.line) return false;

    const target = ensureInsideRepo(this.repoPath, finding.file);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;

    const original = fs.readFileSync(target, "utf-8");
    const newline = original.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.split(/\r?\n/);
    const lineIndex = finding.line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) return false;

    lines[lineIndex] = finding.suggestion;
    fs.writeFileSync(target, lines.join(newline), "utf-8");

    await this.tracker.record({
      type: "fix-applied",
      content: `Applied fix for: ${finding.title}`,
      context: `File: ${finding.file}:${finding.line}`,
      tags: ["fix", finding.category],
      source: "self-improve",
    });

    return true;
  }

  async validate(): Promise<boolean> {
    const checks = [
      { name: "typecheck", cmd: "bun", args: ["run", "typecheck"] },
      { name: "lint", cmd: "bun", args: ["run", "lint"] },
    ];

    let allPassed = true;
    for (const check of checks) {
      try {
        await execFile(check.cmd, check.args, { cwd: this.repoPath, timeout: 120000 });
        await this.tracker.record({
          type: "validation-pass",
          content: `${check.name} passed`,
          context: "",
          tags: ["validation", check.name],
          source: "self-improve",
        });
      } catch (err) {
        allPassed = false;
        await this.tracker.record({
          type: "validation-fail",
          content: `${check.name} failed`,
          context: (err as Error).message,
          tags: ["validation", check.name],
          source: "self-improve",
        });
      }
    }
    return allPassed;
  }

  async createPR(options: { branch: string; plan: ImprovementPlan; applied: number }): Promise<{ branch: string; prUrl?: string }> {
    const { branch, plan, applied } = options;
    const originalBranch = (await execFile("git", ["branch", "--show-current"], { cwd: this.repoPath, timeout: 10000 })).stdout.trim();

    try {
      await execFile("git", ["checkout", "-b", branch], { cwd: this.repoPath, timeout: 10000 });
      await execFile("git", ["add", "-A"], { cwd: this.repoPath, timeout: 30000 });

      const { stdout: status } = await execFile("git", ["status", "--porcelain"], { cwd: this.repoPath, timeout: 10000 });
      if (!status.trim()) {
        await execFile("git", ["checkout", originalBranch], { cwd: this.repoPath, timeout: 10000 });
        return { branch };
      }

      await execFile("git", ["commit", "-m", this.buildCommitMessage(plan, applied)], { cwd: this.repoPath, timeout: 15000 });
      await execFile("git", ["push", "origin", branch, "--no-verify"], { cwd: this.repoPath, timeout: 60000 });

      let prUrl: string | undefined;
      try {
        const { stdout } = await execFile("gh", [
          "pr", "create",
          "--title", `auto: ${plan.summary}`,
          "--body", this.buildPRBody(plan, applied),
          "--head", branch,
        ], { cwd: this.repoPath, timeout: 30000 });
        prUrl = stdout.trim();
      } catch {}

      await execFile("git", ["checkout", originalBranch], { cwd: this.repoPath, timeout: 10000 });
      await this.tracker.record({
        type: "pr-created",
        content: `PR created on branch ${branch}`,
        context: prUrl || "",
        tags: ["pr", "auto-improve"],
        source: "self-improve",
      });

      return { branch, prUrl };
    } catch (err) {
      try {
        if (originalBranch) await execFile("git", ["checkout", originalBranch], { cwd: this.repoPath, timeout: 10000 });
      } catch {}
      throw err;
    }
  }

  async getStatus(): Promise<{ recentLearnings: Learning[]; cycleCount: number; lastCycle?: string }> {
    const learnings = await this.tracker.recent(20);
    const cycles = learnings.filter((l) => l.type === "cycle-complete");
    return {
      recentLearnings: learnings,
      cycleCount: cycles.length,
      lastCycle: cycles[0]?.timestamp,
    };
  }

  private async scanLint(): Promise<ImprovementFinding[]> {
    const output = await runCommandCapture("bun", ["run", "lint"], this.repoPath, 60000);
    return parseDiagnostics(output, "lint", "low", "low");
  }

  private async scanTypecheck(): Promise<ImprovementFinding[]> {
    const output = await runCommandCapture("bun", ["run", "typecheck"], this.repoPath, 120000);
    return parseDiagnostics(output, "typecheck", "medium", "high");
  }

  private async scanDocGaps(): Promise<ImprovementFinding[]> {
    const findings: ImprovementFinding[] = [];
    const docs = ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "LICENSE", "AGENTS.md"];

    for (const doc of docs) {
      if (!fs.existsSync(path.join(this.repoPath, doc))) {
        findings.push({
          id: `doc-${findings.length}`,
          category: "docs",
          severity: "warning",
          title: `Missing ${doc}`,
          description: `Documentation file ${doc} is missing`,
          autoFixable: false,
          effort: "low",
          impact: "medium",
        });
      }
    }

    return findings;
  }

  private async scanDeprecations(): Promise<ImprovementFinding[]> {
    const findings: ImprovementFinding[] = [];
    const pkgPath = path.join(this.repoPath, "package.json");
    if (!fs.existsSync(pkgPath)) return findings;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [name, version] of Object.entries(deps)) {
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

    return findings;
  }

  private async scanPatterns(): Promise<ImprovementFinding[]> {
    const output = await runCommandCapture("rg", [
      "--no-heading",
      "--line-number",
      "(TODO|FIXME|HACK|XXX|WORKAROUND|HACKFIX)[:\\s]",
      "--type-add",
      "code:*.{ts,tsx,js,jsx,rs,go,py}",
      "-t",
      "code",
      "--max-count",
      "50",
    ], this.repoPath, 15000);

    return output.split("\n").filter(Boolean).slice(0, 50).flatMap((line, index) => {
      const match = line.match(/^(.+?):(\d+):(.+)/);
      if (!match) return [];
      return [{
        id: `pattern-${index}`,
        category: "tech-debt" as FindingCategory,
        severity: "info" as FindingSeverity,
        title: `Tech debt marker: ${match[3].trim().slice(0, 80)}`,
        description: `Found in ${path.basename(match[1])}:${match[2]}`,
        file: match[1],
        line: Number.parseInt(match[2], 10),
        autoFixable: false,
        effort: "medium" as const,
        impact: "low" as const,
      }];
    });
  }

  private buildCommitMessage(plan: ImprovementPlan, applied: number): string {
    return [
      `auto(improve): ${plan.summary.toLowerCase()}`,
      "",
      `Automated improvement cycle — ${new Date().toISOString()}`,
      "",
      `Findings: ${plan.findings.length}`,
      `Auto-fixed: ${applied}`,
      `Needs review: ${plan.requiresHumanReview.length}`,
    ].join("\n");
  }

  private buildPRBody(plan: ImprovementPlan, applied: number): string {
    return [
      "## Automated Improvement PR",
      "",
      "This PR was generated by the Obelisk self-improvement engine.",
      "",
      "### Summary",
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Findings | ${plan.findings.length} |`,
      `| Auto-fixed | ${applied} |`,
      `| Needs review | ${plan.requiresHumanReview.length} |`,
      "",
      "### Review Required",
      "",
      ...plan.requiresHumanReview.slice(0, 20).map((f) => `- [ ] ${f.severity}: ${f.title}${f.file ? ` (${f.file}:${f.line})` : ""}`),
    ].join("\n");
  }
}

async function runCommandCapture(cmd: string, args: string[], cwd: string, timeout: number): Promise<string> {
  try {
    const { stdout, stderr } = await execFile(cmd, args, { cwd, timeout });
    return `${stdout}\n${stderr}`;
  } catch (err) {
    const anyErr = err as { stdout?: string; stderr?: string; message?: string };
    return `${anyErr.stdout || ""}\n${anyErr.stderr || ""}\n${anyErr.message || ""}`;
  }
}

function parseDiagnostics(
  output: string,
  category: "lint" | "typecheck",
  effort: ImprovementFinding["effort"],
  impact: ImprovementFinding["impact"],
): ImprovementFinding[] {
  const findings: ImprovementFinding[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(.+?):(\d+):(\d+):?\s*(warning|error)?\s*(.+)$/i);
    if (!match) continue;
    findings.push({
      id: `${category}-${findings.length}`,
      category,
      severity: (match[4]?.toLowerCase() === "warning" ? "warning" : "error") as FindingSeverity,
      title: match[5].trim(),
      description: `${category} finding in ${path.basename(match[1])}`,
      file: match[1],
      line: Number.parseInt(match[2], 10),
      autoFixable: false,
      effort,
      impact,
    });
  }
  return findings;
}

function ensureInsideRepo(repoPath: string, relativePath: string): string {
  const fullPath = path.resolve(repoPath, relativePath);
  const normalizedRepo = repoPath.endsWith(path.sep) ? repoPath : repoPath + path.sep;
  if (fullPath !== repoPath && !fullPath.startsWith(normalizedRepo)) {
    throw new Error(`Refusing to modify outside repository: ${relativePath}`);
  }
  return fullPath;
}
