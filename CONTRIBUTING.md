# Contributing to Obelisk CLI

Thank you for your interest in contributing to Obelisk CLI! We welcome contributions from everyone, whether you're fixing a bug, adding a feature, improving documentation, or writing tests.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Commit Convention](#commit-convention)
- [Documentation](#documentation)
- [Security](#security)
- [Questions?](#questions)

---

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [Bun](https://bun.sh/) >= 1.3
- [Git](https://git-scm.com/) >= 2.40
- [Rust](https://www.rust-lang.org/) (optional, for Obelisk engine)
- [Go](https://go.dev/) (optional, for Zoekt)
- [Tailscale](https://tailscale.com/) (optional, for remote memory)

### Fork and Clone

```bash
# Fork the repository on GitHub
git clone https://github.com/YOUR_USERNAME/obelisk-cli.git
cd obelisk-cli

# Add upstream remote
git remote add upstream https://github.com/dylmarriner/obelisk-cli.git

# Install dependencies
bun install
```

### Verify Setup

```bash
# Run type checking
bun run typecheck

# Run linting
bun run lint

# Start dev server
bun run dev
```

---

## Development Workflow

### Branch Naming

Use descriptive branch names following this convention:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat/` | New features | `feat/nexus-memory-adapter` |
| `fix/` | Bug fixes | `fix/memory-queue-crash` |
| `docs/` | Documentation | `docs/api-reference-update` |
| `refactor/` | Code refactoring | `refactor/adapter-contracts` |
| `test/` | Test additions | `test/nexus-health-check` |
| `chore/` | Maintenance | `chore/update-dependencies` |

### Development Cycle

1. **Create a branch** from `main`
2. **Make changes** following coding standards
3. **Write tests** for new functionality
4. **Run tests** and ensure they pass
5. **Run linting** and type checking
6. **Commit** following commit convention
7. **Push** and open a Pull Request

```bash
git checkout -b feat/my-feature
# ... make changes ...
bun run typecheck
bun run lint
git add .
git commit -m "feat: add my feature"
git push origin feat/my-feature
```

---

## Project Structure

```
obelisk-cli/
  apps/
    cli/                  # CLI binary and commands
    desktop/              # Desktop application
    mcp-server/           # MCP server
    console/              # Web console
  packages/
    core/                 # Core runtime
    obelisk-core/         # Token/policy engine
    adapters/             # External tool integrations
    plugins/              # Plugin system
    security/             # Security policies
    shared/               # Shared utilities
    web/                  # Documentation site
    app/                  # Web application
  docs/                   # Architecture docs
  specs/                  # Specifications
  eval/                   # Evaluated components
```

---

## Coding Standards

### TypeScript

- **Strict mode**: All TypeScript code must compile with `strict: true`
- **Naming**: `camelCase` for variables/functions, `PascalCase` for types/classes, `UPPER_CASE` for constants
- **Imports**: Use path aliases (`@/`) for internal imports
- **Exports**: Prefer named exports over default exports
- **Types**: Define interfaces for public APIs, types for internal unions
- **Null safety**: Use `undefined` over `null`; prefer `??` over `||` for defaults

### Formatting

```bash
# Format code
bun run format

# Lint
bun run lint
```

### Documentation

- **Public APIs**: All public functions, interfaces, and classes must have JSDoc/TSDoc comments
- **Complex logic**: Add comments explaining *why*, not *what*
- **READMEs**: Update relevant documentation when changing behavior
- **Specs**: Update spec files when changing API contracts

### Rust (Obelisk Engine)

- Follow Rust 2024 edition conventions
- Use `cargo clippy` for linting
- Document public items with doc comments

---

## Testing

### Test Philosophy

- **Unit tests** for core logic and adapters
- **Integration tests** for Nexus memory, Zoekt, and external tools
- **E2E tests** for CLI commands and workflows

### Running Tests

```bash
# Run tests for a specific package
bun run --cwd packages/core test

# Run Obelisk engine tests
bun run engine:run -- test

# Type checking
bun run typecheck
```

### Writing Tests

- Place tests alongside source files: `src/foo.ts` → `src/foo.test.ts`
- Use descriptive test names that explain the expected behavior
- Mock external dependencies (Nexus, Zoekt, ast-grep) for unit tests
- Include edge cases and error conditions

---

## Pull Request Process

### Before Submitting

1. Ensure all tests pass
2. Ensure code is properly formatted and linted
3. Update documentation if needed
4. Add tests for new functionality
5. Rebase on latest `main`

### PR Template

```markdown
## Description
Brief description of the changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring
- [ ] Performance improvement

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project standards
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] Commit messages follow convention
```

### Review Process

1. At least one maintainer review required
2. Address all review comments
3. CI must pass
4. Squash commits before merge

---

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Purpose |
|------|---------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `refactor` | Code restructuring |
| `perf` | Performance improvements |
| `test` | Test additions/updates |
| `chore` | Maintenance, dependencies |
| `ci` | CI/CD changes |
| `style` | Formatting, linting |

### Examples

```
feat(nexus): add offline memory queue with automatic retry
fix(search): handle empty index in Zoekt adapter
docs(api): update session endpoint documentation
refactor(core): extract ToolRouter from AgentRuntime
test(memory): add offline queue fallback tests
```

---

## Documentation

### Documentation Standards

All documentation should be:

- **Clear**: Use simple language, avoid jargon where possible
- **Complete**: Cover setup, configuration, usage, and troubleshooting
- **Current**: Updated when behavior changes
- **Accessible**: Include examples for common use cases

### Where to Document

| Change Type | Documentation Location |
|-------------|----------------------|
| API changes | `specs/` files |
| CLI commands | `docs/` + CLI help text |
| Architecture | `docs/blueprint.md` |
| Configuration | `docs/` + config schema |
| Security | `SECURITY.md` |

---

## Security

### Reporting Vulnerabilities

Please see [SECURITY.md](./SECURITY.md) for our vulnerability disclosure policy.

**Important:** We do not accept AI-generated security reports. Automated submissions will result in a ban.

### Security Considerations

- Never commit secrets, API keys, or tokens
- Never send sensitive data to remote memory by default
- Always review dangerous operations before execution
- Use `OBELISK_SERVER_PASSWORD` in server mode

---

## Questions?

If you have questions or need help:

- Open a [Discussion](https://github.com/dylmarriner/obelisk-cli/discussions)
- Check existing [Issues](https://github.com/dylmarriner/obelisk-cli/issues)
- Review the [Documentation](./docs/)

---

## Recognition

Contributors are recognized in our release notes and project documentation. We value every contribution, big or small.

Thank you for helping make Obelisk CLI better!