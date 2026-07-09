/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-obelisk.md" with { type: "text" }

export const CustomizeOpencodeContent = customizeOpencodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-obelisk",
            description:
              "Use ONLY when the user is editing or creating obelisk's own configuration: obelisk.json, obelisk.jsonc, files under .obelisk/, or files under ~/.config/obelisk/. Also use when creating or fixing obelisk agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring obelisk itself.",
            location: AbsolutePath.make("/builtin/customize-obelisk.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
    })
  }),
})
