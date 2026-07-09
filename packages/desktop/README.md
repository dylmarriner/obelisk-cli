# @obelisk-ai/desktop

> **Desktop application package** -- Electron-based native desktop wrapper for the Obelisk platform.

[![npm version](https://img.shields.io/npm/v/@obelisk-ai/desktop?style=flat-square&labelColor=1e293b&color=6366f1)](https://www.npmjs.com/package/@obelisk-ai/desktop)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&labelColor=1e293b)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-42-47848f?style=flat-square&labelColor=1e293b)](https://www.electronjs.org/)
[![Electron Vite](https://img.shields.io/badge/Electron_Vite-5-646cff?style=flat-square&labelColor=1e293b)](https://electron-vite.org/)
[![Solid.js](https://img.shields.io/badge/Solid.js-1.9-2c4f7c?style=flat-square&labelColor=1e293b)](https://www.solidjs.com/)
[![Platform](https://img.shields.io/badge/Platform-macOS_|_Windows_|_Linux-1e293b?style=flat-square&labelColor=1e293b)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square&labelColor=1e293b)](https://opensource.org/licenses/MIT)

---

## Overview

`@obelisk-ai/desktop` is the native desktop application for the Obelisk platform. Built with **Electron** and **electron-vite**, it wraps the Obelisk web application (`@obelisk-ai/app`) in a native shell, providing window management, system tray integration, OS-level notifications, automatic updates, and deep platform integration.

The package follows Electron's three-process architecture:

| Process | Entry | Responsibility |
|---|---|---|
| **Main** | `src/main/index.ts` | Window management, IPC, system tray, server lifecycle, native menus |
| **Preload** | `src/preload/index.ts` | Secure bridge exposing main process APIs to the renderer |
| **Renderer** | `src/renderer/index.tsx` | UI shell, onboarding, WSL configuration, native-feeling chrome |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.3+ (project package manager)
- Node.js 22+
- Platform-specific build tools (see [Electron Builder docs](https://www.electron.build/))

### Install

```bash
# From the monorepo root
bun install

# Or from this package directory
cd packages/desktop
bun install
```

### Development

```bash
# Start the Electron app in development mode with hot reload
bun run dev

# Or from the monorepo root
bun run dev:desktop
```

### Build

```bash
# Compile JavaScript assets
bun run build

# Preview the production build
bun run preview
```

### Package for Distribution

```bash
# Package for the current platform
bun run package

# Platform-specific builds
bun run package:mac      # macOS (.dmg, .zip)
bun run package:win      # Windows (.exe, .msi, .nupkg)
bun run package:linux    # Linux (.AppImage, .deb, .rpm)
```

---

## Architecture

### Main Process (`src/main/`)

The main process manages the application lifecycle and native OS integration:

| Module | Responsibility |
|---|---|
| **`index.ts`** | Application entry point, lifecycle management |
| **`windows.ts`** | Window creation, management, and lifecycle |
| **`window-registry.ts`** | Window instance tracking and lookup |
| **`menu.ts`** | Native application menu bar construction |
| **`desktop-menu-actions.ts`** | Menu action handlers |
| **`ipc.ts`** | IPC channel definitions and handlers |
| **`server.ts`** | Built-in Obelisk server lifecycle |
| **`sidecar.ts`** | Sidecar process management |
| **`updater.ts`** | Auto-update orchestration |
| **`updater-controller.ts`** | Update flow control and state machine |
| **`updater-subscriptions.ts`** | Update channel subscription management |
| **`store.ts`** | Persistent application state (electron-store) |
| **`store-keys.ts`** | Store key schema and defaults |
| **`store-cleanup.ts`** | Store migration and data cleanup |
| **`shell-env.ts`** | Shell environment variable resolution |
| **`apps.ts`** | Application launcher and discovery |
| **`onboarding.ts`** | First-run onboarding flow |
| **`markdown.ts`** | Markdown processing for notifications |
| **`migrate.ts`** | Data migration between versions |
| **`logging.ts`** | Structured logging (electron-log) |
| **`constants.ts`** | Application constants |
| **`unresponsive.ts`** | Unresponsive process detection and recovery |
| **`attachment-picker.ts`** | Native file attachment picker |
| **`wsl/`** | WSL integration: IPC, policy, runtime, servers, sidecar, startup |

### Preload Script (`src/preload/`)

The preload script establishes a secure bridge between the main and renderer processes:

- **`index.ts`** -- Exposes typed IPC channels to the renderer via `contextBridge`
- **`types.ts`** -- Type definitions for the exposed API surface

### Renderer Process (`src/renderer/`)

The renderer provides the desktop UI shell, separate from the embedded web app:

| Module | Responsibility |
|---|---|
| **`index.tsx`** | Renderer entry point, mounts the desktop shell |
| **`index.html`** | HTML shell for the renderer |
| **`onboarding.tsx`** | First-run onboarding wizard UI |
| **`initialization.ts`** | Renderer initialization lifecycle |
| **`cli.ts`** | CLI argument parsing and deep link handling |
| **`webview-zoom.ts`** | Webview zoom level management |
| **`styles.css`** | Renderer-scoped styles |
| **`i18n/`** | 17 locale files for desktop UI strings |
| **`wsl/`** | WSL connection management UI |

---

## Features

### Native Platform Integration

- **System Tray** -- Background operation with tray icon, context menu
- **Native Menus** -- Platform-appropriate application menus (macOS menu bar, Windows/Linux window menus)
- **Auto-Update** -- Seamless background updates via `electron-updater`
- **Window State** -- Persistent window position, size, and maximized state across restarts
- **Context Menus** -- Right-click context menus throughout the app

### Server Management

- **Built-in Server** -- The desktop app can run an integrated Obelisk server as a sidecar
- **Server Lifecycle** -- Automatic start/stop management with health monitoring
- **WSL Support** -- Full Windows Subsystem for Linux integration for server discovery, policy management, and runtime orchestration

### Update System

The update subsystem is built with three cooperating modules:

1. **`updater.ts`** -- Core update orchestration using `electron-updater`
2. **`updater-controller.ts`** -- State machine managing update lifecycle (checking, downloading, ready, installing)
3. **`updater-subscriptions.ts`** -- Subscription-based update notification channels

### Internationalization

The desktop UI supports **17 locales**:
Arabic, Bosnian, Brazilian Portuguese, Chinese (Simplified), Chinese (Traditional), Danish, English, French, German, Japanese, Korean, Norwegian, Polish, Russian, Turkish, Ukrainian, plus a shared index.

---

## Scripts

| Script | Description |
|---|---|
| `bun run dev` | Start development with hot reload |
| `bun run build` | Build all assets for production |
| `bun run preview` | Preview the production build |
| `bun run package` | Package for current platform |
| `bun run package:mac` | macOS distribution build |
| `bun run package:win` | Windows distribution build |
| `bun run package:linux` | Linux distribution build |
| `bun run typecheck` | TypeScript type checking |
| `bun run native:build` | Build native addon dependencies |

---

## Configuration

### Build Configuration

The project uses **electron-builder** for packaging, configured in `electron-builder.config.ts`:

- Platform-specific build targets (dmg/zip, nsis/msi, AppImage/deb)
- Code signing configuration for macOS and Windows
- Auto-update publishing
- Resource bundling

### Electron Vite Configuration

The `electron.vite.config.ts` configures three build targets:

- **Main** -- Compiles main process TypeScript to `out/main/`
- **Preload** -- Compiles preload script to `out/preload/`
- **Renderer** -- Compiles renderer UI to `out/renderer/`

### Environment Variables

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API URL for the embedded web app |

---

## Platform Support

| Platform | Support | Package Formats |
|---|---|---|
| **macOS** | Full | `.dmg`, `.zip` |
| **Windows** | Full | `.exe` (NSIS), `.msi` |
| **Linux** | Full | `.AppImage`, `.deb`, `.rpm` |

---

## Project Structure

```
packages/desktop/
├── icons/                        # Application icons
├── resources/                    # Bundled resources
├── scripts/
│   ├── predev.ts                 # Pre-development setup
│   └── prebuild.ts               # Pre-build setup
├── src/
│   ├── main/                     # Electron main process
│   │   ├── wsl/                  # WSL integration
│   │   ├── index.ts              # Process entry point
│   │   ├── windows.ts            # Window management
│   │   ├── window-registry.ts    # Window tracking
│   │   ├── menu.ts               # Native menus
│   │   ├── server.ts             # Built-in server
│   │   ├── sidecar.ts            # Sidecar processes
│   │   ├── updater.ts            # Auto-update
│   │   ├── updater-controller.ts # Update state machine
│   │   ├── updater-subscriptions.ts
│   │   ├── store.ts              # Persistent state
│   │   ├── ipc.ts                # IPC handlers
│   │   ├── shell-env.ts          # Environment resolution
│   │   └── ...                   # Additional modules
│   ├── preload/                  # Preload bridge
│   │   ├── index.ts              # contextBridge setup
│   │   └── types.ts              # API type definitions
│   └── renderer/                 # Desktop UI shell
│       ├── i18n/                 # Locale files
│       ├── wsl/                  # WSL connection UI
│       ├── index.tsx             # Renderer entry
│       ├── index.html            # HTML shell
│       ├── onboarding.tsx        # First-run wizard
│       └── styles.css            # Renderer styles
├── electron-builder.config.ts     # Electron Builder config
├── electron.vite.config.ts       # Electron Vite config
└── package.json
```