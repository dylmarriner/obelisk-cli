// These packages are optional runtime plugins, not installed by default.
// They're dynamically imported and the import failure is handled gracefully
// at runtime, so we only need enough typing to satisfy the call sites.
declare module "obelisk-gitlab-auth" {
  import type { Plugin } from "@obelisk-ai/plugin"
  export const gitlabAuthPlugin: Plugin
}

declare module "obelisk-poe-auth" {
  import type { Plugin } from "@obelisk-ai/plugin"
  export const PoeAuthPlugin: Plugin
}
