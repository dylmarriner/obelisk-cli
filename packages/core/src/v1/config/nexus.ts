export * as ConfigNexusV1 from "./nexus"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../../schema"

export const CircuitBreaker = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  failureThreshold: Schema.optional(PositiveInt),
  cooldownMs: Schema.optional(NonNegativeInt),
}).annotate({ identifier: "NexusCircuitBreakerConfig" })
export type CircuitBreaker = Schema.Schema.Type<typeof CircuitBreaker>

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable the Nexus durable-memory integration" }),
  endpoint: Schema.optional(Schema.String).annotate({ description: "Nexus server base URL" }),
  transport: Schema.optional(Schema.Literals(["http", "tailscale"])).annotate({
    description: "Transport used to reach the Nexus server",
  }),
  apiKeyEnv: Schema.optional(Schema.String).annotate({
    description: "Environment variable holding the Nexus API key/bearer token",
  }),
  healthPath: Schema.optional(Schema.String).annotate({ description: "Health-check path on the Nexus server" }),
  timeoutMs: Schema.optional(PositiveInt).annotate({ description: "Request timeout in milliseconds" }),
  healthTimeoutMs: Schema.optional(PositiveInt).annotate({ description: "Health-check timeout in milliseconds" }),
  retries: Schema.optional(NonNegativeInt).annotate({ description: "Number of retry attempts for failed requests" }),
  retryBackoffMs: Schema.optional(Schema.mutable(Schema.Array(NonNegativeInt))).annotate({
    description: "Backoff delays (ms) between retry attempts",
  }),
  offlineCachePath: Schema.optional(Schema.String).annotate({
    description: "Local cache path used to queue writes while Nexus is unreachable",
  }),
  syncOnReconnect: Schema.optional(Schema.Boolean).annotate({
    description: "Flush the offline cache to Nexus once connectivity is restored",
  }),
  circuitBreaker: Schema.optional(CircuitBreaker),
}).annotate({ identifier: "NexusConfig" })
export type Info = Schema.Schema.Type<typeof Info>
