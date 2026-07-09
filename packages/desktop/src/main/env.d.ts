interface ImportMetaEnv {
  readonly OBELISK_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:obelisk-server" {
  export namespace Server {
    export const listen: typeof import("../../../obelisk/dist/types/src/node").Server.listen
    export type Listener = import("../../../obelisk/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../obelisk/dist/types/src/node").Config.get
    export type Info = import("../../../obelisk/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../obelisk/dist/types/src/node").bootstrap
}
