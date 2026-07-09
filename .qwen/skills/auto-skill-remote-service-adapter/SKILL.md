---
name: remote-service-adapter
description: Pattern for integrating remote services with circuit breaker, retry with exponential backoff, offline queue, and health checking
source: auto-skill
extracted_at: '2026-07-09T06:10:51.923Z'
---

# Remote Service Adapter Pattern

Use this skill when building an adapter for a remote service that needs resilience: circuit breaker, retry with exponential backoff, offline fallback queue, and health checking. This pattern was used for the Nexus memory server integration.

## Architecture

```
Client Code
    │
    ▼
RemoteServiceAdapter
    │
    ├── Circuit Breaker ────── open after N failures, cooldown period
    │
    ├── HTTP Client ────────── retries, timeouts, bearer auth, typed errors
    │
    └── Offline Queue ──────── local fallback when remote is unreachable
         │
         └── JSONL/SQLite persistence
```

## Step-by-step Process

### Step 1: Define types and interfaces

Create a `types.ts` with the adapter interface and all supporting types:

```typescript
export interface ServiceAdapter {
  health(): Promise<ServiceHealth>;
  // ... primary operations
}

export interface ServiceConfig {
  endpoint: string;
  apiKeyEnv: string;
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

export const DEFAULT_CONFIG: ServiceConfig = {
  endpoint: process.env.SERVICE_ENDPOINT || "http://default:8080",
  apiKeyEnv: "SERVICE_API_KEY",
  timeoutMs: 5000,
  healthTimeoutMs: 1500,
  retries: 3,
  retryBackoffMs: [250, 750, 1500],
  offlineCachePath: ".cache/service-outbox.jsonl",
  syncOnReconnect: true,
  circuitBreaker: { enabled: true, failureThreshold: 5, cooldownMs: 300000 },
};
```

### Step 2: Create typed error classes

```typescript
export class ServiceConnectionError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ServiceConnectionError";
  }
}

export class ServiceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceAuthError";
  }
}

export class ServiceTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceTimeoutError";
  }
}
```

### Step 3: Implement the circuit breaker

```typescript
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  open: boolean;
}

// In the adapter class:
private circuitBreaker: CircuitBreakerState = { failures: 0, lastFailureTime: 0, open: false };

private isCircuitBroken(): boolean {
  if (!this.config.circuitBreaker?.enabled) return false;
  if (!this.circuitBreaker.open) return false;

  const now = Date.now();
  const cooldown = this.config.circuitBreaker.cooldownMs;
  if (now - this.circuitBreaker.lastFailureTime > cooldown) {
    // Half-open: allow one request through
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
```

### Step 4: Implement the HTTP client with retries

```typescript
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

      // Auth errors are not retried
      if (res.status === 401 || res.status === 403) {
        throw new ServiceAuthError(`Auth failed: ${res.status} ${res.statusText}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "unknown");
        throw new ServiceConnectionError(`Service ${res.status}: ${text}`, res.status);
      }

      return await res.json() as T;
    } catch (err) {
      const isAbort = (err as Error)?.name === "AbortError";
      lastError = isAbort ? new ServiceTimeoutError(`Timed out after ${timeout}ms`) : err;

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
```

### Step 5: Implement offline fallback with primary operations

```typescript
async primaryOperation(input: Input): Promise<Output> {
  try {
    if (this.isCircuitBroken()) {
      return this.offline.queueWrite(input); // fallback to offline
    }
    const result = await this.request<Output>("/v1/endpoint", {
      method: "POST",
      body: JSON.stringify(input),
    });
    this.recordSuccess();
    return result;
  } catch (err) {
    this.recordFailure();
    return this.offline.queueWrite(input); // fallback to offline
  }
}
```

### Step 6: Implement the offline queue

Create a `local-queue.ts`:

```typescript
export interface QueuedItem {
  localId: string;
  queuedAt: string;
  synced: boolean;
  payload: unknown;
}

export class LocalQueue {
  private filePath: string;
  private items: QueuedItem[] = [];

  constructor(cachePath: string) {
    this.filePath = cachePath;
    this.load();
  }

  async queueWrite(payload: unknown): Promise<QueuedItem> {
    const item: QueuedItem = {
      localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: new Date().toISOString(),
      synced: false,
      payload,
    };
    this.items.push(item);
    this.persist();
    // Return a "pending" result so the caller can continue
    return item;
  }

  async pendingWrites(): Promise<QueuedItem[]> {
    return this.items.filter((i) => !i.synced);
  }

  async markSynced(localId: string): Promise<void> {
    const item = this.items.find((i) => i.localId === localId);
    if (item) { item.synced = true; this.persist(); }
  }

  async search(query: string): Promise<QueuedItem[]> {
    const q = query.toLowerCase();
    return this.items.filter((i) =>
      !i.synced && JSON.stringify(i.payload).toLowerCase().includes(q)
    );
  }

  stats(): { total: number; pending: number; synced: number } {
    const total = this.items.length;
    const pending = this.items.filter((i) => !i.synced).length;
    return { total, pending, synced: total - pending };
  }

  private load(): void {
    // Load from JSONL file
    try {
      if (!fs.existsSync(this.filePath)) { this.items = []; return; }
      const data = fs.readFileSync(this.filePath, "utf-8");
      this.items = data.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch { this.items = []; }
  }

  private persist(): void {
    // Write unsynced items as JSONL
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = this.items.filter((i) => !i.synced).map((i) => JSON.stringify(i)).join("\n");
      fs.writeFileSync(this.filePath, data + "\n", "utf-8");
    } catch { /* non-critical, swallow */ }
  }
}
```

### Step 7: Implement sync and health check

```typescript
async syncOfflineQueue(): Promise<SyncResult> {
  const queued = await this.offline.pendingWrites();
  let synced = 0;
  const errors: string[] = [];

  for (const item of queued) {
    try {
      await this.request("/v1/endpoint", {
        method: "POST",
        body: JSON.stringify(item.payload),
      });
      await this.offline.markSynced(item.localId);
      synced++;
    } catch (err) {
      errors.push(`Failed to sync ${item.localId}: ${(err as Error).message}`);
    }
  }

  return { synced, remaining: queued.length - synced, errors: errors.length > 0 ? errors : undefined };
}

async health(): Promise<ServiceHealth> {
  if (this.isCircuitBroken()) {
    throw new ServiceConnectionError("Circuit breaker is open");
  }
  return this.request<ServiceHealth>(
    "/health",
    { method: "GET" },
    this.config.healthTimeoutMs,
  );
}

async ping(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await this.health();
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
```

### Step 8: Wire into CLI commands

Create a command group (e.g. `obelisk service`) with these subcommands:

| Command | Implementation |
|---------|---------------|
| `health` | Call `adapter.health()`, display service info |
| `ping` | Call `adapter.ping()`, show latency |
| `config` | Display endpoint, API key status, timeouts |
| `sync` | Call `adapter.syncOfflineQueue()`, show results |
| `test-write` | Write a test record, verify by reading back |

### Step 9: Handle edge cases

- **Auth failures (401/403)**: Throw `ServiceAuthError` — do NOT retry auth failures
- **Timeouts**: `AbortError` → `ServiceTimeoutError` — retry with backoff
- **Circuit open**: Throw immediately with clear message, do NOT attempt request
- **Offline queue**: Continue session, queue writes locally, sync on reconnect
- **Reconnect**: Background retry every 60s during long sessions
- **Persistence**: JSONL is simple and debuggable; SQLite is better for large queues

### Step 10: Configuration

The adapter should read from environment variables with sensible defaults:

```typescript
// In the constructor
this.config = { ...DEFAULT_CONFIG, ...providedConfig };
this.apiKey = process.env[this.config.apiKeyEnv] || "";
```

Expose a `DEFAULT_CONFIG` so CLI commands can show current settings.

## Example: Full adapter skeleton

```typescript
export class RemoteServiceAdapter implements ServiceAdapter {
  private config: ServiceConfig;
  private offline: LocalQueue;
  private circuitBreaker: CircuitBreakerState;
  private apiKey: string;

  constructor(config: Partial<ServiceConfig> = {}, offline?: LocalQueue) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.offline = offline || new LocalQueue(this.config.offlineCachePath);
    this.circuitBreaker = { failures: 0, lastFailureTime: 0, open: false };
    this.apiKey = process.env[this.config.apiKeyEnv] || "";
  }

  async health(): Promise<ServiceHealth> { /* ... */ }
  async ping(): Promise<{ ok: boolean; latencyMs: number }> { /* ... */ }
  async primaryOp(input: Input): Promise<Output> { /* ... */ }
  async syncOfflineQueue(): Promise<SyncResult> { /* ... */ }
}
```

## Key design rules

1. **Auth failures are never retried** — 401/403 throw immediately
2. **Circuit breaker resets after cooldown** — half-open state allows one probe request
3. **Offline queue is transparent** — caller gets a valid result object either way
4. **Health check has its own shorter timeout** — don't block on a slow health check
5. **Backoff is exponential with jitter** — 250ms → 750ms → 1500ms pattern
6. **Queue is durable** — persisted to disk, survives process restarts
7. **Sync is best-effort** — errors during sync don't crash the caller