# Obelisk CLI — Implementation Roadmap

> Execution order, engineering tickets, POC spec, MVP definition, and build rules.
> Adjacent eval components live in `eval/` — see references below.

---

## 1. Implementation roadmap

### Phase 0: Repo evaluation

**Goal:** confirm fork base and inspect internals.

**Tasks:**
- Clone OpenCode, Qwen Code, Kilo Code
- Run all three locally
- Inspect CLI command registration, config format, tool/plugin system, model provider abstraction, session lifecycle, licensing

**Success criteria:** OpenCode runs from source. You know where to add commands, where model calls are made, where prompt assembly happens.

**Risk:** OpenCode internals may shift quickly — the project is active.

**Eval reference:** `eval/` contains working copies of all evaluated components (ast-grep, cocoindex, code-indexer, obelisk, serena, zoekt) for direct inspection.

---

### Phase 1: Minimal Obelisk fork

**Goal:** create a clean fork that still behaves like OpenCode.

**Tasks:**
- Rename package metadata
- Add `obelisk` binary
- Add `obelisk --version`
- Add `.obelisk/` local state directory
- Add `obelisk.config.jsonc`
- Preserve upstream OpenCode behavior
- Add `obelisk doctor`

**Success criteria:** `obelisk --version`, `obelisk doctor`, `obelisk run "explain this repo"` all work.

**Risk:** breaking upstream update compatibility.

---

### Phase 2: Config system

**Goal:** load project, user, and environment config predictably.

**Tasks:**
- Add config schema
- Add config resolution order
- Add validation
- Add env var support
- Add `obelisk config get`
- Add `obelisk config doctor`

**Config precedence:**
```txt
CLI flags
.env
project obelisk.config.jsonc
user ~/.config/obelisk/config.jsonc
defaults
```

**Success criteria:** `obelisk config get nexus.endpoint` returns `http://100.68.0.96:7777`.

---

### Phase 3: Remote Nexus memory client

**Goal:** connect to Raspberry Pi Nexus service over Tailscale.

**Tasks:**
- Implement `MemoryAdapter`
- Implement `RemoteNexusMemoryAdapter`
- Implement `LocalMemoryCache`
- Add health command
- Add test write/read command
- Add offline queue
- Add reconnect behavior

**Success criteria:** `obelisk nexus health`, `obelisk memory remember`, `obelisk memory recall`, `obelisk nexus verify-persistence` all work.

**Risk:** Nexus API may not match assumed endpoints. Build adapter so endpoint paths are configurable.

---

### Phase 4: Obelisk Core token/control

**Goal:** insert policy and token budgeting before model calls.

**Tasks:**
- Implement `TokenBudgetManager`
- Implement `PromptAssembler`
- Implement `PolicyEngine`
- Implement `SecretRedactor`
- Add `obelisk budget inspect`
- Add policy checks before shell/file actions
- Add prompt compaction

**Eval reference:** `eval/obelisk/` contains the Rust Obelisk token-optimizing engine. The TypeScript port lives in `packages/obelisk-core/`.

**Success criteria:** `obelisk budget inspect` and `obelisk policy test "read .env"` correctly report allow/deny.

**Risk:** too much policy friction. Do not make the CLI unbearable.

---

### Phase 5: Zoekt search

**Goal:** fast local repo search.

**Tasks:**
- Detect/install Zoekt binaries
- Add `ZoektSearchAdapter`
- Add `ZoektIndexerAdapter`
- Add index path
- Add `obelisk index`
- Add `obelisk search`

**Eval reference:** `eval/zoekt/` — Go source for Zoekt (fast trigram-based code search engine by Sourcegraph). Commands: `zoekt-index`, `zoekt-git-index`, `zoekt`, `zoekt-webserver`.

**Success criteria:** `obelisk index`, `obelisk search "UserService"`, `obelisk search --regex "await .*\\.save\\("` work.

**Risk:** index freshness. Add file watcher later.

---

### Phase 6: ast-grep structural search/refactor

**Goal:** safe structural search and codemods.

**Tasks:**
- Detect/install ast-grep
- Add `AstGrepAdapter`
- Add find command
- Add rewrite preview
- Add apply step
- Add approval requirement for large rewrites

**Eval reference:** `eval/ast-grep/` — Rust workspace with 9 crates. CLI binary at `crates/cli/`, Node NAPI bindings at `crates/napi/` for later deeper integration.

**Success criteria:** `obelisk ast find --lang ts --pattern "await $CALL($ARGS)"` and `obelisk ast rewrite --lang ts --pattern "var $A = $B" --rewrite "let $A = $B"` work with preview before apply.

---

### Phase 7: Serena MCP

**Goal:** semantic code navigation and symbol-aware changes.

**Tasks:**
- Add Serena MCP config
- Add MCP lifecycle manager
- Add semantic status command
- Add symbol/reference commands
- Route symbol tasks to Serena

**Eval reference:** `eval/serena/` — Python MCP server using language servers (LSP) for code intelligence across 40+ languages. Serves via MCP on port 9121.

**Success criteria:** `obelisk semantic status`, `obelisk semantic find-symbol UserService`, `obelisk semantic refs UserService.createUser` work.

---

### Phase 8: Unified orchestration

**Goal:** agent automatically chooses tools.

**Tasks:**
- Build task classifier
- Build routing policy
- Add context source ranking
- Add Obelisk context assembly
- Add memory save after task completion
- Add task history

**Success criteria:** `obelisk run "continue the auth work from last time"` uses Nexus, searches repo, builds plan, respects token budget, and saves task summary.

---

### Phase 9: Advanced workflows

**Goal:** make it powerful without making it feral.

**Tasks:**
- Add worktree isolation
- Add long-running task checkpoints
- Add background daemon mode
- Add plugin registry
- Add CocoIndex plugin (see `eval/cocoindex/`)
- Add multi-agent delegation
- Add Qwen Code delegated subagent option

**Eval reference:** `eval/cocoindex/` — Rust+Python incremental indexing framework for AI agents. Use as optional plugin when ready.

**Success criteria:** `obelisk run --worktree`, `obelisk task resume <task-id>`, `obelisk plugins list` work.

---

## 2. First 10 engineering tickets

### Ticket 1: Create fork

```bash
gh repo fork anomalyco/opencode --clone --fork-name obelisk-cli
cd obelisk-cli
```

**Done when:** repo builds from source.

### Ticket 2: Rename binary

Add `obelisk` binary while keeping temporary `opencode` compatibility.

**Done when:** `obelisk --version` and `obelisk doctor` work.

### Ticket 3: Add config loader

Create `packages/shared/src/Config.ts` supporting `obelisk.config.jsonc`, `.env`, `~/.config/obelisk/config.jsonc`.

**Done when:** `obelisk config get nexus.endpoint` returns `http://100.68.0.96:7777`.

### Ticket 4: Add Nexus command group

Create `apps/cli/src/commands/nexus.ts` with commands: `obelisk nexus health`, `obelisk nexus ping`, `obelisk nexus config get`, `obelisk nexus config set`.

**Done when:** static health command exists.

### Ticket 5: Implement HTTP client

Create `packages/adapters/memory/src/RemoteNexusMemoryAdapter.ts` with timeout, retries, bearer auth, JSON error handling, typed responses.

**Done when:** `obelisk nexus health` calls the real endpoint.

### Ticket 6: Add offline memory cache

Create `packages/adapters/memory/src/LocalMemoryCache.ts` using SQLite or JSONL.

**Done when:** failed writes queue locally.

### Ticket 7: Memory write/read POC

Commands: `obelisk memory remember "Obelisk Nexus test"` and `obelisk memory recall "Obelisk Nexus"`.

**Done when:** memory persists after CLI restart.

### Ticket 8: Add Obelisk budget command

Create `packages/obelisk-core/src/TokenBudgetManager.ts` and `apps/cli/src/commands/budget.ts`.

**Done when:** `obelisk budget inspect` shows current context/token estimates.

### Ticket 9: Add Zoekt adapter

Create `packages/adapters/search/src/ZoektSearchAdapter.ts`. Commands: `obelisk index`, `obelisk search "auth"`.

**Eval reference:** `eval/zoekt/` — Go source. Build binary from `cmd/zoekt/` and `cmd/zoekt-index/`.

**Done when:** local repo search works.

### Ticket 10: Add ast-grep adapter

Create `packages/adapters/structural/src/AstGrepAdapter.ts`. Commands: `obelisk ast find --lang ts --pattern "await $CALL($ARGS)"`.

**Eval reference:** `eval/ast-grep/` — Rust workspace. CLI binary at `crates/cli/`. Node NAPI bindings at `crates/napi/` for later.

**Done when:** structural search works.

---

## 3. First POC: Nexus over Tailscale

### POC script

Create `scripts/poc-nexus.ts`:

```ts
import { RemoteNexusMemoryAdapter } from "../packages/adapters/memory/src/RemoteNexusMemoryAdapter";
import { LocalMemoryCache } from "../packages/adapters/memory/src/LocalMemoryCache";

async function main() {
  const endpoint = process.env.NEXUS_ENDPOINT ?? "http://100.68.0.96:7777";
  const apiKey = process.env.NEXUS_API_KEY;

  if (!apiKey) {
    throw new Error("Missing NEXUS_API_KEY");
  }

  const offline = new LocalMemoryCache(".obelisk/cache/memory-outbox.sqlite");

  const nexus = new RemoteNexusMemoryAdapter(
    {
      endpoint,
      apiKeyEnv: "NEXUS_API_KEY",
      healthPath: "/health",
      timeoutMs: 5000,
      healthTimeoutMs: 1500,
      retries: 3,
      retryBackoffMs: [250, 750, 1500],
      offlineCachePath: ".obelisk/cache/memory-outbox.sqlite",
      syncOnReconnect: true
    },
    offline
  );

  console.log("Checking Nexus health...");
  const health = await nexus.health();
  console.log("Health:", health);

  console.log("Writing test memory...");
  const record = await nexus.remember({
    scope: "project",
    content: `Obelisk Nexus POC test ${new Date().toISOString()}`,
    tags: ["poc", "obelisk", "nexus"],
    source: "manual",
    sensitivity: "normal"
  });
  console.log("Written:", record.id);

  console.log("Reading memory back...");
  const fetched = await nexus.get(record.id);
  console.log("Fetched:", fetched);

  console.log("Searching memory...");
  const results = await nexus.recall({
    query: "Obelisk Nexus POC",
    tags: ["poc"],
    limit: 5
  });
  console.log("Search results:", results.length);

  if (!results.length) {
    throw new Error("Persistence verification failed");
  }

  console.log("POC passed.");
}

main().catch((err) => {
  console.error("POC failed:", err.message);
  process.exit(1);
});
```

### Run

```bash
export NEXUS_ENDPOINT=http://100.68.0.96:7777
export NEXUS_API_KEY="replace_me"

tailscale ping 100.68.0.96
curl -fsS http://100.68.0.96:7777/health

pnpm tsx scripts/poc-nexus.ts
```

### Failure test

```bash
export NEXUS_ENDPOINT=http://100.68.0.96:9999
pnpm tsx scripts/poc-nexus.ts
```

Expected behavior:
```txt
Nexus unavailable.
Memory write queued locally.
CLI exits cleanly.
No lost memory.
```

---

## 4. MVP definition

### MVP must include

```txt
obelisk init
obelisk doctor
obelisk nexus health
obelisk memory remember
obelisk memory recall
obelisk run
obelisk budget inspect
obelisk index
obelisk search
obelisk ast find
```

### MVP does not need

```txt
CocoIndex
multi-agent teams
daemon mode
plugin marketplace
automatic remote repo sync
complex embeddings
Qwen delegated subagents
```

Keep the first version lean. The graveyard of dev tools is full of "just one more architecture layer" tombstones.

---

## 5. Version plan

### v0.1.0

- OpenCode fork renamed
- Config system
- Nexus health/write/read
- Offline memory queue
- Basic Obelisk budget command

### v0.2.0

- Zoekt indexing/search
- Search result context packing
- Memory + search combined in agent sessions

### v0.3.0

- ast-grep structural find/rewrite preview
- Refactor safety approvals
- Task history saved to Nexus

### v0.4.0

- Serena MCP integration
- Symbol/reference routing
- Semantic command group

### v0.5.0

- Unified tool orchestration
- Obelisk policy before tool actions
- Model routing rules

### v0.6.0

- Worktree isolation
- Resumable tasks
- Better local cache
- Project memory compaction

### v0.7.0

- Plugin manifest support
- Optional CocoIndex plugin
- Optional Qwen Code delegated runtime

---

## 6. Hard engineering rules

1. **Do not put CocoIndex in core yet.**
2. **Do not fork Qwen Code unless OpenCode blocks you.**
3. **Do not store secrets in Nexus.**
4. **Do not send whole repos to memory by default.**
5. **Do not make Serena mandatory.**
6. **Do not make Zoekt a daemon requirement for MVP.**
7. **Do not let Obelisk become vague "AI governance" fluff. It must enforce concrete token and execution rules.**
8. **Every tool integration gets an adapter contract.**
9. **Every write operation gets preview/approval if dangerous.**
10. **Every session should end with a compact task summary saved to Nexus.**

---

## 7. Immediate build order

Start here:

```bash
mkdir -p ~/projects
cd ~/projects

gh repo fork anomalyco/opencode --clone --fork-name obelisk-cli
cd obelisk-cli

git checkout -b feat/obelisk-foundation
```

Then implement in this exact order:

```txt
1. Rename binary to obelisk
2. Add obelisk.config.jsonc
3. Add nexus config schema
4. Add obelisk nexus health
5. Add RemoteNexusMemoryAdapter
6. Add memory remember/recall
7. Add offline queue
8. Add budget inspect
9. Add zoekt index/search (eval/zoekt/)
10. Add ast-grep find (eval/ast-grep/)
```

That gets you a working, differentiated CLI fast. Not a dream board. Not a 900-page "agent operating system" manifesto. A real tool with a spine.

---

## 8. Eval component reference

All evaluated tool repositories live under `eval/` for direct inspection and building:

| Component   | Path                     | Language | Build command                  |
| ----------- | ------------------------ | -------- | ------------------------------ |
| ast-grep    | `eval/ast-grep/`         | Rust     | `cargo build` in workspace     |
| CocoIndex   | `eval/cocoindex/`        | Rust/Py  | `cargo build` in `rust/`       |
| Obelisk     | `eval/obelisk/`          | Rust     | `cargo build`                  |
| Serena      | `eval/serena/`           | Python   | `uv run serena`                |
| Zoekt       | `eval/zoekt/`            | Go       | `go build ./cmd/zoekt/`        |
| Code Indexer| `eval/code-indexer/`     | Python   | `pip install -e .`             |

Each contains the full source, build system, and documentation for integration into the Obelisk CLI.