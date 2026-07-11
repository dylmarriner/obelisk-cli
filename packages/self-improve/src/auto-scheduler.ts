/**
 * AutoScheduler — runs self-improvement cycles in the background, on a
 * timer, with no human invocation required, once opted in via
 * `obelisk self-improve enable`.
 *
 * Safety model: this is opt-in per repo (checks a persisted flag file, not
 * a global default), only ever creates a branch + PR (never touches the
 * checked-out branch or pushes to main directly — see
 * SelfImprovementEngine.createPR), and every failure is caught so a bad
 * cycle can never crash the host CLI process.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { SelfImprovementEngine } from "./self-improvement-engine";

const STATE_DIR = ".obelisk";
const ENABLED_FILE = "self-improve-enabled";
const LAST_RUN_FILE = "self-improve-last-run";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes between checks
const MIN_GAP_MS = 60 * 60 * 1000; // don't run a cycle more than once per hour

function statePath(baseDir: string, file: string): string {
  return path.join(baseDir, STATE_DIR, file);
}

export function isEnabled(baseDir: string = process.cwd()): boolean {
  return fs.existsSync(statePath(baseDir, ENABLED_FILE));
}

export function enable(baseDir: string = process.cwd()): void {
  const dir = path.join(baseDir, STATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(baseDir, ENABLED_FILE), new Date().toISOString(), "utf-8");
}

export function disable(baseDir: string = process.cwd()): void {
  const file = statePath(baseDir, ENABLED_FILE);
  if (fs.existsSync(file)) fs.rmSync(file);
}

function lastRun(baseDir: string): number {
  try {
    return parseInt(fs.readFileSync(statePath(baseDir, LAST_RUN_FILE), "utf-8"), 10) || 0;
  } catch {
    return 0;
  }
}

function markRun(baseDir: string): void {
  try {
    fs.writeFileSync(statePath(baseDir, LAST_RUN_FILE), String(Date.now()), "utf-8");
  } catch {
    // non-critical
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Start the background scheduler for this process. Idempotent — calling
 * more than once is a no-op. Each tick checks whether self-improvement is
 * enabled for the current directory and enough time has passed since the
 * last cycle; if so, it runs one full cycle (scan, auto-apply, PR) and
 * swallows any error so the host process is never affected.
 */
export function start(options: { baseDir?: string; intervalMs?: number } = {}): void {
  if (timer) return;
  const baseDir = options.baseDir || process.cwd();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  timer = setInterval(() => {
    tick(baseDir).catch(() => {});
  }, intervalMs);
  // Don't keep the process alive just for this timer.
  timer.unref?.();
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

async function tick(baseDir: string): Promise<void> {
  if (!isEnabled(baseDir)) return;
  if (Date.now() - lastRun(baseDir) < MIN_GAP_MS) return;

  markRun(baseDir);
  try {
    const engine = new SelfImprovementEngine(baseDir);
    await engine.runCycle({ autoApply: true, createPR: true });
  } catch {
    // A failed background cycle must never surface to the user mid-session.
  }
}

export const AutoScheduler = { isEnabled, enable, disable, start, stop };
