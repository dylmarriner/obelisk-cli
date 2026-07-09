import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { engineArgs, runRustEngine } from "@/engine/rust"

export const EngineCommand = cmd({
  command: "engine [args..]",
  aliases: ["eval"],
  describe: "run the Rust Obelisk engine from eval/obelisk",
  builder: (yargs: Argv) =>
    yargs
      .parserConfiguration({
        "populate--": true,
        "unknown-options-as-args": true,
      })
      .positional("args", {
        type: "string",
        array: true,
        default: [],
        describe: "arguments forwarded to eval/obelisk",
      }),
  handler: async () => {
    const args = engineArgs()
    process.exitCode = await runRustEngine(args.length > 0 ? args : ["--help"])
  },
})
