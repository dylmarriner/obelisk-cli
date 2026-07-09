import { existsSync } from "fs"
import path from "path"
import { spawn } from "@/util/process"

const ENGINE_MANIFEST = findEngineManifest()
const ENGINE_BINARY = path.join(path.dirname(ENGINE_MANIFEST), "target", "release", process.platform === "win32" ? "obelisk.exe" : "obelisk")

export function engineArgs() {
  const argv = process.argv.slice(2)
  const index = argv.findIndex((arg) => arg === "engine" || arg === "eval")
  if (index === -1) return []
  return argv.slice(index + 1).filter((arg) => arg !== "--")
}

export async function runRustEngine(args: string[]) {
  const command = existsSync(ENGINE_BINARY)
    ? [ENGINE_BINARY, ...args]
    : ["cargo", "run", "--quiet", "--manifest-path", ENGINE_MANIFEST, "--", ...args]

  const child = spawn(command, {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  return child.exited
}

function findEngineManifest() {
  const start = [process.cwd(), path.dirname(process.argv[1] ?? process.cwd())]
  for (const root of start.flatMap((entry) => ancestors(entry))) {
    const manifest = path.join(root, "eval", "obelisk", "Cargo.toml")
    if (existsSync(manifest)) return manifest
  }
  return path.resolve(process.cwd(), "eval", "obelisk", "Cargo.toml")
}

function ancestors(start: string) {
  const dirs = [start]
  let current = path.resolve(start)
  while (true) {
    const parent = path.dirname(current)
    if (parent === current) return dirs
    dirs.push(parent)
    current = parent
  }
}
