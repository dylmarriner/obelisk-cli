import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OBELISK_CHANNEL ?? "dev"}`

await $`cd ../obelisk && bun script/build-node.ts`
