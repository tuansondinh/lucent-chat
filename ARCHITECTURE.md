# Architecture — GSD CLI

<div align="center">

**Core CLI tool, agent runtime, and package dependency overview**

</div>

---

## Table of Contents

- [Overview](#overview)
- [Repository Layout](#repository-layout)
- [Package Dependency Graph](#package-dependency-graph)
- [Package Reference](#package-reference)
- [Root CLI Layer](#root-cli-layer)
- [Build Chain](#build-chain)
- [Key Data Flows](#key-data-flows)

---

## Overview

The GSD CLI is a terminal-based coding agent. It is composed of a thin CLI entry layer (`src/`) layered on top of a set of workspace packages (`packages/`). The Electron desktop app (`apps/studio/`) is a separate consumer of the same runtime — it does not use `src/` directly.

```
┌──────────────────────────────────────────────────────────────────┐
│                          Consumers                               │
│                                                                  │
│   ┌────────────────────┐        ┌────────────────────────────┐  │
│   │   gsd CLI          │        │   Lucent Code (Electron)   │  │
│   │   src/ → dist/     │        │   apps/studio/             │  │
│   └─────────┬──────────┘        └──────────────┬─────────────┘  │
│             │                                  │                 │
│             │ imports                          │ extraResources  │
│             ▼                                  ▼                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │               @gsd/pi-coding-agent                      │   │
│   │        packages/pi-coding-agent/  →  bundle/            │   │
│   └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Repository Layout

```
voice-bridge-desktop/
│
├── src/                        # CLI entry layer (compiled → dist/)
│   ├── loader.ts               # Binary entry point (gsd bin)
│   ├── cli.ts                  # Arg parsing, routing, mode selection
│   ├── headless.ts             # Non-interactive / CI execution
│   ├── headless-{ui,events,query,context,answers}.ts
│   ├── worktree-cli.ts         # git worktree subcommand
│   ├── worktree-name-gen.ts    # Auto-naming for worktrees
│   ├── resource-loader.ts      # Extension + skill discovery
│   ├── tool-bootstrap.ts       # Tool validation and registration
│   ├── onboarding.ts           # First-run setup wizard
│   ├── wizard.ts               # Interactive setup prompts
│   ├── pi-migration.ts         # Migration from earlier tool versions
│   ├── mcp-server.ts           # MCP server mode
│   ├── models-resolver.ts      # Model ID resolution
│   └── resources/              # Bundled skills, extensions, assets (source of truth)
│       ├── skills/             # Skills available via /command autocomplete
│       │   └── <name>/SKILL.md
│       ├── agents/             # Subagent definitions (name + system prompt)
│       │   └── <name>.md
│       └── extensions/         # Runtime tool extensions
│
├── packages/
│   ├── pi-coding-agent/        # @gsd/pi-coding-agent — agent glue layer
│   ├── pi-agent-core/          # @gsd/pi-agent-core — agent loop + tool calling
│   ├── pi-ai/                  # @gsd/pi-ai — LLM provider abstraction
│   ├── pi-tui/                 # @gsd/pi-tui — terminal UI components
│   └── native/                 # @gsd/native — Rust N-API bindings
│
├── apps/
│   └── studio/                 # @gsd/studio — Electron desktop app
│
├── pkg/                        # piConfig shim (name, configDir identity)
├── dist/                       # Compiled CLI output — also mirrors src/resources/ after build
│   └── resources/              # Built copy of src/resources/ (what the running app reads)
│       ├── skills/             # Must be kept in sync with src/resources/skills/
│       └── agents/             # Must be kept in sync with src/resources/agents/
├── tsconfig.json               # Root TS config (src/ → dist/)
└── package.json                # Root workspace + gsd/gsd-cli bin
```

---

## Package Dependency Graph

```
src/ (CLI)
    │
    └── @gsd/pi-coding-agent
            │
            ├── @gsd/pi-agent-core
            │       │
            │       └── @gsd/pi-ai
            │               │
            │               └── (OpenAI / Anthropic / Bedrock SDKs)
            │
            ├── @gsd/pi-tui
            │
            └── @gsd/native
                    │
                    └── (Rust N-API — grep, glob, fs)
```

Each layer only imports from layers below it. `src/` sits at the top and delegates all heavy lifting to `@gsd/pi-coding-agent`.

---

## Package Reference

### `@gsd/native` — `packages/native/`

Rust N-API bindings for performance-critical operations. Compiled via `node-gyp` + `cargo`.

- `crates/ast/` — code AST parsing
- `crates/engine/` — core search engine
- `crates/grep/` — fast text search
- Exposed to Node via `packages/native/src/`

### `@gsd/pi-ai` — `packages/pi-ai/`

Unified LLM provider abstraction. Adds a consistent streaming interface over provider SDKs.

| File | Role |
|------|------|
| `api-registry.ts` | Registers and resolves provider APIs |
| `providers/` | Per-provider implementations |
| `models.ts` / `models.generated.ts` | Model metadata + capability flags |
| `oauth.ts` | OAuth token management |
| `stream.ts` | Unified streaming response handler |
| `bedrock-provider.ts` | AWS Bedrock implementation |

### `@gsd/pi-tui` — `packages/pi-tui/`

Terminal UI primitives. Used by interactive and headless modes.

- `components/` — input, output, status, overlay components
- `editor-component.ts` — prompt input with kill-ring and autocomplete
- `overlay-layout.ts` — overlay manager (model picker, sessions list)
- `keybindings.ts` / `keys.ts` — key event handling

### `@gsd/pi-agent-core` — `packages/pi-agent-core/`

The reasoning and tool-calling loop, decoupled from any UI.

| File | Role |
|------|------|
| `agent.ts` | Top-level agent entry |
| `agent-loop.ts` | Inference → tool-call → result cycle |
| `proxy.ts` | Tool call proxying and result handling |
| `types.ts` | Core types (Message, ToolCall, AgentState) |

### `@gsd/pi-coding-agent` — `packages/pi-coding-agent/`

Glue layer that assembles all packages into a usable runtime. This is the only package the CLI and Electron app need to import.

**`core/`** — session lifecycle and services:
- `agent-session.ts` — binds agent to a session
- `session-manager.ts` — CRUD for local session persistence
- `settings-manager.ts` — user settings read/write
- `auth-storage.ts` — API key storage (system keychain)
- `model-registry.ts` / `model-resolver.ts` — model selection
- `skills.ts` / `skill-tool.test.ts` — skill discovery and Skill tool (agent-side skill invocation)
- `extensions/` — extension discovery and loading
- `tools/` — bundled tool implementations
- `lsp/` — LSP integration
- `event-bus.ts` — inter-component event bus
- `compaction/` — context compaction for long sessions

**`modes/`** — execution modes:
- `interactive/` — full TUI interactive session
- `print-mode.ts` — single-shot `-p` mode
- `rpc/` — JSON-RPC mode for programmatic use

**`resources/`** — bundled skills, extensions, agent resources

---

## Root CLI Layer

`src/loader.ts` is the binary entry point. It:
1. Handles fast-path flags (`--version`, `--help`) before any heavy imports
2. Sets `PI_PACKAGE_DIR` env var for identity/theming resolution from `pkg/`
3. Delegates to `src/cli.ts`

`src/cli.ts` orchestrates startup:
1. Parses arguments
2. Checks if onboarding is needed (`onboarding.ts`)
3. Selects execution mode: interactive, print, RPC, MCP, or subcommand
4. Bootstraps tools and extensions via `tool-bootstrap.ts`
5. Creates an agent session via `@gsd/pi-coding-agent`

---

## Build Chain

```
npm run build
    │
    ├── 1. build:native-pkg     packages/native/  (cargo + node-gyp)
    ├── 2. build:tui            packages/tui/      (tsc)
    ├── 3. build:ai             packages/ai/       (tsc)
    ├── 4. build:agent-core     packages/agent-core/ (tsc)
    ├── 5. build:runtime        packages/runtime/  (tsc + copy-assets)
    ├── 6. tsc (root)           src/ → dist/
    └── 7. post-build scripts   copy resources, themes, extensions → dist/
```

For the Electron app specifically:

```
npm run dist:mac:arm64 -w @gsd/studio
    │
    ├── 1. npm run build -w @gsd/pi-coding-agent   (compile + copy-assets)
    ├── 2. npm run bundle -w @gsd/pi-coding-agent  (bundle.cjs → packages/pi-coding-agent/bundle/)
    │         • entrypoint.js + resources
    │         • production deps
    │         • pkg/ config shim
    │         • standalone Node binary (arm64)
    └── 3. electron-builder -m --arm64
              extraResources: packages/pi-coding-agent/bundle → <app>/Contents/Resources/runtime/
```

---

## Key Data Flows

### Image / Vision Input (Electron)

When a user pastes or drags an image into a chat pane, it travels through 6 layers before reaching the LLM:

```
Renderer: ChatPane.tsx
      │  bridge.prompt(paneId, text, imageDataUrl?)
      │  imageDataUrl = "data:<mimeType>;base64,<data>"
      ▼
Preload: contextBridge
      │  ipcRenderer.invoke('cmd:prompt', paneId, text, imageDataUrl, options)
      ▼
Main: ipc-handlers.ts
      │  parse data URL → ImageContent { type, data, mimeType }
      │  orchestrator.submitTurn(text, 'text', options, images)
      ▼
Main: orchestrator.ts
      │  store images on Turn object
      │  agentBridge.prompt(turn.text, undefined, turn.images)
      ▼
Main: agent-bridge.ts
      │  send({ type: 'prompt', message, images }) over stdin RPC
      ▼
Runtime subprocess: src/headless-ui.ts
      │  client.prompt(message, images)   ← RpcClient
      ▼
@gsd/pi-coding-agent: AgentSession.prompt(text, { images })
      │  build content: [TextContent, ...ImageContent[]]
      │  resize image via @gsd/native if > 2000×2000
      ▼
@gsd/pi-ai → Anthropic API (vision content blocks)
```

Images are optional at every layer — text-only prompts are unaffected. The runtime auto-resizes large images via a Rust binding before sending to the API. A `blockImages` setting in `settings-manager.ts` can scrub all images at the `convertToLlm` boundary as a privacy control.

---

### Subagent Tool Call Visibility (Electron)

When a subagent runs, the runtime emits `tool_execution_update` events containing display items (sub-tool calls and text output). These are rendered in real-time in the Electron UI, giving users visibility into subagent progress:

```
Runtime subprocess (RPC mode)
      │  session.subscribe(output)
      ▼
  tool_execution_update event: {
    toolCallId, toolName, args,
    partialResult: { details: { results: [{ messages: [...] }] } }
  }
      │
      ▼
Main: agent-bridge.ts
      │  emits 'agent-event' → { type: 'tool_execution_update', ... }
      │
      ▼
Main: orchestrator.ts
      │  handle onToolUpdate callback
      │  extract subItems from partialResult.details.results[].messages[]
      │
      ▼
Main: pane-manager.ts
      │  pushEvent('event:tool-update', { turn_id, toolCallId, subItems })
      │
      ▼
Renderer: preload/ipc bridge
      │  ipcRenderer.on('event:tool-update')
      │
      ▼
Renderer: ChatPane.tsx
      │  store.getState().updateToolSubItems(turn_id, toolCallId, subItems)
      │  replaces full subItems snapshot (not append)
      │
      ▼
Renderer: ChatMessage.tsx / ToolCallItem
      │  renders subItems as indented activity lines: "→ toolName"
      │  bounded to last 8 items with "... N earlier" indicator
      │  collapses to "N tool calls" summary on completion
```

Key features:
- **Real-time progress**: Tool calls appear as they execute within the subagent's tool_use block
- **Concurrent tracking**: Each tool tracked independently by `toolCallId` (not by name)
- **Ephemeral state**: subItems not persisted to session JSONL; reloaded sessions show no sub-item history
- **Lifecycle**: On `tool_execution_end`, subItems are cleared (collapsed to summary). On abort/crash, subItems freeze for debugging.
- **Rolling idle timeout**: Safety timer resets on every event; only fires after 5 minutes of silence (not 5 minutes total)

---

### CLI Startup

```
$ gsd [args]
      │
      ▼
src/loader.ts           ← set env vars, fast-path flags
      │
      ▼
src/cli.ts              ← parse args, check onboarding
      │
      ├─ first run? ──► src/onboarding.ts / wizard.ts
      │
      ▼
@gsd/pi-coding-agent             ← SettingsManager, AuthStorage, ModelRegistry
      │
      ▼
mode selection
  ├── interactive  ──► packages/pi-coding-agent/src/modes/interactive/
  ├── print (-p)   ──► packages/pi-coding-agent/src/modes/print-mode.ts
  ├── rpc          ──► packages/pi-coding-agent/src/modes/rpc/
  └── mcp          ──► src/mcp-server.ts
```

### Agent Turn (Interactive Mode)

```
User input (tui)
      │
      ▼
@gsd/pi-agent-core: agent-loop.ts
      │
      ├── append to session context
      │
      ▼
@gsd/pi-ai: stream.ts          ← call LLM provider, stream tokens
      │
      ├── text token ──► render to tui
      │
      └── tool_call  ──► execute tool (@gsd/native for fs/grep ops)
                │
                └── result ──► append to context, loop back
```

### Session Persistence

```
@gsd/pi-coding-agent: session-manager.ts
      │
      ├── create    ──► write JSONL to ~/.lucent/sessions/<id>/
      ├── resume    ──► read JSONL, hydrate message history
      └── update    ──► append new turns incrementally
```
