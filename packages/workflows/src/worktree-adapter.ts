/**
 * WorktreeAdapter — manages isolated git worktrees for parallel task execution.
 *
 * Wraps git worktree operations to create isolated copies of the repository
 * for safe parallel task execution without affecting the main working tree.
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(cp.execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  isBare: boolean;
  isDetached: boolean;
}

export interface WorktreeCreateRequest {
  branch: string;
  targetDir: string;
  baseBranch?: string;
}

export interface WorktreeManager {
  list(): Promise<WorktreeInfo[]>;
  create(input: WorktreeCreateRequest): Promise<WorktreeInfo>;
  remove(path: string): Promise<void>;
  prune(): Promise<void>;
  available(): Promise<boolean>;
}

export class GitWorktreeManager implements WorktreeManager {
  private repoPath: string;

  constructor(repoPath?: string) {
    this.repoPath = repoPath || process.cwd();
  }

  async list(): Promise<WorktreeInfo[]> {
    const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
      cwd: this.repoPath,
      timeout: 10000,
    });

    return this.parseWorktreeList(stdout);
  }

  async create(input: WorktreeCreateRequest): Promise<WorktreeInfo> {
    const args: string[] = ["worktree", "add"];

    // Target directory
    args.push(input.targetDir);

    // Branch to create
    if (input.baseBranch) {
      args.push(input.branch);
      // Optional: base branch to fork from
    } else {
      args.push("-b", input.branch);
    }

    // Base branch if specified
    if (input.baseBranch) {
      args.push(input.baseBranch);
    }

    await execFile("git", args, {
      cwd: this.repoPath,
      timeout: 30000,
    });

    // Get the worktree info
    const infos = await this.list();
    const info = infos.find((w) => w.path === path.resolve(input.targetDir));
    if (!info) throw new Error(`Worktree created but not found at ${input.targetDir}`);

    return info;
  }

  async remove(worktreePath: string): Promise<void> {
    await execFile("git", ["worktree", "remove", worktreePath], {
      cwd: this.repoPath,
      timeout: 15000,
    });
  }

  async prune(): Promise<void> {
    await execFile("git", ["worktree", "prune"], {
      cwd: this.repoPath,
      timeout: 10000,
    });
  }

  async available(): Promise<boolean> {
    try {
      await execFile("git", ["--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const blocks = output.trim().split("\n\n");

    for (const block of blocks) {
      const lines = block.split("\n");
      const info: Partial<WorktreeInfo> = {};

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          info.path = line.slice(9);
        } else if (line.startsWith("HEAD ")) {
          info.commit = line.slice(5);
        } else if (line.startsWith("branch ")) {
          info.branch = line.slice(7).replace("refs/heads/", "");
        } else if (line === "bare") {
          info.isBare = true;
        } else if (line === "detached") {
          info.isDetached = true;
        }
      }

      if (info.path) {
        worktrees.push({
          path: info.path,
          branch: info.branch || "(detached)",
          commit: info.commit || "",
          isBare: info.isBare || false,
          isDetached: info.isDetached || false,
        });
      }
    }

    return worktrees;
  }
}