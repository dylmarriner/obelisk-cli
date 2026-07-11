/**
 * RemoteNexusMemoryAdapter — HTTP client for the remote Nexus memory server.
 *
 * Communicates with the Nexus server over Tailscale at the configured endpoint.
 * Implements the MemoryAdapter interface with retries, timeouts, offline fallback,
 * and circuit breaker patterns.
 */

import type {
  MemoryAdapter,
  MemoryHealth,
  MemoryWrite,
  MemoryRecord,
  MemoryQuery,
  MemoryForgetRequest,
  MemoryForgetResult,
  MemorySyncResult,
  RemoteNexusMemoryAdapterConfig,
  ArchitecturalDecision,
  TaskHistoryRecord,
} from "./types";
import { DEFAULT_NEXUS_CONFIG } from "./types";
import { LocalMemoryCache } from "./local-memory-cache";

// ─── Error Types ─────────────────────────────────────────────────

export class NexusConnectionError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "NexusConnectionError";
  }
}

export class NexusAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAuthError";
  }
}

export class NexusTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusTimeoutError";
  }
}

// ─── Circuit Breaker ─────────────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  open: boolean;
}

// ─── Adapter ─────────────────────────────────────────────────────

export class RemoteNexusMemoryAdapter implements MemoryAdapter {
  private config: RemoteNexusMemoryAdapterConfig;
  private offline: LocalMemoryCache;
  private circuitBreaker: CircuitBreakerState;
  private apiKey: string;

  constructor(
    config: Partial<RemoteNexusMemoryAdapterConfig> = {},
    offline?: LocalMemoryCache,
  ) {
    this.config = { ...DEFAULT_NEXUS_CONFIG, ...config };
    this.offline = offline || new LocalMemoryCache(this.config.offlineCachePath);
    this.circuitBreaker = { failures: 0, lastFailureTime: 0, open: false };
    this.apiKey = process.env[this.config.apiKeyEnv] || "";
  }

  // ─── Health Check ──────────────────────────────────────────────

  async health(): Promise<MemoryHealth> {
    if (this.isCircuitBroken()) {
      throw new NexusConnectionError("Circuit breaker is open — too many recent failures");
    }

    const raw = await this.request<Record<string, unknown>>(
      this.config.healthPath,
      { method: "GET" },
      this.config.healthTimeoutMs,
    );

    return {
      ok: (raw.ok ?? raw.healthy) === true,
      service: typeof raw.service === "string" ? raw.service : "nexus",
      version: typeof raw.version === "string" ? raw.version : "unknown",
      storage: typeof raw.storage === "string"
        ? raw.storage
        : raw.components && typeof raw.components === "object"
          ? Object.entries(raw.components as Record<string, boolean>)
              .filter(([, up]) => up)
              .map(([name]) => name)
              .join(", ")
          : "unknown",
      uptime: typeof raw.uptime === "number" ? raw.uptime : undefined,
    };
  }

  // ─── Remember ──────────────────────────────────────────────────

  async remember(input: MemoryWrite): Promise<MemoryRecord> {
    try {
      if (this.isCircuitBroken()) {
        return this.offline.queueWrite(input);
      }

      const result = await this.request<MemoryRecord>("/v1/memory", {
        method: "POST",
        body: JSON.stringify(input),
      });

      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      return this.offline.queueWrite(input);
    }
  }

  // ─── Recall ────────────────────────────────────────────────────

  async recall(query: MemoryQuery): Promise<MemoryRecord[]> {
    try {
      if (this.isCircuitBroken()) {
        return this.offline.search(query);
      }

      const result = await this.request<MemoryRecord[]>("/v1/memory/search", {
        method: "POST",
        body: JSON.stringify(query),
      });

      this.recordSuccess();
      return result;
    } catch {
      this.recordFailure();
      return this.offline.search(query);
    }
  }

  // ─── Get by ID ─────────────────────────────────────────────────

  async get(id: string): Promise<MemoryRecord | null> {
    try {
      if (this.isCircuitBroken()) {
        return this.offline.get(id);
      }

      const result = await this.request<MemoryRecord | null>(
        `/v1/memory/${encodeURIComponent(id)}`,
        { method: "GET" },
      );

      this.recordSuccess();
      return result;
    } catch {
      this.recordFailure();
      return this.offline.get(id);
    }
  }

  // ─── Forget ────────────────────────────────────────────────────

  async forget(input: MemoryForgetRequest): Promise<MemoryForgetResult> {
    if (this.isCircuitBroken()) {
      throw new NexusConnectionError("Circuit breaker is open");
    }

    return this.request<MemoryForgetResult>("/v1/memory/forget", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ─── Save Decision ─────────────────────────────────────────────

  async saveDecision(input: ArchitecturalDecision): Promise<MemoryRecord> {
    return this.remember({
      scope: "architecture_decision",
      content: JSON.stringify(input),
      tags: ["adr", input.projectId],
      source: "agent",
      sensitivity: "normal",
    });
  }

  // ─── Save Task History ─────────────────────────────────────────

  async saveTaskHistory(input: TaskHistoryRecord): Promise<MemoryRecord> {
    return this.remember({
      scope: "task_history",
      content: JSON.stringify(input),
      tags: ["task", input.projectId, ...input.tags],
      source: "agent",
      sensitivity: "normal",
    });
  }

  // ─── Sync Offline Queue ────────────────────────────────────────

  async syncOfflineQueue(): Promise<MemorySyncResult> {
    const queued = await this.offline.pendingWrites();
    let synced = 0;
    const errors: string[] = [];

    for (const item of queued) {
      try {
        await this.request<MemoryRecord>("/v1/memory", {
          method: "POST",
          body: JSON.stringify(item),
        });
        await this.offline.markSynced(item.localId);
        synced++;
      } catch (err) {
        errors.push(`Failed to sync ${item.localId}: ${(err as Error).message}`);
      }
    }

    return { synced, remaining: queued.length - synced, errors: errors.length > 0 ? errors : undefined };
  }

  // ─── Utility: Check if Nexus is reachable ──────────────────────

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.health();
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  // ─── Private: HTTP Request ─────────────────────────────────────

  private async request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs?: number,
  ): Promise<T> {
    const url = `${this.config.endpoint}${path}`;
    const timeout = timeoutMs ?? this.config.timeoutMs;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          ...(init.headers as Record<string, string>),
        };

        if (this.apiKey) {
          headers["authorization"] = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers,
        });

        if (res.status === 401 || res.status === 403) {
          throw new NexusAuthError(`Nexus auth failed: ${res.status} ${res.statusText}`);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "unknown");
          throw new NexusConnectionError(`Nexus ${res.status}: ${text}`, res.status);
        }

        return await res.json() as T;
      } catch (err) {
        const isAbort = (err as Error)?.name === "AbortError";
        lastError = isAbort ? new NexusTimeoutError(`Request timed out after ${timeout}ms`) : err;

        if (attempt < this.config.retries) {
          const backoff = this.config.retryBackoffMs[attempt] ?? 1500;
          await sleep(backoff);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  }

  // ─── Private: Circuit Breaker ──────────────────────────────────

  private isCircuitBroken(): boolean {
    if (!this.config.circuitBreaker?.enabled) return false;
    if (!this.circuitBreaker.open) return false;

    const now = Date.now();
    const cooldown = this.config.circuitBreaker.cooldownMs;
    if (now - this.circuitBreaker.lastFailureTime > cooldown) {
      this.circuitBreaker.open = false;
      this.circuitBreaker.failures = 0;
      return false;
    }
    return true;
  }

  private recordSuccess(): void {
    if (this.config.circuitBreaker?.enabled) {
      this.circuitBreaker.failures = 0;
    }
  }

  private recordFailure(): void {
    if (!this.config.circuitBreaker?.enabled) return;
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();
    if (this.circuitBreaker.failures >= (this.config.circuitBreaker.failureThreshold ?? 5)) {
      this.circuitBreaker.open = true;
    }
  }
}

// ─── Utility: Sleep ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}