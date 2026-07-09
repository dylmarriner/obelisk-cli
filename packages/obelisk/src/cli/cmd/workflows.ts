import { EOL } from "os"
import { Effect, Console } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { GitWorktreeManager, LocalTaskManager } from "@obelisk-ai/workflows"

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "manage isolated git worktrees for safe parallel tasks",
  builder: (yargs: Argv) =>
    yargs
      .command(WorktreeListCommand)
      .command(WorktreeCreateCommand)
      .command(WorktreeRemoveCommand)
      .demandCommand(),
  async handler() {},
})

const WorktreeListCommand = effectCmd({
  command: "list",
  describe: "list all git worktrees",
  instance: false,
  handler: Effect.fn("Cli.worktree.list")(function* () {
    const mgr = new GitWorktreeManager()

    Console.log("")
    Console.log("  Git Worktrees")
    Console.log("  " + "─".repeat(40))
    Console.log("")

    try {
      const worktrees = yield* Effect.promise(() => mgr.list())

      if (worktrees.length === 0) {
        Console.log("  No worktrees found.")
        Console.log("")
        return
      }

      for (const wt of worktrees) {
        const branch = wt.isDetached ? "(detached)" : wt.branch
        const bare = wt.isBare ? " [bare]" : ""
        console.log(`    ${wt.path}`)
        console.log(`    Branch: ${branch}${bare}  Commit: ${wt.commit.substring(0, 12)}`)
        console.log("")
      }
    } catch (err) {
      Console.log(`  ✗ Failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const WorktreeCreateCommand = effectCmd({
  command: "create <branch> <dir>",
  describe: "create a new worktree for isolated task execution",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("branch", { type: "string", describe: "branch name for the worktree" })
      .positional("dir", { type: "string", describe: "directory for the worktree" })
      .option("base", { type: "string", describe: "base branch to fork from" }),
  handler: Effect.fn("Cli.worktree.create")(function* (args) {
    const mgr = new GitWorktreeManager()

    Console.log("")
    Console.log(`  Creating worktree "${args.branch}" at ${args.dir}...`)
    Console.log("")

    try {
      const wt = yield* Effect.promise(() =>
        mgr.create({ branch: args.branch, targetDir: args.dir, baseBranch: args.base })
      )
      Console.log(`  ✓ Worktree created at ${wt.path}`)
      Console.log(`    Branch: ${wt.branch}`)
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const WorktreeRemoveCommand = effectCmd({
  command: "remove <path>",
  describe: "remove a worktree",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("path", { type: "string", describe: "path to the worktree to remove" }),
  handler: Effect.fn("Cli.worktree.remove")(function* (args) {
    const mgr = new GitWorktreeManager()

    Console.log("")
    try {
      yield* Effect.promise(() => mgr.remove(args.path))
      Console.log(`  ✓ Worktree removed: ${args.path}`)
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

export const TaskCommand = cmd({
  command: "task",
  describe: "manage long-running tasks with checkpoint/resume",
  builder: (yargs: Argv) =>
    yargs
      .command(TaskListCommand)
      .command(TaskStatusCommand)
      .command(TaskResumeCommand)
      .command(TaskCheckpointCommand)
      .command(TaskRemoveCommand)
      .demandCommand(),
  async handler() {},
})

const TaskListCommand = effectCmd({
  command: "list",
  describe: "list all tracked tasks",
  instance: false,
  handler: Effect.fn("Cli.task.list")(function* () {
    const mgr = new LocalTaskManager()

    Console.log("")
    Console.log("  Tasks")
    Console.log("  " + "─".repeat(40))
    Console.log("")

    const tasks = yield* Effect.promise(() => mgr.list())

    if (tasks.length === 0) {
      Console.log("  No tasks found.")
      Console.log("")
      return
    }

    for (const t of tasks) {
      const statusIcon =
        t.status === "completed" ? "✓" :
        t.status === "running" ? "▶" :
        t.status === "failed" ? "✗" :
        t.status === "paused" ? "⏸" : "?"
      console.log(`    ${statusIcon}  ${t.id}`)
      console.log(`    Goal: ${t.goal.substring(0, 80)}`)
      console.log(`    Status: ${t.status}  Steps: ${t.currentStep}/${t.steps}`)
      console.log(`    Created: ${new Date(t.createdAt).toLocaleString()}`)
      console.log("")
    }
  }),
})

const TaskStatusCommand = effectCmd({
  command: "status <id>",
  describe: "show task status and details",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("id", { type: "string", describe: "task ID" }),
  handler: Effect.fn("Cli.task.status")(function* (args) {
    const mgr = new LocalTaskManager()
    const task = yield* Effect.promise(() => mgr.get(args.id))

    if (!task) {
      Console.log(`  Task not found: ${args.id}`)
      return
    }

    Console.log("")
    Console.log(`  Task: ${task.id}`)
    Console.log("  " + "─".repeat(40))
    Console.log(`  Goal:     ${task.goal}`)
    Console.log(`  Status:   ${task.status}`)
    Console.log(`  Model:    ${task.model}`)
    console.log(`  Steps:    ${task.currentStep}/${task.steps}`)
    console.log(`  Files:    ${task.filesTouched.length}`)
    if (task.worktree) console.log(`  Worktree: ${task.worktree}`)
    console.log(`  Created:  ${new Date(task.createdAt).toLocaleString()}`)
    console.log(`  Updated:  ${new Date(task.updatedAt).toLocaleString()}`)
    console.log("")
  }),
})

const TaskResumeCommand = effectCmd({
  command: "resume <id>",
  describe: "resume a paused or incomplete task",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("id", { type: "string", describe: "task ID to resume" }),
  handler: Effect.fn("Cli.task.resume")(function* (args) {
    const mgr = new LocalTaskManager()

    Console.log("")
    try {
      const { task, checkpoint } = yield* Effect.promise(() => mgr.resume(args.id))
      Console.log(`  ✓ Resumed task: ${task.id}`)
      Console.log(`    Goal: ${task.goal}`)
      if (checkpoint) {
        console.log(`    Checkpoint: step ${checkpoint.step} — ${checkpoint.description}`)
        console.log(`    Saved at: ${new Date(checkpoint.timestamp).toLocaleString()}`)
      }
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const TaskCheckpointCommand = effectCmd({
  command: "checkpoint <id> <description>",
  describe: "save a checkpoint for a task",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("id", { type: "string", describe: "task ID" })
      .positional("description", { type: "string", describe: "checkpoint description" }),
  handler: Effect.fn("Cli.task.checkpoint")(function* (args) {
    const mgr = new LocalTaskManager()

    Console.log("")
    try {
      const cp = yield* Effect.promise(() => mgr.checkpoint(args.id, args.description))
      Console.log(`  ✓ Checkpoint saved at step ${cp.step}`)
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})

const TaskRemoveCommand = effectCmd({
  command: "remove <id>",
  describe: "remove a task record",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("id", { type: "string", describe: "task ID to remove" }),
  handler: Effect.fn("Cli.task.remove")(function* (args) {
    const mgr = new LocalTaskManager()

    Console.log("")
    try {
      yield* Effect.promise(() => mgr.remove(args.id))
      Console.log(`  ✓ Task removed: ${args.id}`)
      Console.log("")
    } catch (err) {
      Console.log(`  ✗ Failed: ${(err as Error).message}`)
      Console.log("")
    }
  }),
})