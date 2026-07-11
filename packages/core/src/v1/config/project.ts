export * as ConfigProjectV1 from "./project"

import { Schema } from "effect"

export const Info = Schema.Struct({
  name: Schema.optional(Schema.String).annotate({ description: "Project display name" }),
  root: Schema.optional(Schema.String).annotate({ description: "Project root directory, relative to the config file" }),
  localFirst: Schema.optional(Schema.Boolean).annotate({
    description: "Prefer local-only operation over remote/cloud services when both are available",
  }),
}).annotate({ identifier: "ProjectConfig" })
export type Info = Schema.Schema.Type<typeof Info>
