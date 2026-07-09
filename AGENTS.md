# Obelisk CLI — Agent Instructions

This file provides AI coding agents with the context needed to work effectively on this repository.

## Project Overview

Obelisk CLI is a unified local-first AI coding agent CLI. It is built on a fork of [OpenCode](https://github.com/anomalyco/opencode) and integrates remote memory (Nexus), code search (Zoekt), semantic code intelligence (Serena), structural refactoring (ast-grep), and token/policy control (Obelisk Core).

**Key facts:**
- Package manager: `bun` (>= 1.3)
- Language: TypeScript (strict mode)
- Build system: Turborepo
- Engine: Rust (eval/obelisk) for token optimization
- Monorepo with workspaces in `packages/*`

## Quick Start

```bash
bun install
bun run typecheck
bun run lint
bun run dev
```

## Project Structure

```
obelisk-cli/
  apps/cli/           # CLI binary and commands
  apps/desktop/       # Desktop application
  apps/console/       # Web console
  packages/core/      # Agent runtime, orchestrator
  packages/obelisk-core/   # Token/policy engine
  packages/adapters/       # External tool integrations
  packages/plugins/        # Plugin system
  packages/security/       # Security policies
  packages/shared/         # Shared utilities
  packages/web/           # Documentation site
  packages/app/           # Web application
  eval/                   # Evaluated components
  docs/                   # Architecture docs
  specs/                  # Specifications
```

## Key Commands

| Command | Purpose |
|---------|---------|
| `bun run dev` | Start development server |
| `bun run typecheck` | TypeScript type checking |
| `bun run lint` | Run oxlint linter |
| `bun run engine:build` | Build Rust Obelisk engine |
| `bun run engine:run` | Run Rust Obelisk engine |

## Convention

- **Imports**: Use path aliases (`@/`) for internal packages
- **Exports**: Prefer named exports over default exports
- **Types**: Interfaces for public APIs, types for internal unions
- **Commits**: Conventional Commits format
- **Testing**: Tests co-located with source files (`.test.ts`)

## Documentation

Key documentation files:
- `CONTEXT.md` — Domain language and session runtime specification
- `docs/blueprint.md` — Technical architecture and adapter contracts
- `docs/roadmap.md` — Implementation phases and engineering tickets
- `docs/fork-decision.md` — Fork candidate evaluation

## Security

- Never commit secrets, API keys, or tokens
- Never send sensitive data to remote memory by default
- Always review dangerous operations before execution
- AI-generated security reports are not accepted and result in a ban