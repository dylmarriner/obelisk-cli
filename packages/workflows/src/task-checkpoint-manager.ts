/**
 * TaskCheckpointManager — save and resume long-running tasks.
 *
 * Each task gets a directory under .obelisk/tasks/<task-id>/ with:
 *   meta.json   — task metadata (goal, model, created, status)
 *   state.json  — current execution state (files touched, progress)
 *   checkpoint.json — last checkpoint for resumption
 */

import * as fs from "node:fs";
import * as path from "node:path";

const TASKS_DIR = ".obelisk/tasks";

// ─── Types ──────────────────────────────────────────────────────

export type TaskStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

export interface TaskMeta {
  id: string;
  goal: string;
  status: TaskStatus;
  model: string;
  createdAt: string;
  updatedAt: string;
  worktree?: string;
  filesTouched: string[];
  steps: number;
  currentStep: number;
  tags: string[];
}

export interface Checkpoint {
  step: number;
  description: string;
  timestamp: string;
  snapshot: Record<string, unknown>;
}

export interface TaskManager {
  create(goal: string, options?: Partial<TaskMeta>): Promise<TaskMeta>;
  get(id: string): Promise<TaskMeta | null>;
  list(): Promise<TaskMeta[]>;
  update(id: string, updates: Partial<TaskMeta>): Promise<TaskMeta>;
  checkpoint(id: string, description: string, snapshot?: Record<string, unknown>): Promise<Checkpoint>;
  resume(id: string): Promise<{ task: TaskMeta; checkpoint: Checkpoint | null }>;
  remove(id: string): Promise<void>;
}

// ─── Implementation ─────────────────────────────────────────────

export class LocalTaskManager implements TaskManager {
  private tasksDir: string;

  constructor(baseDir?: string) {
    this.tasksDir = path.join(baseDir || process.cwd(), TASKS_DIR);
    fs.mkdirSync(this.tasksDir, { recursive: true });
  }

  async create(goal: string, options?: Partial<TaskMeta>): Promise<TaskMeta> {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const meta: TaskMeta = {
      id,
      goal,
      status: "running",
      model: options?.model || "unknown",
      createdAt: now,
      updatedAt: now,
      filesTouched: options?.filesTouched || [],
      steps: options?.steps || 1,
      currentStep: 0,
      tags: options?.tags || [],
      worktree: options?.worktree,
    };

    this.writeMeta(meta);
    return meta;
  }

  async get(id: string): Promise<TaskMeta | null> {
    const filePath = this.metaPath(id);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TaskMeta;
  }

  async list(): Promise<TaskMeta[]> {
    if (!fs.existsSync(this.tasksDir)) return [];

    const tasks: TaskMeta[] = [];
    for (const entry of fs.readdirSync(this.tasksDir)) {
      const metaPath = path.join(this.tasksDir, entry, "meta.json");
      if (fs.existsSync(metaPath)) {
        tasks.push(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
      }
    }

    return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async update(id: string, updates: Partial<TaskMeta>): Promise<TaskMeta> {
    const meta = await this.get(id);
    if (!meta) throw new Error(`Task not found: ${id}`);

    const updated: TaskMeta = {
      ...meta,
      ...updates,
      id: meta.id, // id is immutable
      updatedAt: new Date().toISOString(),
    };

    this.writeMeta(updated);
    return updated;
  }

  async checkpoint(id: string, description: string, snapshot?: Record<string, unknown>): Promise<Checkpoint> {
    const meta = await this.get(id);
    if (!meta) throw new Error(`Task not found: ${id}`);

    const cp: Checkpoint = {
      step: meta.currentStep,
      description,
      timestamp: new Date().toISOString(),
      snapshot: snapshot || {},
    };

    const cpPath = path.join(this.tasksDir, id, "checkpoint.json");
    fs.mkdirSync(path.dirname(cpPath), { recursive: true });
    fs.writeFileSync(cpPath, JSON.stringify(cp, null, 2), "utf-8");

    return cp;
  }

  async resume(id: string): Promise<{ task: TaskMeta; checkpoint: Checkpoint | null }> {
    const meta = await this.get(id);
    if (!meta) throw new Error(`Task not found: ${id}`);

    // Update status to running
    meta.status = "running";
    meta.updatedAt = new Date().toISOString();
    this.writeMeta(meta);

    // Load checkpoint
    const cpPath = path.join(this.tasksDir, id, "checkpoint.json");
    let checkpoint: Checkpoint | null = null;
    if (fs.existsSync(cpPath)) {
      checkpoint = JSON.parse(fs.readFileSync(cpPath, "utf-8")) as Checkpoint;
    }

    return { task: meta, checkpoint };
  }

  async remove(id: string): Promise<void> {
    const taskDir = path.join(this.tasksDir, id);
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  }

  private metaPath(id: string): string {
    return path.join(this.tasksDir, id, "meta.json");
  }

  private writeMeta(meta: TaskMeta): void {
    const dir = path.dirname(this.metaPath(meta.id));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.metaPath(meta.id), JSON.stringify(meta, null, 2), "utf-8");
  }
}