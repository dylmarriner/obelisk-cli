import { EOL } from "os"
import { Schema } from "effect"
import { logo as glyphs } from "./logo"

const wordmark = [
  `┌──────────────────────────────────────────┐`,
  `│             O B E L I S K                │`,
  `│      the obsidian command interface      │`,
  `└──────────────────────────────────────────┘`,
]

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("UICancelledError", {}) {}

// Truecolor escapes matching the Obelisk theme ("Firelight on Obsidian",
// see packages/tui/src/theme/assets/obelisk.json) — plain CLI command
// output (doctor, budget, policy, etc.) doesn't go through the TUI theme
// context, so these mirror the same palette directly.
const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`
export const Style = {
  TEXT_HIGHLIGHT: rgb(0xe3, 0xa8, 0x39), // primary — molten gold
  TEXT_HIGHLIGHT_BOLD: rgb(0xe3, 0xa8, 0x39) + "\x1b[1m",
  TEXT_DIM: rgb(0xa5, 0x91, 0x7c), // textMuted — warm ash
  TEXT_DIM_BOLD: rgb(0xa5, 0x91, 0x7c) + "\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: rgb(0xf4, 0x82, 0x3f), // warning — ember
  TEXT_WARNING_BOLD: rgb(0xf4, 0x82, 0x3f) + "\x1b[1m",
  TEXT_DANGER: rgb(0xe1, 0x4b, 0x57), // error — crimson
  TEXT_DANGER_BOLD: rgb(0xe1, 0x4b, 0x57) + "\x1b[1m",
  TEXT_SUCCESS: rgb(0x55, 0xc7, 0x9b), // success — malachite
  TEXT_SUCCESS_BOLD: rgb(0x55, 0xc7, 0x9b) + "\x1b[1m",
  TEXT_INFO: rgb(0x5a, 0x9f, 0xd6), // info — lapis lazuli
  TEXT_INFO_BOLD: rgb(0x5a, 0x9f, 0xd6) + "\x1b[1m",
}

export function println(...message: string[]) {
  print(...message)
  process.stderr.write(EOL)
}

export function print(...message: string[]) {
  blank = false
  process.stderr.write(message.join(" "))
}

let blank = false
export function empty() {
  if (blank) return
  println("" + Style.TEXT_NORMAL)
  blank = true
}

export function logo(pad?: string) {
  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    const result = []
    for (const row of wordmark) {
      if (pad) result.push(pad)
      result.push(row)
      result.push(EOL)
    }
    return result.join("").trimEnd()
  }

  const result: string[] = []
  const reset = "\x1b[0m"
  // Shadowed stone face on the left, gilded lit face on the right — the
  // monolith catching firelight in Obelisk's signature gold (#e3a839).
  // Truecolor is assumed (the TUI renders truecolor RGBA throughout).
  const left = {
    fg: "\x1b[38;2;122;109;89m",
    shadow: "\x1b[38;2;54;45;39m",
    bg: "\x1b[48;2;54;45;39m",
  }
  const right = {
    fg: "\x1b[1m\x1b[38;2;227;168;57m",
    shadow: "\x1b[38;2;120;90;35m",
    bg: "\x1b[48;2;60;46;22m",
  }
  const gap = " "
  const draw = (line: string, fg: string, shadow: string, bg: string) => {
    const parts: string[] = []
    for (const char of line) {
      if (char === "_") {
        parts.push(bg, " ", reset)
        continue
      }
      if (char === "^") {
        parts.push(fg, bg, "▀", reset)
        continue
      }
      if (char === "~") {
        parts.push(shadow, "▀", reset)
        continue
      }
      if (char === " ") {
        parts.push(" ")
        continue
      }
      parts.push(fg, char, reset)
    }
    return parts.join("")
  }
  glyphs.left.forEach((row, index) => {
    if (pad) result.push(pad)
    result.push(draw(row, left.fg, left.shadow, left.bg))
    result.push(gap)
    const other = glyphs.right[index] ?? ""
    result.push(draw(other, right.fg, right.shadow, right.bg))
    result.push(EOL)
  })
  return result.join("").trimEnd()
}

export async function input(prompt: string): Promise<string> {
  const readline = require("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function error(message: string) {
  if (message.startsWith("Error: ")) {
    message = message.slice("Error: ".length)
  }
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
}

export function markdown(text: string): string {
  return text
}

export * as UI from "./ui"
