# @obelisk-ai/web

> **Documentation site package** -- Starlight/Astro-powered documentation portal for the Obelisk platform.

[![Built with Starlight](https://astro.badg.es/v2/built-with-starlight/tiny.svg)](https://starlight.astro.build)
[![Astro](https://img.shields.io/badge/Astro-5.7-bc52ee?style=flat-square&labelColor=1e293b)](https://astro.build/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&labelColor=1e293b)](https://www.typescriptlang.org/)
[![Solid.js](https://img.shields.io/badge/Solid.js-1.9-2c4f7c?style=flat-square&labelColor=1e293b)](https://www.solidjs.com/)
[![Cloudflare](https://img.shields.io/badge/Deploy-Cloudflare-f38020?style=flat-square&labelColor=1e293b)](https://www.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square&labelColor=1e293b)](https://opensource.org/licenses/MIT)

---

## Overview

`@obelisk-ai/web` is the official documentation and marketing site for the Obelisk platform. Built with **Astro** and **Starlight**, it hosts all project documentation, API references, user guides, and landing pages in a fast, accessible, and internationalized site.

The site serves as the primary knowledge hub for Obelisk users, covering everything from CLI usage and configuration to advanced topics like MCP servers, custom tools, plugins, and enterprise deployment.

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
cd packages/web
bun install
```

### Development

```bash
# Start the Astro dev server (default: http://localhost:4321)
bun run dev

# Connect to a remote API
VITE_API_URL=https://api.obelisk.ai bun run dev:remote
```

### Build

```bash
# Static site generation to dist/
bun run build
```

### Preview

```bash
# Preview the production build
bun run preview
```

---

## Architecture

### Tech Stack

| Technology | Purpose |
|---|---|
| **Astro 5.7** | Static site generation framework |
| **Starlight 0.34** | Documentation theme with built-in search, navigation, and i18n |
| **Solid.js 1.9** | Interactive UI components (share pages, code rendering) |
| **Cloudflare** | Deployment target via `@astrojs/cloudflare` adapter |
| **Shiki** | Syntax highlighting for code blocks |
| **marked + marked-shiki** | Markdown rendering pipeline |
| **@fontsource/ibm-plex-mono** | Monospace font for code |

### Routing

The site uses Astro's file-based routing coupled with Starlight's content collections:

- **`/docs/*`** -- Starlight-managed documentation pages from `src/content/docs/`
- **`/s/[id]`** -- Dynamic share pages for rendered session content
- **`index.mdx`** -- Landing page and marketing content

### Internationalization

Documentation is fully internationalized with **18 locales**:

| Locale | Code | Locale | Code |
|---|---|---|---|
| Arabic | `ar` | Norwegian Bokmal | `nb` |
| Bosnian | `bs` | Polish | `pl` |
| Danish | `da` | Portuguese (Brazil) | `pt-BR` |
| German | `de` | Russian | `ru` |
| English | `en` | Thai | `th` |
| Spanish | `es` | Turkish | `tr` |
| French | `fr` | Chinese (Simplified) | `zh-CN` |
| Italian | `it` | Chinese (Traditional) | `zh-TW` |
| Japanese | `ja` | Korean | `ko` |

Each locale has its own translated documentation pages under `src/content/docs/` and a JSON translation file under `src/content/i18n/`.

---

## Content Structure

### Documentation (`src/content/docs/`)

The documentation covers all major aspects of the Obelisk platform:

| Topic | Description |
|---|---|
| **CLI** | Command-line interface reference |
| **Commands** | All available commands and their usage |
| **Config** | Configuration file format and options |
| **Models** | Supported AI models and configuration |
| **Providers** | AI provider setup and management |
| **MCP Servers** | Model Context Protocol server configuration |
| **Agents** | Agent configuration and customization |
| **Skills** | Skill system documentation |
| **Tools** | Custom tool development |
| **Plugins** | Plugin system architecture |
| **Permissions** | Permission model and policies |
| **Themes** | Theming and customization |
| **Keybinds** | Keyboard shortcut reference |
| **Web** | Web interface documentation |
| **Server** | Obelisk server setup |
| **SDK** | SDK reference and guides |
| **Share** | Session sharing features |
| **Rules** | Rule-based configuration |
| **LSP** | Language Server Protocol support |
| **IDE** | IDE integration guides |
| **GitHub / GitLab** | Version control integration |
| **Windows WSL** | WSL setup and usage |
| **Enterprise** | Enterprise deployment guide |
| **Troubleshooting** | Common issues and solutions |
| **Ecosystem** | Community resources and integrations |

### Share Pages (`src/pages/s/`)

Dynamic route `[id].astro` renders shared session content, allowing users to view and interact with published session artifacts.

### Landing Page Components

The `src/components/` directory contains:

- **`Hero.astro`** -- Landing page hero section
- **`Lander.astro`** -- Marketing landing page layout
- **`Header.astro`** / **`Footer.astro`** -- Site chrome
- **`Share.tsx`** -- Interactive share page component (Solid.js)
- **`icons/`** -- SVG icon components
- **`share/`** -- Code rendering components for shared content (bash, code, diff, error, markdown, text)

---

## Testing

```bash
# Run Astro check for type safety
bunx astro check
```

---

## Deployment

The site is built as a static site and deployed to **Cloudflare Pages** via the `@astrojs/cloudflare` adapter:

```bash
# Production build
bun run build

# The output in dist/ is ready for deployment
```

---

## Project Structure

```
packages/web/
├── public/                  # Static assets
├── src/
│   ├── assets/              # Images, logos, screenshots
│   │   ├── lander/          # Landing page assets
│   │   └── web/             # Web interface screenshots
│   ├── components/          # Astro/React components
│   │   ├── icons/           # SVG icon components
│   │   └── share/           # Code rendering components
│   ├── content/             # Starlight content collections
│   │   ├── docs/            # Documentation pages (multi-locale)
│   │   └── i18n/            # Translation JSON files
│   ├── i18n/                # Locale configuration
│   ├── pages/               # Astro page routes
│   │   └── s/               # Dynamic share pages
│   ├── styles/              # Global CSS
│   ├── types/               # TypeScript type declarations
│   ├── content.config.ts    # Content collection config
│   └── middleware.ts         # Astro middleware
├── astro.config.mjs         # Astro configuration
├── config.mjs               # Shared site configuration
└── package.json
```