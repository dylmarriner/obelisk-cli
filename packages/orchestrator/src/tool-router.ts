/**
 * ToolRouter — decides which tools to use based on the classified task.
 *
 * Maps task types to tool chains, respecting the Obelisk budget and policy.
 * Suggests the optimal sequence of tools (memory, search, semantic, structural,
 * filesystem) for each task type.
 */

import type { ClassificationResult, TaskType } from "./task-classifier";

// ─── Tool Plan ──────────────────────────────────────────────────

export interface ToolPlan {
  taskType: TaskType;
  description: string;
  steps: ToolStep[];
  requiresApproval: boolean;
}

export interface ToolStep {
  tool: string;
  action: string;
  params: Record<string, unknown>;
  optional: boolean;
}

// ─── Router ─────────────────────────────────────────────────────

const ROUTES: Record<TaskType, Omit<ToolPlan, "taskType">> = {
  continue_work: {
    description: "Resume from prior context using memory recall",
    requiresApproval: false,
    steps: [
      { tool: "memory", action: "recall prior context", params: { query: "" }, optional: false },
      { tool: "search", action: "find relevant files", params: { query: "" }, optional: true },
      { tool: "filesystem", action: "read current state", params: {}, optional: false },
    ],
  },
  find_implementation: {
    description: "Search codebase for implementation details",
    requiresApproval: false,
    steps: [
      { tool: "search", action: "indexed keyword search", params: { query: "" }, optional: false },
      { tool: "semantic", action: "symbol lookup", params: { name: "" }, optional: true },
      { tool: "filesystem", action: "read relevant files", params: {}, optional: false },
    ],
  },
  explain_architecture: {
    description: "Analyze codebase architecture and relationships",
    requiresApproval: false,
    steps: [
      { tool: "memory", action: "recall prior knowledge", params: { query: "" }, optional: true },
      { tool: "search", action: "find relevant modules", params: { query: "" }, optional: false },
      { tool: "semantic", action: "symbol relationships", params: { name: "" }, optional: true },
      { tool: "filesystem", action: "read key files", params: {}, optional: false },
    ],
  },
  rename_symbol: {
    description: "Safe symbol rename across the project",
    requiresApproval: true,
    steps: [
      { tool: "semantic", action: "find symbol and references", params: { name: "" }, optional: false },
      { tool: "structural", action: "verify structural usages", params: { pattern: "" }, optional: true },
      { tool: "filesystem", action: "apply renames", params: {}, optional: false },
    ],
  },
  find_pattern: {
    description: "Search for code patterns using AST matching",
    requiresApproval: false,
    steps: [
      { tool: "structural", action: "AST pattern search", params: { pattern: "" }, optional: false },
      { tool: "search", action: "supplement with text search", params: { query: "" }, optional: true },
    ],
  },
  refactor_code: {
    description: "Structural refactoring across the codebase",
    requiresApproval: true,
    steps: [
      { tool: "structural", action: "find pattern matches", params: { pattern: "" }, optional: false },
      { tool: "semantic", action: "verify symbol boundaries", params: { name: "" }, optional: true },
      { tool: "filesystem", action: "apply rewrites", params: {}, optional: false },
    ],
  },
  summarize_repo: {
    description: "Generate project summary and overview",
    requiresApproval: false,
    steps: [
      { tool: "search", action: "index project structure", params: {}, optional: false },
      { tool: "semantic", action: "list top-level symbols", params: {}, optional: true },
      { tool: "memory", action: "save repo summary", params: {}, optional: true },
    ],
  },
  add_feature: {
    description: "Implement new functionality",
    requiresApproval: true,
    steps: [
      { tool: "memory", action: "recall project conventions", params: { query: "" }, optional: true },
      { tool: "search", action: "find similar patterns", params: { query: "" }, optional: false },
      { tool: "semantic", action: "understand existing code", params: { name: "" }, optional: true },
      { tool: "filesystem", action: "implement changes", params: {}, optional: false },
      { tool: "memory", action: "save task summary", params: {}, optional: true },
    ],
  },
  fix_bug: {
    description: "Diagnose and fix bugs",
    requiresApproval: true,
    steps: [
      { tool: "memory", action: "recall related context", params: { query: "" }, optional: true },
      { tool: "search", action: "find relevant code", params: { query: "" }, optional: false },
      { tool: "semantic", action: "understand symbol flow", params: { name: "" }, optional: true },
      { tool: "structural", action: "check pattern consistency", params: { pattern: "" }, optional: true },
      { tool: "filesystem", action: "apply fix", params: {}, optional: false },
      { tool: "memory", action: "save fix summary", params: {}, optional: true },
    ],
  },
  check_budget: {
    description: "Check token budget and usage",
    requiresApproval: false,
    steps: [
      { tool: "budget", action: "inspect token usage", params: {}, optional: false },
    ],
  },
  search_code: {
    description: "General code search",
    requiresApproval: false,
    steps: [
      { tool: "search", action: "indexed search", params: { query: "" }, optional: false },
      { tool: "structural", action: "pattern search if applicable", params: { pattern: "" }, optional: true },
    ],
  },
  save_memory: {
    description: "Save facts and decisions to memory",
    requiresApproval: false,
    steps: [
      { tool: "memory", action: "save to durable memory", params: { content: "" }, optional: false },
    ],
  },
  recall_memory: {
    description: "Recall prior decisions and context",
    requiresApproval: false,
    steps: [
      { tool: "memory", action: "recall relevant memory", params: { query: "" }, optional: false },
      { tool: "search", action: "find related files", params: { query: "" }, optional: true },
    ],
  },
  unknown: {
    description: "General assistance — using broad toolset",
    requiresApproval: false,
    steps: [
      { tool: "memory", action: "check for prior context", params: { query: "" }, optional: true },
      { tool: "search", action: "search codebase", params: { query: "" }, optional: true },
      { tool: "filesystem", action: "read current state", params: {}, optional: false },
    ],
  },
};

export class ToolRouter {
  /**
   * Build a tool execution plan from a classified task.
   */
  route(classification: ClassificationResult, userQuery: string): ToolPlan {
    const route = ROUTES[classification.taskType] || ROUTES.unknown;

    // Fill in query parameters from the user's input
    const steps = route.steps.map((step) => ({
      ...step,
      params: {
        ...step.params,
        query: step.params.query === "" ? userQuery : step.params.query,
        content: step.params.content === "" ? userQuery : step.params.content,
        name: step.params.name === "" ? this.extractSymbolName(userQuery) : step.params.name,
        pattern: step.params.pattern === "" ? this.extractPattern(userQuery, step.tool) : step.params.pattern,
      },
    }));

    return {
      taskType: classification.taskType,
      description: route.description,
      steps,
      requiresApproval: route.requiresApproval,
    };
  }

  /**
   * Get a human-readable summary of a tool plan.
   */
  summarize(plan: ToolPlan): string {
    const lines: string[] = [];
    lines.push(`Task: ${plan.description}`);
    lines.push(`Steps: ${plan.steps.length}`);
    lines.push("");
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]!;
      const icon = step.optional ? "◷" : "→";
      lines.push(`  ${icon} Step ${i + 1}: [${step.tool}] ${step.action}`);
    }
    if (plan.requiresApproval) {
      lines.push("");
      lines.push("  ⚠ Approval required before execution");
    }
    return lines.join("\n");
  }

  private extractSymbolName(query: string): string {
    // Try to extract a symbol name (CamelCase, dot-separated, or function names)
    const patterns = [
      /rename\s+(\w+(?:\.\w+)*)/i,
      /symbol\s+(\w+(?:\.\w+)*)/i,
      /(\w+(?:\.\w+)*)\s+(function|class|method|symbol)/i,
      /(?:find|search|locate)\s+(\w+(?:\.\w+)*)/i,
    ];
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) return match[1]!;
    }
    // Fallback: return the first CamelCase word
    const camelCase = query.match(/\b[A-Z][a-zA-Z0-9]+\b/);
    return camelCase ? camelCase[0] : "";
  }

  private extractPattern(query: string, tool: string): string {
    if (tool === "structural") {
      // Try to extract an AST pattern from quotes
      const quoted = query.match(/["'`]([^"'`]+)["'`]/);
      if (quoted) return quoted[1]!;
    }
    return "";
  }
}