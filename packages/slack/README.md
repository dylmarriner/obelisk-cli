# @obelisk-ai/slack

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-1.17.15-blue)]()
[![Slack](https://img.shields.io/badge/Slack-Bolt-4A154B)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)]()

Slack bot integration for Obelisk AI. Bridges Slack conversations to AI-powered coding sessions with real-time tool update streaming and thread-based session management.

---

## Features

- **Thread-Based Sessions** -- One AI session per Slack thread, automatically created and managed
- **Socket Mode** -- No public HTTP endpoint needed; connects via Slack Socket Mode
- **Live Tool Streaming** -- Real-time tool call updates posted directly to the Slack thread
- **Session Sharing** -- Automatically shares and posts session URLs for collaborative review
- **Health Check** -- `/test` slash command for bot health verification
- **Minimal Setup** -- Single entry point, three environment variables

---

## Quick Start

### Prerequisites

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** in your Slack app settings
3. Add the following OAuth scopes:
   - `chat:write` -- Send messages
   - `app_mentions:read` -- Read mentions
   - `channels:history` -- Read channel history
   - `groups:history` -- Read private channel history

### Installation

```bash
# From the monorepo root
bun install
```

### Configuration

Create a `.env` file:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
```

### Run

```bash
bun --filter @obelisk-ai/slack dev
```

---

## Usage

### Chat with Obelisk

Once the bot is running and added to a channel:

1. **Mention the bot** in any channel or send a DM
2. The bot creates a new AI session for each thread
3. Send your message -- the bot responds with AI-generated content
4. Tool calls are streamed as live updates in the thread
5. A share URL is posted for collaborative review

### Slash Commands

| Command | Description |
|---|---|
| `/test` | Health check -- responds with "Bot is working!" |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Slack Infrastructure                   │
│                                                          │
│  ┌──────────┐    ┌───────────┐    ┌────────────────┐    │
│  │ Slack    │    │ Slack     │    │ Slack Events   │    │
│  │ App      │───▶│ Socket    │───▶│ API (Bolt)     │    │
│  │ Config   │    │ Mode      │    │                │    │
│  └──────────┘    └───────────┘    └────────┬───────┘    │
│                                            │            │
└────────────────────────────────────────────┼────────────┘
                                             │
                    ┌────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────────┐
│                  @obelisk-ai/slack Bot                    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Session Manager (Map<channel-thread, Session>)    │  │
│  │  ┌────────────────┐  ┌──────────────────────────┐  │  │
│  │  │ app.message    │  │ Live Tool Update Stream  │  │  │
│  │  │ Handler        │  │ (message.part.updated    │  │  │
│  │  │                │  │  subscriber)             │  │  │
│  │  └────────────────┘  └──────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│                          ▼                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Obelisk Server (from @obelisk-ai/sdk)      │  │
│  │  ┌──────────────────┐  ┌────────────────────────┐  │  │
│  │  │  Server Process  │  │  Client API            │  │  │
│  │  │  (Random Port)   │  │  (session.create,      │  │  │
│  │  │                  │  │   session.prompt,      │  │  │
│  │  │                  │  │   event.subscribe)     │  │  │
│  │  └──────────────────┘  └────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Session Lifecycle

1. **Message received** in a Slack thread
2. Look up existing session by `channel-thread_ts` key
3. If no session exists: create a new Obelisk AI session, start event subscription, share the session
4. Send user message text to the session via `client.session.prompt()`
5. Post AI response text back to the Slack thread
6. Tool updates (from `message.part.updated` events) are posted as they complete

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (starts with `xoxb-`) |
| `SLACK_SIGNING_SECRET` | Yes | Slack app signing secret |
| `SLACK_APP_TOKEN` | Yes | Slack app-level token (starts with `xapp-`) |

---

## Development

```bash
# Type-check
bun --filter @obelisk-ai/slack typecheck

# Run with debug logging
bun --filter @obelisk-ai/slack dev
```

All raw Slack events are logged to stdout for debugging. The bot uses `@slack/bolt` with Socket Mode, so no public HTTP endpoint or tunneling is required during development.

---

## Project Structure

```
packages/slack/
├── src/
│   └── index.ts           # Single-entry bot application
├── .env.example           # Environment variable template
├── package.json
└── tsconfig.json
```