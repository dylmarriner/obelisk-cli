# Obelisk CLI — API Specification

## Project Model

Obelisk runs sessions for multiple projects and different worktrees per project. Each project is identified by a unique `projectID` and associated with a local directory.

### Endpoints

#### Project Management

```
GET  /project                          -> Project[]
POST /project/init                     -> Project
```

Returns all projects or initializes a new one.

#### Session Management

```
GET    /project/:projectID/session                      -> Session[]
GET    /project/:projectID/session/:sessionID            -> Session
POST   /project/:projectID/session                       -> Session
DELETE /project/:projectID/session/:sessionID

POST   /project/:projectID/session/:sessionID/init
POST   /project/:projectID/session/:sessionID/abort
POST   /project/:projectID/session/:sessionID/share
DELETE /project/:projectID/session/:sessionID/share
POST   /project/:projectID/session/:sessionID/compact
POST   /project/:projectID/session/:sessionID/revert
POST   /project/:projectID/session/:sessionID/unrevert
POST   /project/:projectID/session/:sessionID/permission/:permissionID
```

Create session body:

```json
{
  "id": "optional-session-id",
  "parentID": "optional-parent-session-id",
  "directory": "/path/to/project"
}
```

#### Messages

```
GET  /project/:projectID/session/:sessionID/message
                              -> { info: Message, parts: Part[] }[]
GET  /project/:projectID/session/:sessionID/message/:messageID
                              -> { info: Message, parts: Part[] }
POST /project/:projectID/session/:sessionID/message
                              -> { info: Message, parts: Part[] }
```

#### File Operations

```
GET /project/:projectID/session/:sessionID/find/file  -> string[]
GET /project/:projectID/session/:sessionID/file        -> { type: "raw" | "patch", content: string }
GET /project/:projectID/session/:sessionID/file/status -> File[]
```

#### Provider and Config

```
GET /provider?directory=<path>  -> Provider
GET /config?directory=<path>    -> Config
```

#### Agents

```
GET /project/:projectID/agent?directory=<path>  -> Agent
GET /project/:projectID/find/file?directory=<path>  -> File
```

#### Logging

```
POST /log
```

---

## Session Runtime Specification

### Language

**System Context**: The structured collection of contextual facts presented to the model as initial instructions and chronological updates.

**Session History**: The projected chronological conversation selected for a provider turn after applying the active compaction and Context Epoch cutoffs.

**Context Source**: One independently observed typed value within the System Context, represented by a stable key, JSON codec, infallible loader, and pure baseline/update renderers.

**System Context Registry**: The Location-scoped registry of ordered producers that contribute to the current System Context.

**Context Epoch**: The span during which one initially rendered System Context remains the immutable provider-cache baseline, ending at completed compaction, Session movement, or an incompatible context transition.

**Mid-Conversation System Message**: A durable chronological instruction that tells the model the newly effective state of a changed Context Source.

**Provider Turn**: One request to a model provider and the response projected from that request.

**Session Drain**: One process-local execution span that promotes eligible input and runs required Provider Turns until no immediate continuation remains.

### State Machine

```
[Idle] --prompt--> [Draining] --settled--> [Idle]
                     |
                     +--interrupt--> [Idle]
```

### Key Rules

1. Context changes are sampled lazily at Safe Provider-Turn Boundaries, never pushed asynchronously
2. Compaction starts a new Context Epoch with a freshly rendered baseline
3. Moving a Session clears its active Context Epoch
4. Mid-Conversation System Messages remain durable even after failed provider attempts
5. The first provider turn renders the latest complete baseline without emitting a redundant update

---

## TUI Package Specification

### Architecture

The TUI package (`packages/tui/`) provides the terminal user interface for the CLI. It is an extracted standalone package with a defined public API surface.

### Design Principles

- SDK wire data is treated as the source of truth for Obelisk domain state
- Unknown tools and plugin data render safely without backend type imports
- Remote-server use remains possible; the TUI must not require an in-process backend implementation
- The TUI package does not import from `@/`, `@obelisk-ai/core`, or either executable package

### Key Components

- **Renderer**: Terminal rendering engine
- **Command System**: Input parsing and command dispatch
- **Session UI**: Session timeline, input, and output display
- **Theme System**: Customizable themes and color schemes
- **Plugin Integration**: Plugin hooks and lifecycle management

### Package Checks

```bash
cd packages/tui && bun typecheck
cd packages/tui && bun test
cd packages/obelisk && bun typecheck
cd packages/cli && bun typecheck
```

### Dependency Rules

```bash
# No imports from core or executable packages
rg "from ['\"]@/" packages/tui/src
rg '@obelisk-ai/core|packages/obelisk|packages/cli' packages/tui
```