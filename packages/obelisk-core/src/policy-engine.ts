/**
 * PolicyEngine — enforces execution policies for agent actions.
 *
 * Evaluates whether actions (file reads, shell commands, network access)
 * are permitted based on configured rules. Supports allow/deny/ask with
 * wildcard matching, path-based policies, and secret file protection.
 */

import { SecretRedactor } from "./secret-redactor";

// ─── Action Types ────────────────────────────────────────────────

export type AgentActionType =
  | "shell"
  | "file-read"
  | "file-write"
  | "file-delete"
  | "network"
  | "env-read"
  | "plugin-exec";

export interface AgentAction {
  type: AgentActionType;
  target: string; // File path, command, URL, etc.
  context?: string;
}

// ─── Policy Decision ─────────────────────────────────────────────

export type PolicyVerdict = "allow" | "deny" | "ask";

export interface PolicyDecision {
  verdict: PolicyVerdict;
  reason?: string;
  requiresApproval: boolean;
  redactedTarget?: string;
}

// ─── Policy Rule ─────────────────────────────────────────────────

export interface PolicyRule {
  id: string;
  description: string;
  action: AgentActionType;
  pattern: string; // Glob or regex pattern
  verdict: PolicyVerdict;
  priority: number; // Higher = evaluated first
}

// ─── Policy Config ───────────────────────────────────────────────

export interface PolicyConfig {
  denySecretFiles: boolean;
  requireApprovalForDangerousCommands: boolean;
  blockEnvFileUpload: boolean;
  blockPrivateKeyUpload: boolean;
  allowFilesystemWrites: boolean;
  allowShellCommands: "allow" | "deny" | "approval-required";
  customRules: PolicyRule[];
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  denySecretFiles: true,
  requireApprovalForDangerousCommands: true,
  blockEnvFileUpload: true,
  blockPrivateKeyUpload: true,
  allowFilesystemWrites: true,
  allowShellCommands: "approval-required",
  customRules: [],
};

// ─── Dangerous Commands ──────────────────────────────────────────

const DANGEROUS_COMMANDS = [
  /^rm\s+-rf\s+\//,
  /^sudo\s+rm/,
  /^dd\s+if=/,
  /^mkfs\./,
  /^fdisk/,
  /^>\/dev\/sd/,
  /^chmod\s+-R\s+777\s+\//,
  /^:\(\)\s*\{\s*:\|:&\s*};:/,
  /^wget\s+.*\|\s*bash/,
  /^curl\s+.*\|\s*bash/,
  /^eval\s+/,
  /^exec\s+/,
  /^source\s+\/dev\/stdin/,
  /^\.\s+\/dev\/stdin/,
];

// ─── Engine ──────────────────────────────────────────────────────

export class PolicyEngine {
  private config: PolicyConfig;
  private redactor: SecretRedactor;

  constructor(config: Partial<PolicyConfig> = {}, redactor?: SecretRedactor) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
    this.redactor = redactor || new SecretRedactor();
  }

  /**
   * Evaluate whether an action is permitted.
   */
  evaluate(action: AgentAction): PolicyDecision {
    let redactedTarget: string | undefined;

    // Check custom rules first (highest priority)
    const sortedRules = [...this.config.customRules].sort((a, b) => b.priority - a.priority);
    for (const rule of sortedRules) {
      if (rule.action === action.type && this.matchesPattern(action.target, rule.pattern)) {
        return {
          verdict: rule.verdict,
          reason: `Custom rule "${rule.description}"`,
          requiresApproval: rule.verdict === "ask",
        };
      }
    }

    // Evaluate based on action type
    switch (action.type) {
      case "file-read":
        return this.evaluateFileRead(action);
      case "file-write":
        return this.evaluateFileWrite(action);
      case "file-delete":
        return this.evaluateFileDelete(action);
      case "shell":
        return this.evaluateShell(action);
      case "network":
        return this.evaluateNetwork(action);
      case "env-read":
        return this.evaluateEnvRead(action);
      default:
        return { verdict: "ask", requiresApproval: true, reason: "Unrecognized action type" };
    }
  }

  /**
   * Test a policy rule against an action and return a human-readable explanation.
   */
  explain(action: AgentAction): string {
    const decision = this.evaluate(action);
    const lines: string[] = [];

    lines.push(`Action: ${action.type}`);
    lines.push(`Target: ${action.target}`);
    lines.push(`Decision: ${decision.verdict === "allow" ? "✓ ALLOW" : decision.verdict === "deny" ? "✗ DENY" : "? ASK"}`);
    if (decision.reason) lines.push(`Reason: ${decision.reason}`);
    if (decision.requiresApproval) lines.push("Approval: Required");

    return lines.join("\n");
  }

  /**
   * Get the current policy configuration summary.
   */
  getSummary(): Record<string, unknown> {
    return {
      denySecretFiles: this.config.denySecretFiles,
      requireApprovalForDangerousCommands: this.config.requireApprovalForDangerousCommands,
      blockEnvFileUpload: this.config.blockEnvFileUpload,
      blockPrivateKeyUpload: this.config.blockPrivateKeyUpload,
      allowFilesystemWrites: this.config.allowFilesystemWrites,
      allowShellCommands: this.config.allowShellCommands,
      customRules: this.config.customRules.length,
    };
  }

  // ─── Private Evaluators ────────────────────────────────────────

  private evaluateFileRead(action: AgentAction): PolicyDecision {
    if (this.config.denySecretFiles) {
      const protected_ = this.redactor.isProtectedPath(action.target);
      if (protected_.protected) {
        return {
          verdict: "deny",
          reason: `Protected file: ${protected_.reason}`,
          requiresApproval: false,
        };
      }
    }
    return { verdict: "allow", requiresApproval: false };
  }

  private evaluateFileWrite(action: AgentAction): PolicyDecision {
    if (!this.config.allowFilesystemWrites) {
      return { verdict: "deny", reason: "Filesystem writes disabled", requiresApproval: false };
    }

    if (this.config.blockEnvFileUpload) {
      const protected_ = this.redactor.isProtectedPath(action.target);
      if (protected_.protected) {
        return {
          verdict: "deny",
          reason: `Cannot write to protected file: ${protected_.reason}`,
          requiresApproval: false,
        };
      }
    }

    return { verdict: "ask", requiresApproval: true, reason: "File write requires approval" };
  }

  private evaluateFileDelete(action: AgentAction): PolicyDecision {
    return { verdict: "ask", requiresApproval: true, reason: "File deletion requires approval" };
  }

  private evaluateShell(action: AgentAction): PolicyDecision {
    if (this.config.allowShellCommands === "deny") {
      return { verdict: "deny", reason: "Shell commands disabled", requiresApproval: false };
    }

    if (this.config.requireApprovalForDangerousCommands) {
      for (const pattern of DANGEROUS_COMMANDS) {
        if (pattern.test(action.target)) {
          return {
            verdict: "deny",
            reason: "Dangerous command blocked",
            requiresApproval: false,
          };
        }
      }
    }

    if (this.config.denySecretFiles) {
      // A shell command's target is the whole command line, not a single
      // path, so protected-path patterns (which require a path boundary)
      // won't match against the full string — check each token instead.
      for (const token of action.target.split(/\s+/)) {
        const protected_ = this.redactor.isProtectedPath(token);
        if (protected_.protected) {
          return {
            verdict: "deny",
            reason: `Command references protected file: ${protected_.reason}`,
            requiresApproval: false,
          };
        }
      }
    }

    if (this.config.allowShellCommands === "approval-required") {
      return { verdict: "ask", requiresApproval: true, reason: "Shell command requires approval" };
    }

    return { verdict: "allow", requiresApproval: false };
  }

  private evaluateNetwork(action: AgentAction): PolicyDecision {
    return { verdict: "ask", requiresApproval: true, reason: "Network access requires approval" };
  }

  private evaluateEnvRead(action: AgentAction): PolicyDecision {
    const sensitiveVars = ["API_KEY", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL"];
    const upper = action.target.toUpperCase();
    if (sensitiveVars.some((v) => upper.includes(v))) {
      return {
        verdict: "deny",
        reason: `Sensitive environment variable: ${action.target}`,
        requiresApproval: false,
      };
    }
    return { verdict: "allow", requiresApproval: false };
  }

  // ─── Pattern Matching ──────────────────────────────────────────

  private matchesPattern(target: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    try {
      return new RegExp(`^${regexStr}$`).test(target);
    } catch {
      return target === pattern;
    }
  }
}