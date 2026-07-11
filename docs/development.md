# Development Guide

## Repository map

Obelisk is a Bun workspace managed by Turborepo.

| Area | Responsibility |
| --- | --- |
| `packages/obelisk` | CLI, TUI entrypoints, server commands, and packaging |
| `packages/core` | Runtime, sessions, configuration, tools, and persistence |
| `packages/obelisk-core` | Token budgets, policy evaluation, prompt assembly, and optimization |
| `packages/tui` | OpenTUI components, routes, themes, and terminal interactions |
| `packages/ui` | Shared web and desktop components, tokens, and themes |
| `packages/app` | User-facing web application |
| `packages/console` | Operations and account dashboard |
| `packages/desktop` | Electron desktop shell |
| `packages/server` | HTTP API and server composition |
| `packages/schema`, `packages/protocol`, `packages/sdk` | Shared contracts and generated clients |
| `packages/memory`, `packages/search`, `packages/semantic`, `packages/structural` | Obelisk integrations |
| `eval/` | Evaluated Rust and external components |
| `specs/` and `docs/` | Durable contracts, architecture, and operating guidance |

## Local setup

```bash
git clone https://github.com/dylmarriner/obelisk-cli.git
cd obelisk-cli
bun install --frozen-lockfile
bun run typecheck
bun run lint
```

Use `bun run dev`, `bun run dev:web`, `bun run dev:desktop`, or `bun run dev:console` for the surface you are changing.

## Change discipline

- Keep changes scoped to the owning package and update its tests and documentation.
- Treat `packages/schema`, `packages/protocol`, and generated clients as public contracts.
- Never commit credentials, local paths, generated secrets, build output, or machine-specific configuration.
- Prefer existing aliases, effects, adapters, and theme tokens over new parallel abstractions.
- Add a regression test for a bug before changing behavior when practical.

## Validation matrix

| Change | Minimum validation |
| --- | --- |
| TypeScript package | Package typecheck and focused tests |
| Shared contract or generated client | Contract tests and generated-file check |
| CLI/TUI | Package typecheck, focused tests, and `packages/obelisk` build smoke test |
| Web or desktop UI | UI typecheck, build, and relevant browser or component tests |
| Rust engine | `cargo fmt --check`, `cargo clippy`, and `cargo test` |
| Workflow or action | YAML parse, action pin review, least-privilege review, and a dry-run where possible |

## Commit and pull requests

Use Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, and so on). A pull request should explain the user impact, implementation boundary, validation performed, rollout or migration risk, and any follow-up work. Keep unrelated cleanup out of feature pull requests.

