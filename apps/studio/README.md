# Lucent Code Studio

<div align="center">

**Voice-enabled AI chat desktop application with multi-pane support**

Built with Electron + React + TypeScript + Python

</div>

---

## Overview

Lucent Code is a desktop AI chat application with voice input/output capabilities, multi-pane chat sessions, file browsing, and integrated terminal. It runs locally on your machine and connects to AI providers for conversations.

### Key Features

- **Multi-pane chat** — Split into up to 4 independent chat panes (horizontal or vertical)
- **Voice input/output** — Real-time speech-to-text and text-to-speech via Python audio service
- **File browsing** — Built-in file explorer and viewer with syntax highlighting
- **Session management** — Create, rename, and delete chat sessions
- **Model switching** — Support for multiple AI providers (Claude, OpenAI, local models)
- **Integrated terminal** — On-demand terminal panel for command-line operations
- **Subagent visibility** — Real-time tool call progress for subagents (bounded display with collapsible summary)
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

### Release Voice Learnings

- Detect the packaged voice bundle by checking `process.resourcesPath/audio-service`, not only `electron.app.isPackaged`.
- Launch the bundled Python runtime in place. Copying `audio-service/` to `/tmp` adds failure modes and can break embedded-runtime assumptions.
- Keep startup minimal: VAD + STT should be enough to reach `VOICE_SERVICE_READY`. Load TTS lazily so a Kokoro/espeak packaging problem does not take down voice input.
- For a release-bundle sanity check, run the packaged sidecar directly and wait for `VOICE_SERVICE_READY`:

```bash
APP="release/mac-arm64/Lucent Code.app/Contents/Resources/audio-service"
PYTHONPATH="$APP/.venv-release/lib/python3.12/site-packages" \
"$APP/python-runtime/bin/python3.12" "$APP/audio_service.py"
```

### Keep It Simple

- Use `npm run pack:arm64` for the fastest local Apple Silicon smoke build. It now skips signing and notarization explicitly.
- Treat STT/VAD as required and TTS as optional at startup. That keeps release failures narrower and much easier to debug.
- Prefer resource-presence checks over Electron packaging flags for bundled sidecars.
- If we want a larger simplification later, the best target is separating TTS into its own optional service or replacing the embedded Python layout with a single frozen binary.

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

---

## License

MIT

---

## Contributing

Contributions welcome! Please read the contributing guidelines first.
