// @ts-nocheck

import { Obelisk } from "@obelisk-ai/core"
import { ReadTool } from "@obelisk-ai/core/tools"

const obelisk = Obelisk.make({})

obelisk.tool.add(ReadTool)

obelisk.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

obelisk.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

obelisk.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await obelisk.session.create({
  agent: "build",
})

obelisk.subscribe((event) => {
  console.log(event)
})

await obelisk.session.prompt({
  sessionID,
  text: "hey what is up",
})

await obelisk.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await obelisk.session.wait()

console.log(await obelisk.session.messages(sessionID))
