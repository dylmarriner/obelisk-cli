# @obelisk-ai/containers

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Base Image](https://img.shields.io/badge/base-ubuntu%3A24.04-E95420)](https://ubuntu.com/)
[![Registry](https://img.shields.io/badge/registry-ghcr.io%2Fanomalyco-2496ED)](https://ghcr.io)

Container images for CI/CD build pipelines. A layered set of Docker images providing reproducible build environments for Obelisk AI across multiple architectures.

---

## Features

- **Layered Image Hierarchy** -- Shared base layers minimize duplication and build time
- **Multi-Architecture** -- Supports `amd64` and `arm64` via Docker Buildx
- **CI-Optimized** -- Designed for `job.container` in GitHub Actions Linux runners
- **Reproducible Builds** -- Pinned toolchain versions for deterministic builds
- **Tauri Support** -- Complete system dependencies for building Tauri desktop apps
- **Publishing Ready** -- Docker CLI and AUR tooling for package publishing

---

## Image Reference

```
ubuntu:24.04
  └── base                              # Build essentials + common tools
       └── bun-node                     # base + Bun 1.3.14 + Node.js 24.4.0
            ├── rust                    # bun-node + Rust stable toolchain
            │    └── tauri-linux        # rust + Tauri Linux system deps
            └── publish                 # bun-node + Docker CLI + AUR tools
```

### `base:24.04`

**From:** `ubuntu:24.04`

Installed packages: `build-essential`, `ca-certificates`, `curl`, `git`, `jq`, `openssh-client`, `pkg-config`, `python3`, `unzip`, `xz-utils`, `zip`

### `bun-node:24.04`

**From:** `ghcr.io/anomalyco/build/base:24.04`

| Tool | Version | Architectures |
|---|---|---|
| Node.js | 24.4.0 | `x86_64`, `aarch64` |
| Bun | 1.3.14 | `x86_64`, `aarch64` |

### `rust:24.04`

**From:** `ghcr.io/anomalyco/build/bun-node:24.04`

| Component | Details |
|---|---|
| Rust toolchain | `stable` (configurable via `RUST_TOOLCHAIN` build arg) |
| rustup profile | `minimal` |
| Cargo home | `/opt/cargo` |
| Rustup home | `/opt/rustup` |

### `tauri-linux:24.04`

**From:** `ghcr.io/anomalyco/build/rust:24.04`

Additional packages: `libappindicator3-dev`, `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`

### `publish:24.04`

**From:** `ghcr.io/anomalyco/build/bun-node:24.04`

Additional packages: `docker.io` (Docker CLI), `pacman-package-manager` (AUR publishing)

---

## Quick Start

### Build All Images

```bash
REGISTRY=ghcr.io/anomalyco TAG=24.04 bun ./packages/containers/script/build.ts
```

### Build and Push (Multi-Arch)

```bash
REGISTRY=ghcr.io/anomalyco TAG=24.04 bun ./packages/containers/script/build.ts --push
```

### Use in GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/anomalyco/build/rust:24.04
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --release
```

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                 GitHub Actions                    │
│  ┌──────────────────────────────────────────────┐ │
│  │              job.container                    │ │
│  │  ┌──────────────────────────────────────────┐ │ │
│  │  │  tauri-linux:24.04                       │ │ │
│  │  │  ┌──────────────┐  ┌───────────────────┐ │ │ │
│  │  │  │  Rust Stable  │  │  Tauri System     │ │ │ │
│  │  │  │  (cargo,      │  │  Dependencies     │ │ │ │
│  │  │  │   rustup)     │  │  (libwebkit2gtk,  │ │ │ │
│  │  │  └──────────────┘  │   librsvg2, etc.)  │ │ │ │
│  │  │                    └───────────────────┘ │ │ │
│  │  │  ┌──────────────────────────────────────┐ │ │ │
│  │  │  │  Bun 1.3.14 + Node.js 24.4.0        │ │ │ │
│  │  │  └──────────────────────────────────────┘ │ │ │
│  │  │  ┌──────────────────────────────────────┐ │ │ │
│  │  │  │  Ubuntu 24.04 (build-essential,      │ │ │ │
│  │  │  │   git, curl, python3, jq, etc.)     │ │ │ │
│  │  │  └──────────────────────────────────────┘ │ │ │
│  │  └──────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Layer Cache Strategy

The layered design optimizes CI build times through Docker layer caching:

- **`base`** changes infrequently -- only when OS packages are updated
- **`bun-node`** changes when runtime versions are bumped
- **`rust`** / **`tauri-linux`** / **`publish`** are the most frequently rebuilt, but their layers are thin

CI pipelines only rebuild the layers that actually changed, significantly reducing build time.

---

## Build Configuration

### Build Arguments

| Image | Arg | Default | Description |
|---|---|---|---|
| `rust` | `RUST_TOOLCHAIN` | `stable` | Rust toolchain version to install |
| All | `REGISTRY` | `ghcr.io/anomalyco` | Container registry |
| All | `TAG` | `24.04` | Image tag (OS version) |

### Notes

- These images only help Linux jobs. macOS and Windows jobs cannot run inside Linux containers.
- `--push` publishes multi-arch (amd64 + arm64) images using Buildx.
- If a job uses Docker Buildx, the container needs access to the host Docker daemon (or `docker-in-docker` with privileged mode).

---

## Project Structure

```
packages/containers/
├── base/
│   └── Dockerfile              # Ubuntu 24.04 + build tools
├── bun-node/
│   └── Dockerfile              # base + Bun 1.3.14 + Node.js 24.4.0
├── rust/
│   └── Dockerfile              # bun-node + Rust stable toolchain
├── tauri-linux/
│   └── Dockerfile              # rust + Tauri system dependencies
├── publish/
│   └── Dockerfile              # bun-node + Docker CLI + AUR tools
├── script/                     # Build scripts (build.ts)
└── tsconfig.json               # TypeScript config for build scripts
```