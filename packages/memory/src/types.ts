/**
 * Memory adapter types and interfaces for Obelisk CLI.
 *
 * Defines the contract for all memory backends (remote Nexus, local cache, etc.).
 */

// ─── Memory Scopes ───────────────────────────────────────────────

export type MemoryScope =
  | "global_user"
  | "project"
  | "session"
  | "task_history"
  | "architecture_decision"
  | "repo_summary"
  | "preference";

// ─── Memory Record ───────────────────────────────────────────────

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  projectId?: string;
  sessionId?: string;
  content: string;
  summary?: string;
  tags: string[];
  embeddingId?: string;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "agent" | "task" | "repo-analysis";
  sensitivity: "normal" | "private" | "secret-blocked";
}

// ─── Write Input ─────────────────────────────────────────────────

export interface MemoryWrite {
  scope: MemoryScope;
  content: string;
  summary?: string;
  tags: string[];
  projectId?: string;
  sessionId?: string;
  source: "manual" | "agent" | "task" | "repo-analysis";
  sensitivity: "normal" | "private" | "secret-blocked";
}

// ─── Query Input ─────────────────────────────────────────────────

export interface MemoryQuery {
  query: string;
  tags?: string[];
  scope?: MemoryScope;
  projectId?: string;
  limit?: number;
  offset?: number;
}

// ─── Forget Request ──────────────────────────────────────────────

export interface MemoryForgetRequest {
  queryOrId: string;
  scope?: MemoryScope;
}

export interface MemoryForgetResult {
  removed: number;
}

// ─── Health ──────────────────────────────────────────────────────

export interface MemoryHealth {
  ok: boolean;
  service: string;
  version: string;
  storage: string;
  uptime?: number;
}

// ─── Sync ────────────────────────────────────────────────────────

export interface MemorySyncResult {
  synced: number;
  remaining: number;
  errors?: string[];
}

// ─── Task History ────────────────────────────────────────────────

export interface TaskHistoryRecord {
  projectId: string;
  sessionId?: string;
  goal: string;
  filesTouched: string[];
  result: string;
  testsPassed: boolean;
  durationMs: number;
  model: string;
  tags: string[];
}

// ─── Architectural Decision ──────────────────────────────────────

export interface ArchitecturalDecision {
  projectId: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string[];
  rationale: string;
  date: string;
}

// ─── Adapter Interface ───────────────────────────────────────────

export interface MemoryAdapter {
  /** Check if the memory service is reachable and operational */
  health(): Promise<MemoryHealth>;

  /** Store a new memory record */
  remember(input: MemoryWrite): Promise<MemoryRecord>;

  /** Search memory records by query */
  recall(query: MemoryQuery): Promise<MemoryRecord[]>;

  /** Retrieve a single memory record by ID */
  get(id: string): Promise<MemoryRecord | null>;

  /** Remove a memory record */
  forget(input: MemoryForgetRequest): Promise<MemoryForgetResult>;

  /** Save an architectural decision record */
  saveDecision(input: ArchitecturalDecision): Promise<MemoryRecord>;

  /** Save a task history record */
  saveTaskHistory(input: TaskHistoryRecord): Promise<MemoryRecord>;

  /** Sync queued offline memory writes */
  syncOfflineQueue(): Promise<MemorySyncResult>;
}

// ─── Remote Adapter Config ───────────────────────────────────────

export interface RemoteNexusMemoryAdapterConfig {
  endpoint: string;
  apiKeyEnv: string;
  healthPath: string;
  timeoutMs: number;
  healthTimeoutMs: number;
  retries: number;
  retryBackoffMs: number[];
  offlineCachePath: string;
  syncOnReconnect: boolean;
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold: number;
    cooldownMs: number;
  };
}

// ─── Defaults ────────────────────────────────────────────────────

export const DEFAULT_NEXUS_CONFIG: RemoteNexusMemoryAdapterConfig = {
  endpoint: process.env.NEXUS_ENDPOINT || "http://100.68.0.96:7777",
  apiKeyEnv: "NEXUS_API_KEY",
  healthPath: "/health",
  timeoutMs: 5000,
  healthTimeoutMs: 1500,
  retries: 3,
  retryBackoffMs: [250, 750, 1500],
  offlineCachePath: ".obelisk/cache/memory-outbox.sqlite",
  syncOnReconnect: true,
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    cooldownMs: 300000,
  },
};