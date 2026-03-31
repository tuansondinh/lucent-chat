# Lucent Code Studio

<div align="center">

**Voice-enabled AI chat desktop application with multi-pane support**

Built with Electron + React + TypeScript + Python

</div>

---

## Overview

Lucent Code is a desktop AI chat application with voice input/output capabilities, multi-pane chat sessions, file browsing, and integrated terminal. It runs locally on your machine and connects to AI providers for conversations.

### Key Features

- **Multi-pane chat** — Split into up to 4 independent chat panes (horizontal or vertical), each with its own agent process
- **Per-pane permission modes** — Each pane can independently set tool access levels (full/confirm/auto)
- **Voice input/output** — Real-time speech-to-text and text-to-speech via Python audio service
- **File browsing** — Built-in file explorer and viewer with syntax highlighting
- **Session management** — Create, rename, and delete chat sessions
- **Model switching** — Support for multiple AI providers (Claude, OpenAI, local models)
- **Integrated terminal** — On-demand terminal panel for command-line operations
- **Token optimization (RTK)** — Automatic bash command rewriting for 60-90% token savings (optional, install separately)
- **Subagent visibility** — Real-time tool call progress for subagents (bounded display with collapsible summary)
- **Context controls** — Built-in `/clear` and `/compact` chat commands, plus context usage shown in the UI
- **Command palette** — Quick access to all features via Cmd+K

---

## Quick Start

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **Python** 3.12+ for local voice development
- **npm** or **yarn**
- **macOS**, **Linux**, or **Windows**

### Easy Setup (3 steps)

#### 1. Install dependencies

```bash
# From the studio directory
npm install
```

#### 2. Install Python voice dependencies

```bash
# Create a local audio-service env and install the pinned dependencies
uv venv audio-service/.venv --python 3.12
uv pip install --python audio-service/.venv/bin/python -r <(python - <<'PY'
import tomllib, pathlib
deps = tomllib.loads(pathlib.Path('audio-service/pyproject.toml').read_text())['project']['dependencies']
print('\n'.join(deps))
PY
)
```

#### 3. Start the application

```bash
# Development mode (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

That's it! The app will open and you can start chatting.

---

## Project Structure

```
studio/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts              # Entry point, window creation
│   │   ├── agent-bridge.ts       # Agent process communication
│   │   ├── voice-service.ts      # Voice sidecar management
│   │   ├── orchestrator.ts       # Chat orchestration logic
│   │   ├── session-service.ts    # Session persistence
│   │   ├── file-service.ts       # File system operations
│   │   ├── git-service.ts        # Git integration
│   │   ├── terminal-manager.ts   # Terminal panel management
│   │   ├── auth-service.ts       # API key management
│   │   ├── settings-service.ts   # User settings persistence
│   │   ├── pane-manager.ts       # Multi-pane state management
│   │   ├── process-manager.ts    # Agent process lifecycle
│   │   └── ipc-handlers.ts       # IPC communication bridge
│   │
│   ├── preload/           # Electron preload scripts
│   │   └── index.cjs             # Exposed APIs to renderer
│   │
│   └── renderer/          # React UI
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # Root component
│       ├── components/           # React components
│       │   ├── ChatPane.tsx      # Chat pane container
│       │   ├── ChatInput.tsx     # Message input with voice
│       │   ├── ChatMessage.tsx   # Message display
│       │   ├── Sidebar.tsx       # Session list sidebar
│       │   ├── FileTree.tsx      # File explorer
│       │   ├── FileViewer.tsx    # File content viewer
│       │   ├── Terminal.tsx      # Terminal panel
│       │   ├── ModelPicker.tsx   # Model selection
│       │   ├── Settings.tsx      # Settings dialog
│       │   ├── CommandPalette.tsx # Cmd+K command palette
│       │   ├── StatusBar.tsx     # Bottom status bar
│       │   └── Onboarding.tsx    # First-run experience
│       ├── lib/                  # Utilities
│       │   ├── useVoice.ts       # Voice feature hook
│       │   ├── models.ts         # Model helpers
│       │   ├── highlighter.ts    # Syntax highlighting
│       │   ├── time.ts           # Time formatting
│       │   ├── pane-refs.ts      # Pane focus management
│       │   └── theme/            # Design tokens
│       └── store/                # State management
│           ├── pane-store.ts     # Multi-pane layout state
│           ├── file-tree-store.ts # File tree state
│           ├── chat.ts           # Chat messages state
│           └── voice-store.ts    # Voice state
│
├── audio-service/        # Python voice sidecar project
│   ├── audio_service.py          # STT/TTS WebSocket service
│   └── pyproject.toml            # Pinned Python runtime dependencies
│
└── package.json
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Cmd+N` | New session |
| `Cmd+B` | Toggle sidebar |
| `Cmd+E` | Toggle file explorer |
| `Cmd+Shift+F` | Toggle file viewer |
| `Cmd+\`` | Toggle terminal |
| `Cmd+M` | Open model picker |
| `Cmd+,` | Open settings |
| `Cmd+D` | Split pane horizontally |
| `Cmd+Shift+D` | Split pane vertically |
| `Cmd+W` | Close active pane |
| `Cmd+1-4` | Focus pane 1-4 |
| `Cmd+Option+Arrow` | Navigate between panes |
| `Escape` | Close modals/palettes |

---

## Release

### One-command release (arm64)

```bash
# Build unsigned, no notarization, zip, then create GitHub release
npm run release:arm64

# Also sign and notarize with Apple (~5 min extra, removes Gatekeeper warning)
npm run release:arm64:notarize

# Useful isolation path if voice/audio is blocking signing
npm run release:arm64:no-audio:notarize

# Dry run — build unsigned zip but skip GitHub upload
npm run release:arm64:dry
```

### Prerequisites (one-time setup)

1. **`gh` CLI** — `brew install gh && gh auth login`
2. **Developer ID cert** (for `--notarize` only) — install from [developer.apple.com](https://developer.apple.com/account/resources/certificates/list) → Developer ID Application
3. **Notarization credentials** (for `--notarize` only):
   ```bash
   xcrun notarytool store-credentials "lucent-code-notary" \
     --apple-id "tuansondinh96@gmail.com" \
     --team-id "34UMY69QMK"
   ```

### Bump version

Edit `version` in `package.json`, then run `npm run release:arm64`.

### Release Learnings

- Keep the packaged app self-contained. The runtime now builds into `apps/studio/build/runtime-bundle` and is copied into the app from there, rather than packaging directly from a workspace package output.
- Code signing fails on app-bundle symlinks that point outside the app. The original blocker was absolute/workspace symlinks inside `runtime/node_modules` and later inside `audio-service/.venv-release/bin/python`.
- The audio sidecar must keep its Python launcher shims relative to the bundled `python-runtime`. Absolute links back into `~/.local/share/uv` or another host path will invalidate signing/notarization.
- `npm run release:arm64:no-audio:notarize` is the fastest isolation path when you need to prove the main Electron app and agent runtime are signable before debugging audio packaging.
- If `v<version>` already exists on GitHub, `gh release create` will fail after the build succeeds. In that case, upload the new assets instead of rebuilding:

```bash
gh release upload v1.0.1 \
  "apps/studio/release/Lucent Code-1.0.1-arm64-mac.zip" \
  "apps/studio/release/latest-mac.yml" \
  --repo tuansondinh/lucent-code \
  --clobber
```

- For a release-bundle sanity check, run the packaged sidecar directly and wait for `VOICE_SERVICE_READY`:

```bash
APP="release/mac-arm64/Lucent Code.app/Contents/Resources/audio-service"
PYTHONPATH="$APP/.venv-release/lib/python3.12/site-packages" \
"$APP/python-runtime/bin/python3.12" "$APP/audio_service.py"
```

### Keep It Simple

- Use `npm run pack:arm64` for the fastest local Apple Silicon smoke build. It skips notarization explicitly and is the quickest way to validate bundle layout.
- Prefer resource-presence checks over Electron packaging flags for bundled sidecars.
- Launch the bundled Python runtime in place. Copying `audio-service/` to `/tmp` adds failure modes and can break embedded-runtime assumptions.
- If release speed becomes a recurring problem, the biggest remaining cost is deep-signing the Python sidecar payload.

---

## Development

### Available Scripts

```bash
# Development
npm run dev          # Start with hot reload

# Building
npm run build        # Build for production
npm run build:dev    # Build with dev tools

# Distribution
npm run pack:arm64   # Build unsigned arm64 .app (fast, no signing)
npm run dist:mac:arm64   # Build signed arm64 DMG + zip

# Linting
npm run lint         # ESLint
npm run lint:fix     # Auto-fix issues

# Testing
npm run test         # Run tests
npm run test:watch   # Watch mode
```

### Running with PWA

The app serves a built PWA on port **8788** via `WebBridgeServer`. Tailscale tunnels this to your MagicDNS HTTPS URL.
**Note:** `WebBridgeServer` is opt-in and strictly gated; it only starts when **Remote Access** is enabled in the app Settings (`remoteAccessEnabled: true`). The server authenticates all connections with a Bearer token, enforces CORS specifically for Tailscale/localhost origins, and restricts access to sensitive IPC commands.

#### Option A — standalone server (no Electron window needed)

```bash
# 1. Build the PWA (from apps/studio)
npm run build:pwa

# 2. Start the bridge server only
npm run serve
```

#### Option B — full Electron app with PWA

```bash
# 1. Build the PWA (from apps/studio)
npm run build:pwa

# 2. Start the Electron app (also starts the bridge server)
npm run dev
```

The PWA is then accessible at `http://localhost:8788` locally, or via your Tailscale MagicDNS hostname if Tailscale is running.

### Environment Variables

Create a `.env` file in the studio directory:

```env
# Development
ELECTRON_RENDERER_URL=http://localhost:5173

# Production (built-in)
# ELECTRON_RENDERER_URL=../renderer/index.html
```

### Configuration & Settings

Settings are persisted in `~/.lucent/settings.json`:

```json
{
  "rtkEnabled": false,
  "permissionMode": "accept-on-edit",
  "autoCompactThreshold": 80,
  "thinkingLevel": "auto"
}
```

**RTK Token Optimization:**
- Install: `brew install rtk`
- Enable in Settings → **Token Optimization** → "RTK (Rust Token Killer)"
- Rewrites bash commands to save 60-90% tokens (shown with ⚡ badge on tool calls)
- Requires RTK binary on PATH

**Per-Pane Permission Modes:**
- Toggle via pane header or command palette for each pane
- `danger-full-access` — Tools execute immediately
- `accept-on-edit` — CLI tools require confirmation
- `auto` — Classifier auto-approves based on safety rules

**Config Directory Migration:**
- On first run, settings are automatically migrated from `~/.gsd/` → `~/.lucent/`
- Agent config moves from `~/.gsd/agent/` → `~/.lucent/agent/`
- No manual action required

### Voice Service Development

The Python voice service runs as a separate process. To develop it:

```bash
# Ensure the published package is installed first
pip install lucent-voice-bridge

# Run voice service directly
cd audio-service
python audio_service.py

# With auto-reload
uvicorn audio_service:app --reload --port 0
```

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system architecture, component diagrams, and data flow.

---

## Troubleshooting

### Voice service not working

1. **Check Python dependencies:**
   ```bash
   python -c "import voice_bridge; print('OK')"
   ```

2. **Verify installation:**
   ```bash
   pip show lucent-voice-bridge
   ```

3. **Check release sidecar directly:**
   ```bash
   APP="release/mac-arm64/Lucent Code.app/Contents/Resources/audio-service"
   PYTHONPATH="$APP/.venv-release/lib/python3.12/site-packages" \
   "$APP/python-runtime/bin/python3.12" "$APP/audio_service.py"
   ```

4. **Check logs** — Open Developer Tools (`Cmd+Option+I`) → Console

### Can't split panes

- Maximum 4 panes allowed
- Try closing a pane first (`Cmd+W`)

### File explorer shows nothing

- Ensure you're in a git repository
- Check file service permissions in Developer Tools

### RTK not rewriting commands

1. **Verify RTK is installed:**
   ```bash
   which rtk
   rtk --version
   ```

2. **Enable token optimization:**
   - Open Settings (`Cmd+,`) → **Token Optimization** → toggle "RTK (Rust Token Killer)"

3. **Check bash interceptor is enabled:**
   - In agent settings, ensure `bashInterceptor.enabled` is true (default)

### Tools not executing in a pane

- Check the pane's permission mode (shown in pane header):
  - `danger-full-access` — should execute immediately, check agent logs
  - `accept-on-edit` — confirm when prompted
  - `auto` — review auto-mode rules in Settings → **Auto Mode**
- Toggle permission mode via pane header or Cmd+K command palette

---

## License

MIT

---

## Contributing

Contributions welcome! Please read the contributing guidelines first.
