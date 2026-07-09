import { AgentV2 } from "@obelisk-ai/core/agent"
import { AISDK } from "@obelisk-ai/core/aisdk"
import { Catalog } from "@obelisk-ai/core/catalog"
import { CommandV2 } from "@obelisk-ai/core/command"
import { Credential } from "@obelisk-ai/core/credential"
import { AppNodeBuilder } from "@obelisk-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@obelisk-ai/core/effect/app-node-platform"
import { LayerNode } from "@obelisk-ai/core/effect/layer-node"
import { EventV2 } from "@obelisk-ai/core/event"
import { FileSystem } from "@obelisk-ai/core/filesystem"
import { FSUtil } from "@obelisk-ai/core/fs-util"
import { Integration } from "@obelisk-ai/core/integration"
import { Location } from "@obelisk-ai/core/location"
import { Npm } from "@obelisk-ai/core/npm"
import { PluginV2 } from "@obelisk-ai/core/plugin"
import { Reference } from "@obelisk-ai/core/reference"
import { SkillV2 } from "@obelisk-ai/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
