/**
 * AgentOrchestrator — coordinates the full tool execution workflow.
 *
 * Ties together the TaskClassifier, ToolRouter, and adapters into a concrete
 * execution pipeline:
 *   classify → route → execute tool steps → return compact execution report.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { TaskClassifier, type ClassificationResult } from "./task-classifier";
import { ToolRouter, type ToolPlan } from "./tool-router";
import { RemoteNexusMemoryAdapter, LocalMemoryCache, DEFAULT_NEXUS_CONFIG } from "@obelisk-ai/memory";
import { ZoektSearchAdapter } from "@obelisk-ai/search";
import { SerenaMcpAdapter } from "@obelisk-ai/semantic";
import { AstGrepAdapter } from "@obelisk-ai/structural";
import { TokenBudgetManager, estimateTokens } from "@obelisk-ai/obelisk-core";

// ─── Execution Result ───────────────────────────────────────────

export interface OrchestrationResult {
  classification: ClassificationResult;
  plan: ToolPlan;
  executed: { step: number; tool: string; success: boolean; output?: string }[];
  summary: string;
  durationMs: number;
}

export interface OrchestrationOptions {
  dryRun?: boolean;
  skipApproval?: boolean;
  verbose?: boolean;
}

type StepParams = Record<string, unknown>;

// ─── Orchestrator ───────────────────────────────────────────────

export class AgentOrchestrator {
  private classifier: TaskClassifier;
  private router: ToolRouter;
  private memory?: RemoteNexusMemoryAdapter;
  private search?: ZoektSearchAdapter;
  private semantic?: SerenaMcpAdapter;
  private structural?: AstGrepAdapter;
  private budget?: TokenBudgetManager;

  constructor() {
    this.classifier = new TaskClassifier();
    this.router = new ToolRouter();
  }

  /**
   * Analyze a user query and produce an execution plan without running it.
   */
  analyze(query: string): { classification: ClassificationResult; plan: ToolPlan } {
    const classification = this.classifier.classify(query);
    const plan = this.router.route(classification, query);
    return { classification, plan };
  }

  /**
   * Execute a full orchestration workflow.
   */
  async execute(query: string, options: OrchestrationOptions = {}): Promise<OrchestrationResult> {
    const start = Date.now();
    const { classification, plan } = this.analyze(query);
    const executed: { step: number; tool: string; success: boolean; output?: string }[] = [];

    if (options.dryRun) {
      return {
        classification,
        plan,
        executed: [],
        summary: `[DRY RUN] Planned ${plan.steps.length} step(s) for "${plan.description}"`,
        durationMs: Date.now() - start,
      };
    }

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      try {
        const output = await this.executeStep(step.tool, step.action, step.params, options);
        executed.push({ step: i + 1, tool: step.tool, success: true, output });
      } catch (err) {
        const message = `Error: ${(err as Error).message}`;
        executed.push({ step: i + 1, tool: step.tool, success: false, output: message });

        if (!step.optional) {
          return {
            classification,
            plan,
            executed,
            summary: `Failed at step ${i + 1} ([${step.tool}] ${step.action}): ${(err as Error).message}`,
            durationMs: Date.now() - start,
          };
        }
      }
    }

    const successful = executed.filter((e) => e.success).length;
    const failed = executed.filter((e) => !e.success).length;

    return {
      classification,
      plan,
      executed,
      summary: `Completed ${successful} step(s)${failed > 0 ? `, ${failed} failed` : ""}`,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Get a formatted report of the orchestration result.
   */
  formatReport(result: OrchestrationResult, verbose = false): string {
    const lines: string[] = [];
    lines.push("");
    lines.push("  Orchestration Report");
    lines.push("  " + "─".repeat(40));
    lines.push(`  Task:     ${result.plan.description}`);
    lines.push(`  Type:     ${result.classification.taskType}`);
    lines.push(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    lines.push(`  Result:   ${result.summary}`);
    lines.push("");

    if (result.executed.length > 0) {
      lines.push("  Execution Steps:");
      for (const step of result.executed) {
        const icon = step.success ? "✓" : "✗";
        lines.push(`    ${icon} Step ${step.step}: [${step.tool}]`);
        if (step.output && verbose) {
          lines.push(`       ${step.output.substring(0, 100)}`);
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ─── Private: Execute a single step ───────────────────────────

  private async executeStep(
    tool: string,
    action: string,
    params: StepParams,
    options: OrchestrationOptions,
  ): Promise<string> {
    switch (tool) {
      case "memory":
        return this.executeMemoryStep(action, params);
      case "search":
        return this.executeSearchStep(action, params);
      case "semantic":
        return this.executeSemanticStep(action, params);
      case "structural":
        return this.executeStructuralStep(action, params);
      case "filesystem":
        return this.executeFilesystemStep(action, params, options);
      case "budget":
        return this.executeBudgetStep(action, params);
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async executeMemoryStep(action: string, params: StepParams): Promise<string> {
    const adapter = this.getMemoryAdapter();
    const query = readString(params.query);
    const content = readString(params.content);

    if (action.toLowerCase().includes("save") || content) {
      if (!content) throw new Error("Memory save requires content");
      const record = await adapter.remember({
        scope: "project",
        content,
        tags: ["orchestrator", "obelisk"],
        source: "agent",
        sensitivity: "normal",
      });
      return JSON.stringify({ saved: true, id: record.id, scope: record.scope }, null, 2);
    }

    if (!query) throw new Error("Memory recall requires a query");
    const results = await adapter.recall({ query, limit: 8 });
    return JSON.stringify({ query, count: results.length, results: compactMemoryResults(results) }, null, 2);
  }

  private async executeSearchStep(action: string, params: StepParams): Promise<string> {
    const adapter = this.getSearchAdapter();
    const query = readString(params.query);

    if (action.toLowerCase().includes("index") || !query) {
      const repoPath = readString(params.repoPath) || process.cwd();
      const result = await adapter.index({ repoPath });
      return JSON.stringify(result, null, 2);
    }

    const results = await adapter.search({ query, maxResults: 12 });
    return JSON.stringify({ query, count: results.length, results: results.slice(0, 12) }, null, 2);
  }

  private async executeSemanticStep(action: string, params: StepParams): Promise<string> {
    const adapter = this.getSemanticAdapter();
    const name = readString(params.name);
    const file = readString(params.file);

    if (action.toLowerCase().includes("reference")) {
      if (!name || !file) throw new Error("Semantic reference lookup requires name and file");
      const refs = await adapter.findReferences({ name, file });
      return JSON.stringify({ name, file, count: refs.length, references: refs.slice(0, 20) }, null, 2);
    }

    if (name) {
      const symbols = await adapter.findSymbol({ name, file: file || undefined, includeInfo: true, maxMatches: 20 });
      return JSON.stringify({ name, count: symbols.length, symbols: symbols.slice(0, 20) }, null, 2);
    }

    const symbols = await adapter.listSymbols({ file: file || undefined, depth: -1 });
    return JSON.stringify({ file: file || process.cwd(), count: symbols.length, symbols: symbols.slice(0, 40) }, null, 2);
  }

  private async executeStructuralStep(action: string, params: StepParams): Promise<string> {
    const adapter = this.getStructuralAdapter();
    const pattern = readString(params.pattern);
    const language = readString(params.language) || "ts";
    const repoPath = readString(params.repoPath) || process.cwd();

    if (action.toLowerCase().includes("scan")) {
      const rule = readString(params.rule);
      const ruleText = readString(params.ruleText);
      if (!rule && !ruleText) throw new Error("Structural scan requires rule or ruleText");
      const issues = await adapter.scan({ rule: rule || undefined, ruleText: ruleText || undefined, repoPath });
      return JSON.stringify({ count: issues.length, issues: issues.slice(0, 30) }, null, 2);
    }

    if (!pattern) throw new Error("Structural search requires an AST pattern");
    const matches = await adapter.find({ pattern, language, repoPath });
    return JSON.stringify({ pattern, language, count: matches.length, matches: matches.slice(0, 30) }, null, 2);
  }

  private async executeFilesystemStep(_action: string, params: StepParams, _options: OrchestrationOptions): Promise<string> {
    const repoPath = path.resolve(readString(params.repoPath) || process.cwd());
    const file = readString(params.file);

    if (file) {
      const fullPath = ensureInsideRepo(repoPath, file);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) throw new Error(`Not a file: ${file}`);
      return fs.readFileSync(fullPath, "utf-8").slice(0, 24_000);
    }

    const summary = inspectProjectFilesystem(repoPath);
    return JSON.stringify(summary, null, 2);
  }

  private async executeBudgetStep(_action: string, params: StepParams): Promise<string> {
    const budget = this.getBudgetManager();
    const sources = Object.entries(params)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([name, value]) => ({
        name,
        tokens: estimateTokens(String(value), name.toLowerCase().includes("code")),
        percentage: 0,
        isCode: name.toLowerCase().includes("code"),
      }));

    if (sources.length === 0) {
      sources.push({
        name: "orchestration-params",
        tokens: estimateTokens(JSON.stringify(params)),
        percentage: 0,
        isCode: false,
      });
    }

    const report = budget.inspect(sources);
    return JSON.stringify(report, null, 2);
  }

  private getMemoryAdapter(): RemoteNexusMemoryAdapter {
    if (!this.memory) {
      const endpoint = process.env.NEXUS_ENDPOINT || DEFAULT_NEXUS_CONFIG.endpoint;
      const cachePath = process.env.NEXUS_OFFLINE_CACHE || DEFAULT_NEXUS_CONFIG.offlineCachePath;
      this.memory = new RemoteNexusMemoryAdapter({ endpoint }, new LocalMemoryCache(cachePath));
    }
    return this.memory;
  }

  private getSearchAdapter(): ZoektSearchAdapter {
    if (!this.search) this.search = new ZoektSearchAdapter();
    return this.search;
  }

  private getSemanticAdapter(): SerenaMcpAdapter {
    if (!this.semantic) this.semantic = new SerenaMcpAdapter();
    return this.semantic;
  }

  private getStructuralAdapter(): AstGrepAdapter {
    if (!this.structural) this.structural = new AstGrepAdapter();
    return this.structural;
  }

  private getBudgetManager(): TokenBudgetManager {
    if (!this.budget) this.budget = new TokenBudgetManager();
    return this.budget;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compactMemoryResults(records: Array<{ id: string; scope: string; content: string; summary?: string; tags?: string[] }>) {
  return records.map((record) => ({
    id: record.id,
    scope: record.scope,
    summary: record.summary || record.content.slice(0, 240),
    tags: record.tags || [],
  }));
}

function ensureInsideRepo(repoPath: string, relativePath: string): string {
  const fullPath = path.resolve(repoPath, relativePath);
  const normalizedRepo = repoPath.endsWith(path.sep) ? repoPath : repoPath + path.sep;
  if (fullPath !== repoPath && !fullPath.startsWith(normalizedRepo)) {
    throw new Error(`Refusing to read outside repository: ${relativePath}`);
  }
  return fullPath;
}

function inspectProjectFilesystem(repoPath: string) {
  const topLevel = fs.readdirSync(repoPath, { withFileTypes: true })
    .filter((entry) => !IGNORED_NAMES.has(entry.name))
    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "dir" : "file" }))
    .slice(0, 200);

  const importantFiles = ["package.json", "README.md", "obelisk.config.jsonc", "tsconfig.json", "bunfig.toml"]
    .filter((name) => fs.existsSync(path.join(repoPath, name)))
    .map((name) => ({
      name,
      preview: fs.readFileSync(path.join(repoPath, name), "utf-8").slice(0, 2_000),
    }));

  return {
    repoPath,
    topLevel,
    importantFiles,
  };
}

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  "coverage",
  ".obelisk",
]);
