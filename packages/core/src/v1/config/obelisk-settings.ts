export * as ConfigObeliskSettingsV1 from "./obelisk-settings"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../../schema"

export const TokenControl = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  maxInputTokens: Schema.optional(PositiveInt),
  reserveOutputTokens: Schema.optional(NonNegativeInt),
  maxToolResultTokens: Schema.optional(NonNegativeInt),
  contextPolicy: Schema.optional(Schema.Literals(["compact-first", "warn-only", "strict-truncate"])),
}).annotate({ identifier: "ObeliskTokenControlConfig" })
export type TokenControl = Schema.Schema.Type<typeof TokenControl>

export const Policy = Schema.Struct({
  denySecretFiles: Schema.optional(Schema.Boolean),
  requireApprovalForDangerousCommands: Schema.optional(Schema.Boolean),
  blockEnvFileUpload: Schema.optional(Schema.Boolean),
  blockPrivateKeyUpload: Schema.optional(Schema.Boolean),
  allowFilesystemWrites: Schema.optional(Schema.Boolean),
  allowShellCommands: Schema.optional(Schema.Literals(["always", "approval-required", "never"])),
}).annotate({ identifier: "ObeliskPolicyConfig" })
export type Policy = Schema.Schema.Type<typeof Policy>

// Per-integration tool config (distinct from the top-level `tools` enable-map):
// each entry describes how to run/reach a specific analysis tool integration.
export const ToolIntegration = Schema.StructWithRest(
  Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
    mode: Schema.optional(Schema.Literals(["subprocess", "mcp", "plugin"])),
    binary: Schema.optional(Schema.String),
    command: Schema.optional(Schema.String),
    args: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    indexPath: Schema.optional(Schema.String),
    autoIndex: Schema.optional(Schema.Boolean),
    purpose: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
).annotate({ identifier: "ObeliskToolIntegrationConfig" })
export type ToolIntegration = Schema.Schema.Type<typeof ToolIntegration>

export const ModelProvider = Schema.Struct({
  apiKeyEnv: Schema.optional(Schema.String),
  baseUrl: Schema.optional(Schema.String),
}).annotate({ identifier: "ObeliskModelProviderConfig" })
export type ModelProvider = Schema.Schema.Type<typeof ModelProvider>

export const Models = Schema.Struct({
  default: Schema.optional(Schema.String),
  fast: Schema.optional(Schema.String),
  cheap: Schema.optional(Schema.String),
  local: Schema.optional(Schema.String),
  providers: Schema.optional(Schema.Record(Schema.String, ModelProvider)),
}).annotate({ identifier: "ObeliskModelsConfig" })
export type Models = Schema.Schema.Type<typeof Models>

export const Info = Schema.Struct({
  tokenControl: Schema.optional(TokenControl),
  policy: Schema.optional(Policy),
}).annotate({ identifier: "ObeliskSettingsConfig" })
export type Info = Schema.Schema.Type<typeof Info>
