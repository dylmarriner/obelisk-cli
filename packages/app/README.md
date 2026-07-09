# @obelisk-ai/app

> **Web application package** -- Solid.js-based browser interface for the Obelisk platform.

[![npm version](https://img.shields.io/npm/v/@obelisk-ai/app?style=flat-square&labelColor=1e293b&color=6366f1)](https://www.npmjs.com/package/@obelisk-ai/app)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&labelColor=1e293b)](https://www.typescriptlang.org/)
[![Solid.js](https://img.shields.io/badge/Solid.js-1.9-2c4f7c?style=flat-square&labelColor=1e293b)](https://www.solidjs.com/)
[![Vite](https://img.shields.io/badge/Vite-7.1-646cff?style=flat-square&labelColor=1e293b)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-06b6d4?style=flat-square&labelColor=1e293b)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square&labelColor=1e293b)](https://opensource.org/licenses/MIT)

---

## Overview

`@obelisk-ai/app` is the browser-based client for the Obelisk platform. Built with **Solid.js** and **Vite**, it provides the complete web interface for managing AI development sessions, viewing timelines, configuring settings, and interacting with the Obelisk engine.

The package is organized into a modular architecture with clear separation of concerns:

| Layer | Directory | Responsibility |
|---|---|---|
| **Pages & Routing** | `src/pages/` | Route components, session composer, timeline rendering, layout shells |
| **State Management** | `src/context/` | Reactivity contexts for commands, files, tabs, terminals, MCP, sync, settings |
| **UI Components** | `src/components/` | Reusable UI: command palette, file tree, titlebar, prompt input, session tabs, dialogs |
| **Internationalization** | `src/i18n/` | 18 language locales with full UI translation support |
| **Utilities** | `src/utils/` | Shared helpers: diffs, persistence, server health, notifications, worktree |
| **Addons** | `src/addons/` | Addon serialization logic |
| **WSL Integration** | `src/wsl/` | WSL server discovery, settings, and connection dialogs |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.3+ (project package manager)
- Node.js 22+

### Install

```bash
# From the monorepo root
bun install

# Or from this package directory
cd packages/app
bun install
```

### Development

```bash
# Start the Vite dev server (default: http://localhost:3000)
bun run dev

# Or from the monorepo root
bun run dev:web
```

### Build

```bash
# Production build to dist/
bun run build
```

### Preview

```bash
# Serve the production build locally
bun run serve
```

---

## Testing

The package includes a comprehensive test suite across three layers:

### Unit Tests

```bash
# Run unit tests with HappyDOM
bun run test:unit

# Watch mode
bun run test:unit:watch
```

### Browser Tests

```bash
# Run browser-based tests
bun run test:browser
```

### End-to-End Tests

```bash
# Run all E2E tests
bun run test:e2e

# Run with Playwright UI
bun run test:e2e:ui

# View the last E2E report
bun run test:e2e:report
```

### Performance & Stability Tests

```bash
# Visual stability regression tests
bun run test:stability

# Benchmark tests
bun run test:bench
```

---

## Architecture

### Key Technologies

| Technology | Purpose |
|---|---|
| **Solid.js 1.9** | Reactive UI framework with fine-grained reactivity |
| **Vite 7.1** | Fast bundler and dev server |
| **Tailwind CSS 4.1** | Utility-first styling |
| **@solidjs/router** | Client-side routing |
| **@solidjs/start** | SolidStart integration |
| **@kobalte/core** | Accessible UI primitives (dialogs, popovers, menus) |
| **@tanstack/solid-query** | Server state management |
| **@tanstack/solid-virtual** | Virtualized lists for large timelines |
| **@sentry/solid** | Error tracking and performance monitoring |
| **Shiki** | Syntax highlighting for code rendering |
| **marked + marked-shiki** | Markdown rendering pipeline |
| **@dnd-kit** | Drag-and-drop for sortable tabs and file trees |
| **Effect** | Effect system for typed, composable side effects |
| **OpenTUI** | Terminal UI components and keymaps |

### State Management

The application uses **Solid.js Context** providers for all state management. Key contexts include:

- **`GlobalContext`** -- Application-wide state (theme, layout, platform)
- **`SessionContext`** -- Active session lifecycle and state
- **`ServerContext`** -- Server connection management
- **`SettingsContext`** -- User preferences and configuration
- **`FileContext`** -- File system interaction and file tree state
- **`MCPSyncContext`** -- MCP tool synchronization
- **`TerminalContext`** -- Terminal session management
- **`LocalContext`** -- Local storage-backed preferences

### Internationalization

The app ships with **18 locales**:
English, German, French, Spanish, Japanese, Korean, Chinese (Simplified & Traditional), Russian, Arabic, Brazilian Portuguese, Bosnian, Danish, Norwegian, Polish, Thai, Turkish, Ukrainian.

### Exports

The package exposes several entry points for use by the desktop wrapper and other consumers:

| Export | Path | Purpose |
|---|---|---|
| Main app | `./src/index.ts` | Application entry and components |
| Desktop menu | `./src/desktop-menu.ts` | Native menu integration for Electron |
| Updater | `./src/updater.ts` | Application update logic |
| WSL types | `./src/wsl/types.ts` | WSL integration type definitions |
| Vite config | `./vite.js` | Shared Vite configuration |
| Styles | `./src/index.css` | Global stylesheet |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4096` | Backend API URL |
| `PLAYWRIGHT_SERVER_HOST` | `localhost` | E2E test server host |
| `PLAYWRIGHT_SERVER_PORT` | `4096` | E2E test server port |
| `PLAYWRIGHT_PORT` | `3000` | E2E test app port |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | E2E test base URL |

### Vite Configuration

The package uses a shared `vite.js` config module with:
- **@tailwindcss/vite** -- Tailwind CSS processing
- **vite-plugin-solid** -- Solid.js compilation
- **@sentry/vite-plugin** -- Source map upload for error tracking
- **vite-plugin-icons-spritesheet** -- SVG icon spritesheet generation

---

## Project Structure

```
packages/app/
├── src/
│   ├── addons/           # Addon serialization
│   ├── components/       # UI components
│   │   ├── prompt-input/ # Prompt editor with attachments, history, autocomplete
│   │   ├── server/       # Server connection components
│   │   ├── session/      # Session header, tabs, metrics
│   │   └── settings-v2/  # Settings dialog panels
│   ├── constants/        # Application constants
│   ├── context/          # State management contexts
│   │   └── file/         # File system context internals
│   ├── hooks/            # Shared hooks
│   ├── i18n/             # Internationalization locales
│   ├── pages/            # Page components
│   │   ├── layout/       # Layout shells
│   │   └── session/      # Session pages
│   │       ├── composer/ # Session composer UI
│   │       ├── timeline/ # Message timeline with virtual scrolling
│   │       └── v2/       # Session review panel
│   ├── utils/            # Utility functions
│   └── wsl/              # WSL integration
├── e2e/                  # Playwright E2E tests
├── test-browser/         # Browser test files
├── public/               # Static assets
├── index.html            # HTML entry point
├── vite.config.ts        # Vite configuration
├── playwright.config.ts  # Playwright configuration
└── package.json
```