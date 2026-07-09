/**
 * TaskClassifier — analyzes user intent and classifies the task type.
 *
 * Determines what kind of assistance the user needs based on their
 * natural language query, enabling the ToolRouter to select the
 * appropriate tools.
 */

// ─── Task Types ─────────────────────────────────────────────────

export type TaskType =
  | "continue_work"       // Resume from previous session
  | "find_implementation" // "Where is X implemented?"
  | "explain_architecture" // "Explain how X works"
  | "rename_symbol"       // "Rename this function/class"
  | "find_pattern"        // "Find code that does X"
  | "refactor_code"       // "Refactor this pattern across the repo"
  | "summarize_repo"      // "Summarize this project"
  | "add_feature"         // "Add a new feature"
  | "fix_bug"             // "Fix a bug"
  | "check_budget"        // "Check token usage"
  | "search_code"         // General code search
  | "save_memory"         // "Remember this fact"
  | "recall_memory"       // "What did we decide about X?"
  | "unknown";

// ─── Classification Result ──────────────────────────────────────

export interface ClassificationResult {
  taskType: TaskType;
  confidence: number;
  keywords: string[];
  requiresPriorContext: boolean;
  requiresCodeSearch: boolean;
  requiresSymbolUnderstanding: boolean;
  requiresStructuralPattern: boolean;
  requiresFilesystemAccess: boolean;
  requiresMemory: boolean;
  requiresBudgetCheck: boolean;
}

// ─── Classifier ─────────────────────────────────────────────────

const PATTERNS: { type: TaskType; patterns: RegExp[]; weight: number }[] = [
  {
    type: "continue_work",
    weight: 0.9,
    patterns: [
      /continue/i, /resume/i, /pick up where/i, /from last time/i,
      /keep working/i, /carry on/i, /as we discussed/i,
    ],
  },
  {
    type: "find_implementation",
    weight: 0.85,
    patterns: [
      /where is/i, /find (the |where is )?(implementation|definition|code)/i,
      /how is .+ implemented/i, /show me (the )?code for/i,
      /what does .+ do/i, /locate/i,
    ],
  },
  {
    type: "explain_architecture",
    weight: 0.8,
    patterns: [
      /explain/i, /how does .+ work/i, /architecture/i, /overview/i,
      /describe (the )?(architecture|system|flow)/i, /how is .+ structured/i,
      /what is the relationship/i, /diagram/i,
    ],
  },
  {
    type: "rename_symbol",
    weight: 0.9,
    patterns: [
      /rename/i, /change (the )?name of/i, /rename .+ to/i,
    ],
  },
  {
    type: "find_pattern",
    weight: 0.8,
    patterns: [
      /find (all |every |the )?(pattern|usage|occurrence|call)/i,
      /search for (pattern|code like|similar)/i,
      /where (is|are) .+ (used|called|referenced)/i,
      /find .+ pattern/i,
    ],
  },
  {
    type: "refactor_code",
    weight: 0.85,
    patterns: [
      /refactor/i, /rewrite/i, /migrate/i, /convert .+ to/i,
      /replace (all |every )?/i, /change (all |every )?/i,
      /codemod/i, /transform/i,
    ],
  },
  {
    type: "summarize_repo",
    weight: 0.8,
    patterns: [
      /summarize/i, /what does this project do/i, /project overview/i,
      /give me a summary/i, /what is this repo/i,
    ],
  },
  {
    type: "add_feature",
    weight: 0.7,
    patterns: [
      /add (a |an |the )?(feature|new|functionality)/i,
      /implement/i, /build (a |an )?/i, /create (a |an |new )?/i,
      /write (a |an |the )?(function|class|component|module)/i,
    ],
  },
  {
    type: "fix_bug",
    weight: 0.8,
    patterns: [
      /fix/i, /bug/i, /issue/i, /broken/i, /not working/i,
      /error/i, /crash/i, /failing/i, /incorrect/i,
    ],
  },
  {
    type: "check_budget",
    weight: 0.9,
    patterns: [
      /budget/i, /token (usage|count|limit)/i, /how many tokens/i,
      /cost/i, /usage/i,
    ],
  },
  {
    type: "search_code",
    weight: 0.7,
    patterns: [
      /search (for |the )?/i, /find (the |a )?(file|string|text)/i,
      /look (for|up)/i, /grep/i,
    ],
  },
  {
    type: "save_memory",
    weight: 0.85,
    patterns: [
      /remember/i, /save (that|this|the fact)/i, /note that/i,
      /keep in mind/i, /don'?t forget/i,
    ],
  },
  {
    type: "recall_memory",
    weight: 0.85,
    patterns: [
      /what (did|was|were|is)/i, /recall/i, /remind me/i,
      /what do we know about/i, /prior decisions/i,
      /previous (work|discussion|decision)/i,
    ],
  },
];

export class TaskClassifier {
  /**
   * Classify a user query into a task type.
   */
  classify(query: string): ClassificationResult {
    const matchedKeywords: string[] = [];
    let bestType: TaskType = "unknown";
    let bestScore = 0;

    for (const { type, patterns, weight } of PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          matchedKeywords.push(pattern.source.substring(0, 40));
          const score = weight;
          if (score > bestScore) {
            bestScore = score;
            bestType = type;
          }
        }
      }
    }

    // If no pattern matched, try keyword-based heuristics
    if (bestType === "unknown") {
      const words = query.toLowerCase().split(/\s+/);

      if (words.some((w) => ["where", "find", "locate", "show"].includes(w))) {
        bestType = "find_implementation";
        bestScore = 0.5;
      } else if (words.some((w) => ["how", "what", "explain", "describe"].includes(w))) {
        bestType = "explain_architecture";
        bestScore = 0.5;
      } else if (words.some((w) => ["add", "create", "implement", "build", "write"].includes(w))) {
        bestType = "add_feature";
        bestScore = 0.5;
      } else if (words.some((w) => ["fix", "bug", "error", "broken"].includes(w))) {
        bestType = "fix_bug";
        bestScore = 0.5;
      } else if (words.some((w) => ["search", "find", "look"].includes(w))) {
        bestType = "search_code";
        bestScore = 0.4;
      }
    }

    // Derive routing flags from task type
    const requiresPriorContext = bestType === "continue_work" || bestType === "recall_memory";
    const requiresCodeSearch = [
      "find_implementation", "find_pattern", "search_code", "explain_architecture",
    ].includes(bestType);
    const requiresSymbolUnderstanding = [
      "rename_symbol", "find_implementation", "explain_architecture",
    ].includes(bestType);
    const requiresStructuralPattern = [
      "refactor_code", "find_pattern",
    ].includes(bestType);
    const requiresFilesystemAccess = [
      "add_feature", "fix_bug", "refactor_code",
    ].includes(bestType);
    const requiresMemory = [
      "continue_work", "recall_memory", "save_memory",
    ].includes(bestType);
    const requiresBudgetCheck = ["check_budget"].includes(bestType);

    return {
      taskType: bestType,
      confidence: bestScore,
      keywords: [...new Set(matchedKeywords)],
      requiresPriorContext,
      requiresCodeSearch,
      requiresSymbolUnderstanding,
      requiresStructuralPattern,
      requiresFilesystemAccess,
      requiresMemory,
      requiresBudgetCheck,
    };
  }
}
