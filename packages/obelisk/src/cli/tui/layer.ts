import { run as runTui, type TuiInput } from "@obelisk-ai/tui"
import { Global } from "@obelisk-ai/core/global"
import { AppNodeBuilder } from "@obelisk-ai/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
