# @obelisk-ai/docs

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Mintlify](https://img.shields.io/badge/docs-Mintlify-16A34A)](https://mintlify.com)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0-6BA539)]()

Documentation site for the Obelisk AI platform. Built with Mintlify, featuring interactive API reference docs, quickstart guides, IDE setup instructions, and comprehensive developer documentation.

---

## Features

- **Interactive API Reference** -- Auto-generated OpenAPI documentation from the SDK spec
- **Quickstart Guide** -- 3-step setup from clone to deployment
- **IDE Integration Guides** -- Setup instructions for Cursor, Claude Code, and Windsurf
- **Responsive Design** -- Mintlify theme with green brand colors (`#16A34A`)
- **Contextual AI Options** -- Built-in copy, view, and AI tool integrations (ChatGPT, Claude, Perplexity, MCP, Cursor, VS Code)
- **Reusable Snippets** -- Component-based documentation with shared snippets

---

## Quick Start

### Prerequisites

```bash
# Install the Mintlify CLI
npm i -g mint
```

### Local Development

```bash
# Navigate to the docs package
cd packages/docs

# Start the development server
mint dev
```

View your local preview at `http://localhost:3000`.

### Production Deployment

Install the [Mintlify GitHub App](https://dashboard.mintlify.com/settings/organization/github-app) to auto-deploy changes from the default branch.

---

## Content Structure

```
packages/docs/
├── docs.json                    # Mintlify site configuration
├── index.mdx                    # Homepage / Introduction
├── quickstart.mdx               # 3-step quickstart guide
├── development.mdx             # Local development setup
├── openapi.json                 # OpenAPI spec (symlink to ../sdk/openapi.json)
│
├── essentials/                  # Mintlify documentation reference
│   ├── navigation.mdx          # Navigation setup
│   ├── settings.mdx            # docs.json properties reference
│   ├── code.mdx                # Code blocks usage
│   ├── images.mdx              # Images and embeds
│   ├── markdown.mdx            # Markdown syntax reference
│   └── reusable-snippets.mdx   # Snippet system
│
├── ai-tools/                    # IDE integration guides
│   ├── cursor.mdx              # Cursor IDE setup
│   ├── claude-code.mdx         # Claude Code CLI setup
│   └── windsurf.mdx            # Windsurf editor setup
│
├── snippets/                    # Reusable content snippets
├── images/                      # Image assets
├── logo/                        # Brand logos (light + dark)
└── favicon-v3.svg               # Site favicon
```

---

## Site Configuration

The `docs.json` file configures the Mintlify site:

```json
{
  "name": "@obelisk-ai/docs",
  "theme": "mint",
  "colors": {
    "primary": "#16A34A",
    "light": "#07C983",
    "dark": "#15803D"
  },
  "openapi": "https://obelisk.ai/openapi.json",
  "favicon": "/favicon-v3.svg",
  "logo": {
    "light": "/logo/light.svg",
    "dark": "/logo/dark.svg"
  }
}
```

### Available Components

Mintlify provides a rich set of components for documentation:

| Component | Usage |
|---|---|
| `Card`, `CardGroup` | Linked content cards |
| `Accordion`, `AccordionGroup` | Collapsible sections |
| `Steps`, `Step` | Step-by-step guides |
| `Tabs`, `Tab`, `CodeGroup` | Code samples and tabbed content |
| `Note`, `Tip`, `Warning`, `Info`, `Check` | Callout blocks |
| `ParamField`, `ResponseField` | API parameter documentation |
| `RequestExample`, `ResponseExample` | API request/response examples |
| `Frame` | Image frames with borders |
| `Expandable` | Expandable content sections |
| `Tooltip` | Hover tooltips |
| `Latex` | Mathematical notation |

---

## Writing Documentation

### Page Format

Each page is an MDX file with YAML frontmatter:

```mdx
---
title: Page Title
description: Brief description for search and navigation
---

# Page Title

Content using Mintlify components...

<CardGroup>
  <Card title="Guide" icon="book" href="/guide">
    Getting started guide
  </Card>
  <Card title="API" icon="code" href="/api">
    API reference
  </Card>
</CardGroup>
```

### Link Validation

```bash
# Check for broken links
mint broken-links
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Mintlify Platform                      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  @obelisk-ai/docs (MDX Content)                    │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │  Guides  │  │  API Ref │  │  IDE Integrations │  │  │
│  │  │          │  │ (OpenAPI)│  │                   │  │  │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                           │                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Mintlify CLI (mint dev / mint deploy)             │  │
│  │  - Dev server at localhost:3000                    │  │
│  │  - GitHub App auto-deploys on push                 │  │
│  │  - Link validation via mint broken-links           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```