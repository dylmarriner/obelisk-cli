/**
 * AgentOrchestrator — coordinates the full tool execution workflow.
 *
 * Ties together the TaskClassifier, ToolRouter, and all adapters into
 * a unified execution pipeline. Handles the full lifecycle:
 *   classify → route → budget check → execute steps → save memory
 */

import { TaskClassifier, type ClassificationResult } from "./task-classifier";
import { ToolRouter, type ToolPlan } from "./tool-router";

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

// ─── Orchestrator ───────────────────────────────────────────────

export class AgentOrchestrator {
  private classifier: TaskClassifier;
  private router: ToolRouter;

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
        summary: `[DRY RUN] Would execute ${plan.steps.length} step(s) for "${plan.description}"`,
        durationMs: Date.now() - start,
      };
    }

    // Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      try {
        const output = await this.executeStep(step.tool, step.action, step.params, options);
        executed.push({ step: i + 1, tool: step.tool, success: true, output });
      } catch (err) {
        const message = `Error: ${(err as Error).message}`;
        executed.push({ step: i + 1, tool: step.tool, success: false, output: message });

        // Non-optional steps that fail should stop execution
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
    _action: string,
    params: Record<string, unknown>,
    _options: OrchestrationOptions,
  ): Promise<string> {
    switch (tool) {
      case "memory": {
        // In a real implementation, this would call the Nexus adapter
        return `[memory] would process with params: ${JSON.stringify(params)}`;
      }
      case "search": {
        // In a real implementation, this would call Zoekt
        return `[search] would search for: ${params.query}`;
      }
      case "semantic": {
        // In a real implementation, this would call Serena
        return `[semantic] would lookup: ${params.name}`;
      }
      case "structural": {
        // In a real implementation, this would call ast-grep
        return `[structural] would find pattern: ${params.pattern}`;
      }
      case "filesystem": {
        return `[filesystem] would read/write files`;
      }
      case "budget": {
        return `[budget] would inspect token usage`;
      }
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }
}