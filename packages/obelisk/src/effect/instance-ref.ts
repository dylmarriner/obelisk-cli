import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@obelisk-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~obelisk/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~obelisk/WorkspaceRef", {
  defaultValue: () => undefined,
})
