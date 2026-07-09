/**
 * LocalMemoryCache — offline fallback for Nexus memory.
 *
 * Stores memory writes locally when the remote Nexus server is unreachable.
 * Uses a simple JSONL file for persistence. Supports queuing writes,
 * searching cached records, and marking items as synced.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryWrite, MemoryRecord, MemoryQuery, MemoryScope } from "./types";

// ─── Queued Write ────────────────────────────────────────────────

export interface QueuedWrite extends MemoryWrite {
  localId: string;
  queuedAt: string;
  synced: boolean;
}

// ─── Local Cache ─────────────────────────────────────────────────

export class LocalMemoryCache {
  private filePath: string;
  private dirPath: string;
  private writes: QueuedWrite[] = [];
  private dirty = false;

  constructor(cachePath: string) {
    this.filePath = cachePath;
    this.dirPath = path.dirname(cachePath);
    this.load();
  }

  // ─── Queue a Write ─────────────────────────────────────────────

  async queueWrite(input: MemoryWrite): Promise<MemoryRecord> {
    const write: QueuedWrite = {
      ...input,
      localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: new Date().toISOString(),
      synced: false,
    };

    this.writes.push(write);
    this.dirty = true;
    this.persist();

    return {
      id: write.localId,
      scope: input.scope,
      content: input.content,
      summary: input.summary,
      tags: input.tags,
      createdAt: write.queuedAt,
      updatedAt: write.queuedAt,
      source: input.source,
      sensitivity: input.sensitivity,
      status: "queued",
    } as MemoryRecord;
  }

  // ─── Pending Writes ────────────────────────────────────────────

  async pendingWrites(): Promise<QueuedWrite[]> {
    return this.writes.filter((w) => !w.synced);
  }

  // ─── Mark as Synced ────────────────────────────────────────────

  async markSynced(localId: string): Promise<void> {
    const write = this.writes.find((w) => w.localId === localId);
    if (write) {
      write.synced = true;
      this.dirty = true;
      this.persist();
    }
  }

  // ─── Search Local Cache ────────────────────────────────────────

  async search(query: MemoryQuery): Promise<MemoryRecord[]> {
    const q = query.query.toLowerCase();
    let results = this.writes
      .filter((w) => !w.synced)
      .filter((w) => {
        const contentMatch = w.content.toLowerCase().includes(q);
        const tagMatch = query.tags?.length
          ? query.tags.some((t) => w.tags.includes(t))
          : false;
        const scopeMatch = query.scope ? w.scope === query.scope : true;
        return (contentMatch || tagMatch) && scopeMatch;
      })
      .map((w) => ({
        id: w.localId,
        scope: w.scope,
        content: w.content,
        summary: w.summary,
        tags: w.tags,
        createdAt: w.queuedAt,
        updatedAt: w.queuedAt,
        source: w.source,
        sensitivity: w.sensitivity,
      }));

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  // ─── Get by ID ─────────────────────────────────────────────────

  async get(id: string): Promise<MemoryRecord | null> {
    const write = this.writes.find((w) => w.localId === id);
    if (!write) return null;

    return {
      id: write.localId,
      scope: write.scope,
      content: write.content,
      summary: write.summary,
      tags: write.tags,
      createdAt: write.queuedAt,
      updatedAt: write.queuedAt,
      source: write.source,
      sensitivity: write.sensitivity,
    };
  }

  // ─── Stats ─────────────────────────────────────────────────────

  stats(): { total: number; pending: number; synced: number } {
    const total = this.writes.length;
    const pending = this.writes.filter((w) => !w.synced).length;
    return { total, pending, synced: total - pending };
  }

  // ─── Persistence ───────────────────────────────────────────────

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.writes = [];
        return;
      }
      const data = fs.readFileSync(this.filePath, "utf-8");
      this.writes = data
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as QueuedWrite);
    } catch {
      this.writes = [];
    }
  }

  private persist(): void {
    try {
      if (!fs.existsSync(this.dirPath)) {
        fs.mkdirSync(this.dirPath, { recursive: true });
      }
      const data = this.writes
        .filter((w) => !w.synced)
        .map((w) => JSON.stringify(w))
        .join("\n");
      fs.writeFileSync(this.filePath, data + "\n", "utf-8");
    } catch {
      // Silently fail — cache is non-critical
    }
  }
}