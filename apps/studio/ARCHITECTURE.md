# Lucent Code Architecture

<div align="center">

**System architecture, component diagrams, and data flow**

</div>

---

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [Component Overview](#component-overview)
- [Data Flow](#data-flow)
- [Voice Service](#voice-service)
- [Multi-Pane System](#multi-pane-system)
- [State Management](#state-management)
- [IPC Communication](#ipc-communication)
- [State Ownership & Simplification Plan](#state-ownership--simplification-plan)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Lucent Code                                   │
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐      │
│  │   Renderer   │         │ Main Process │         │  Agent Proc  │      │
│  │   (React)    │◄───────►│  (Electron)  │◄───────►│   (Python)   │      │
│  │              │  IPC    │              │  Stdio  │              │      │
│  └──────────────┘         └──────┬───────┘         └──────────────┘      │
│                                     │                                       │
│                                     ▼                                       │
│                           ┌───────────────┐                               │
│                           │ Voice Service │                               │
│                           │  (FastAPI)    │                               │
│                           │   (Python)     │                               │
│                           └───────┬───────┘                               │
│                                   │ WebSocket                              │
│                                   ▼                                        │
│                         ┌─────────────────┐                               │
│                         │  STT / TTS      │                               │
│                         │  (PyTorch)      │                               │
│                         └─────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Overview

### Renderer Process (React UI)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer (React)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Top Bar                                                  │ │
│  │  ┌─────────────┐         App Name         Health Status │ │
│  │  │ Traffic Lights│  "Lucent Code"        "connecting"    │ │
│  │  └─────────────┘                                       │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────┐  ┌─────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │Sidebar│  │Explorer │  │ Chat Panes  │  │  File Viewer  │  │
│  │       │  │         │  │             │  │               │  │
│  │ • List│  │ • Tree  │  │ ┌─────┐     │  │ • Code View   │  │
│  │ • New │  │ • Files │  │ │Pane1│     │  │ • Syntax      │  │
│  │ • ... │  │         │  │ └─────┘     │  │ • Line Num    │  │
│  │       │  │         │  │ ┌─────┐     │  │               │  │
│  │Model  │  │         │  │ │Pane2│     │  │               │  │
│  │Picker │  │         │  │ └─────┘     │  │               │  │
│  └───────┘  └─────────┘  └─────────────┘  └───────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Terminal Panel (Cmd+`)                                   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Status Bar                                               │ │
│  │  Model: claude-3-5-sonnet | Session: My Chat | Health: OK│ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Main Process Services

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Main Process (Electron)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      IPC Handlers                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │ │
│  │  │ Chat IPC     │  │ Voice IPC    │  │ File IPC     │       │ │
│  │  │ • sendMessage│  │ • start      │  │ • readFile   │       │ │
│  │  │ • getHistory │  │ • stop       │  │ • writeFile   │       │ │
│  │  │ • getState   │  │ • status     │  │ • listFiles   │       │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    Core Services                                │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │ │
│  │  │ AgentBridge      │  │ VoiceService     │  │ GitService     │ │ │
│  │  │ • Spawn proc     │  │ • Start sidecar  │  │ • Diff/Branch  │ │ │
│  │  │ • SendMessage    │  │ • WebSocket      │  │ • Git Status   │ │ │
│  │  │ • GetState       │  │ • Probe deps     │  └────────────────┘ │ │
│  │  └──────────────────┘  └──────────────────┘  ┌────────────────┐ │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  │ TerminalMgr    │ │ │
│  │  │ SessionService   │  │ FileService      │  │ • PTY Spawn    │ │ │
│  │  │ • Create/Load    │  │ • Read/Write     │  │ • I/O streams  │ │ │
│  │  │ • Save/Update    │  │ • Path bounds    │  └────────────────┘ │ │
│  │  │ • Delete         │  │ • Search         │  ┌────────────────┐ │ │
│  │  └──────────────────┘  └──────────────────┘  │ SettingsSvc    │ │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  │ • App settings │ │ │
│  │  │ PaneManager      │  │ Orchestrator     │  │ • Storage      │ │ │
│  │  │ • Create pane    │  │ • Route chunks   │  └────────────────┘ │ │
│  │  │ • Close pane     │  │ • Extract TTS    │  ┌────────────────┐ │ │
│  │  │ • Track layout   │  │ • Handle events  │  │ Auth/Tailscale │ │ │
│  │  └──────────────────┘  └──────────────────┘  │ • API Keys     │ │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  │ • MagicDNS     │ │ │
│  │  │ WebBridgeServer  │  │ ClassifierSvc    │  └────────────────┘ │ │
│  │  │ • Opt-in remote  │  │ • Static rules   │                     │ │
│  │  │ • WS/HTTP bridge │  │ • LLM validate   │                     │ │
│  │  └──────────────────┘  └──────────────────┘                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Message Flow (User → Agent)

```
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌─────────┐
│ User    │────▶│ Chat    │────▶│ IPC      │────▶│ Agent   │
│ Input   │     │ Input   │     │ Handler  │     │ Bridge  │
└─────────┘     └─────────┘     └──────────┘     └────┬────┘
                                                      │
                                                      ▼
                                               ┌───────────┐
                                               │ Agent     │
                                               │ Process   │
                                               └─────┬─────┘
                                                     │
                                    ┌────────────────┴────────────────┐
                                    ▼                                 ▼
                             ┌───────────┐                     ┌───────────┐
                             │ AI API    │                     │ Tools    │
                             │ (Claude/  │                     │ (FS/Git) │
                             │  OpenAI)  │                     └───────────┘
                             └─────┬─────┘
                                   │
                                   ▼
                            ┌───────────┐
                            │ Response  │
                            │ Chunks    │
                            └─────┬─────┘
                                  │
                                  ▼
                           ┌──────────────┐
                           │ Orchestrator │
                           │ • Parse      │
                           │ • Extract TTS│
                           │ • Format     │
                           └──────┬───────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
             ┌─────────────┐           ┌─────────────┐
             │ Chat Store  │           │ Voice Svc   │
             │ (Messages)  │           │ (TTS Queue) │
             └─────────────┘           └─────────────┘
                    │                           │
                    ▼                           ▼
             ┌─────────────┐           ┌─────────────┐
             │ UI Update   │           │ WebSocket   │
             │ (New Msg)   │           │ → Audio     │
             └─────────────┘           └─────────────┘
```

### Voice Input Flow (Mic → Text)

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│ Mic      │────▶│ WebSocket    │────▶│ Voice       │────▶│ Whisper  │
│ (Audio)  │     │ Client       │     │ Service     │     │ (STT)    │
└──────────┘     └──────────────┘     └─────────────┘     └────┬─────┘
                                                              │
                                                              ▼
                                                       ┌─────────────┐
                                                       │ Transcript  │
                                                       │ Chunks      │
                                                       └──────┬──────┘
                                                              │
                                                              ▼
                                                       ┌─────────────┐
                                                       │ Chat Input  │
                                                       │ (Real-time) │
                                                       └─────────────┘
```

### Voice Output Flow (Text → Audio)

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│ Agent    │────▶│ Orchestrator │────▶│ WebSocket    │────▶│ TTS      │
│ Response │     │ • Extract    │     │ Client       │     │ Engine   │
│          │     │   sentences  │     │              │     │          │
└──────────┘     └──────────────┘     └─────────────┘     └────┬─────┘
                                                              │
                                                              ▼
                                                       ┌─────────────┐
                                                       │ Audio       │
                                                       │ Stream      │
                                                       └──────┬──────┘
                                                              │
                                                              ▼
                                                       ┌─────────────┐
                                                       │ Web Audio   │
                                                       │ API Play    │
                                                       └─────────────┘
```

### Subagent Tool Call Visibility Flow

When a subagent runs and executes tools, the agent emits `tool_execution_update` events containing sub-tool calls and text output. These are streamed through IPC to the renderer for real-time display:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Agent       │────▶│ AgentBridge      │────▶│ IPC Event    │
│ Process     │     │ (tool_execution_ │     │ (main)       │
│             │     │  update event)   │     │              │
└─────────────┘     └──────────────────┘     └────┬─────────┘
                                                  │
                                    ┌─────────────┴────────────────┐
                                    ▼                              ▼
                             ┌───────────────────┐         ┌──────────────┐
                             │ Orchestrator      │         │ PaneManager  │
                             │ • onToolUpdate    │         │ • pushEvent  │
                             │ • Extract subItems│         │              │
                             └─────────┬─────────┘         └──────────────┘
                                       │                         │
                                       └────────────┬────────────┘
                                                    ▼
                                           ┌─────────────────────┐
                                           │ IPC: event:tool-    │
                                           │ update (preload)    │
                                           └──────────┬──────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ ChatPane Store      │
                                           │ updateToolSubItems()│
                                           │ (replace snapshot)  │
                                           └──────────┬──────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ ToolCallItem UI     │
                                           │ • Render subItems   │
                                           │ • Last 8 items      │
                                           │ • "... N earlier"   │
                                           │ • Collapse summary  │
                                           └─────────────────────┘
```

Key characteristics:
- **Snapshot updates**: Each `tool_execution_update` delivers a full snapshot of subItems (not a delta)
- **toolCallId-based matching**: Each tool tracked independently by ID, supporting concurrent same-name tools
- **Bounded display**: UI shows max 8 items with truncation indicator
- **Ephemeral state**: subItems not persisted; reloaded sessions show no sub-item history
- **Lifecycle handling**: On tool completion, subItems clear. On abort/crash, subItems freeze for debugging.

### Context Usage and Compaction Flow

The chat UI now uses structured context state from the runtime and exposes the compaction controls directly in the composer:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Agent       │────▶│ RPC get_state    │────▶│ ChatPane     │
│ Runtime     │     │ contextUsage     │     │ • ctx % UI   │
└─────────────┘     └──────────────────┘     │ • /clear     │
                                               │ • /compact   │
                                               └────┬─────────┘
                                                    │
                                                    ▼
                                           ┌──────────────────┐
                                           │ Main Process     │
                                           │ bridge.newSession│
                                           │ bridge.compact   │
                                           └──────────────────┘
```

Key characteristics:
- **Structured context usage**: `get_state` returns `contextUsage { tokens, contextWindow, percent }`, which the renderer prefers over heuristics
- **Composer commands**: `/clear` starts a fresh session; `/compact [instructions]` requests context compaction with optional guidance
- **Session name refresh**: When generation ends, the sidebar reloads sessions so auto-named sessions appear without manual refresh

---

## Voice Service

### Voice Service Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        Voice Service (Python)                      │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  FastAPI Server                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    WebSocket Handler                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │   │
│  │  │ Connection   │  │ STT Handler  │  │ TTS Handler   │     │   │
│  │  │ Management   │  │ (Whisper)    │  │ (Tacotron/    │     │   │
│  │  │              │  │              │  │  Coqui)       │     │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Core Components                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Audio Recorder   │  │ Audio Player     │  │ Turn Manager    │  │
│  │ • Stream capture │  │ • Queue play     │  │ • Context ID    │  │
│  │ • VAD detection  │  │ • Flush on stop  │  │ • Gen tracking  │  │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Voice Message Types

```typescript
// Client → Server
{
  type: 'audio_frame',      // Audio data from mic
  type: 'tts_synthesize',   // Request TTS for text
  type: 'tts_stop',         // Stop current TTS
  type: 'tts_flush',        // Flush TTS queue
}

// Server → Client
{
  type: 'transcript',       // STT result
  type: 'tts_start',        // TTS playback starting
  type: 'tts_audio',        // TTS audio frame
  type: 'tts_end',          // TTS playback ended
  type: 'voice_service_error' // Error occurred
}
```

---

## Multi-Pane System

### Pane Layout Tree

```
                    ┌─────────────────────┐
                    │      Layout Root    │
                    └──────────┬──────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
        ┌───────────────┐             ┌───────────────┐
        │   Pane 1      │             │   Pane 2      │
        │ (Leaf Node)   │             │ (Leaf Node)   │
        └───────────────┘             └───────────────┘

        After Split (Horizontal):
                    ┌─────────────────────┐
                    │      Layout Root    │
                    │   (horizontal)       │
                    └──────────┬──────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
        ┌───────────────┐             ┌───────────────┐
        │   Pane 1      │  ─────────  │   Pane 2      │
        │ (Leaf Node)   │             │ (Leaf Node)   │
        └───────────────┘             └───────────────┘
```

### Pane State Management

```typescript
// Global pane store (zustand)
interface PaneStore {
  layout: LayoutNode          // Tree structure
  activePaneId: string        // Currently focused
  splitPending: boolean       // Debounce flag

  // Per-pane stores
  paneStores: Map<string, {
    sessionPath: string
    sessionName: string
    messages: Message[]
    model: ModelRef
    agentHealth: string
    // ...
  }>
}

// Layout node types
type LayoutNode =
  | { type: 'leaf', paneId: string, id: string }
  | {
      type: 'internal',
      id: string,
      orientation: 'horizontal' | 'vertical',
      children: [LayoutNode, LayoutNode]
    }
```

---

## State Management

### Zustand Store Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                       State Stores                             │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    PaneStore                            │   │
│  │  • layout: LayoutNode                                   │   │
│  │  • activePaneId: string                                 │   │
│  │  • splitPane(paneId, newPaneId, orientation)           │   │
│  │  • removePane(paneId)                                   │   │
│  │  • setActive(paneId)                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Per-Pane Stores (dynamic)               │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ pane-1: {                                        │    │   │
│  │  │   sessionPath, sessionName,                      │    │   │
│  │  │   messages: [], model: {},                        │    │   │
│  │  │   voice: { active, speaking, ttsPlaying, ... }   │    │   │
│  │  │ }                                                 │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ pane-2: { ... }                                   │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    VoiceStore                           │   │
│  │  • available: boolean                                   │   │
│  │  • sidecarState: 'stopped' | 'starting' | 'ready' | ... │   │
│  │  • active: boolean                                      │   │
│  │  • speaking: boolean                                    │   │
│  │  • ttsPlaying: boolean                                   │   │
│  │  • partialTranscript: string                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## IPC Communication

### IPC Bridge Pattern

```
Renderer                          Main Process
───────────────────────────────────────────────────────────────────
window.bridge.sendMessage()      ┐
      │                         │    IPC Handler
      │ ────────────────────────►│    ┌─────────────────┐
      │                         │    │ 1. Get pane store│
      │                         │    │ 2. Call agent    │
      │                         │    │ 3. Update state  │
      │◄────────────────────────│    └─────────────────┘
      │    Promise<Message[]>
      │                         │
      │                         │    ┌─────────────────┐
      │                         │    │ AgentBridge     │
      │                         │───►│ • spawn         │
      │                         │    │ • sendMessage    │
      │                         │◄───│ • getState      │
      │                         │    └─────────────────┘
      │                         │
      │                         │    ┌─────────────────┐
      │                         │───►│ Agent Process   │
      │                         │    │ • Parse prompt   │
      │                         │◄───│ • Call tools     │
      │                         │    │ • Stream response│
      │                         │    └─────────────────┘
```

### Preload API Surface

```typescript
// Exposed to renderer via preload
interface BridgeAPI {
  // Chat
  sendMessage(paneId: string, text: string): Promise<void>
  getMessages(paneId: string): Promise<Message[]>
  getState(paneId: string): Promise<AgentState>
  abort(paneId: string): Promise<void>
  compact(paneId: string, customInstructions?: string): Promise<void>

  // Sessions
  getSessions(paneId: string): Promise<Session[]>
  newSession(paneId: string): Promise<{ cancelled: boolean }>
  switchSession(paneId: string, path: string): Promise<{ cancelled: boolean }>
  renameSession(paneId: string, name: string): Promise<void>
  deleteSession(paneId: string, path: string): Promise<void>

  // Panes
  paneCreate(): Promise<{ paneId: string }>
  paneClose(paneId: string): Promise<void>

  // Voice
  voiceProbe(): Promise<VoiceProbeResult>
  voiceStatus(): Promise<VoiceServiceStatus>
  voiceStart(): Promise<{ port: number }>
  voiceStop(): Promise<void>
  onVoiceStatus(callback: (status: VoiceServiceStatus) => void): () => void

  // Files
  fsReadFile(paneId: string, path: string): Promise<FileContent>
  fsListFiles(paneId: string, dir?: string): Promise<FileInfo[]>
  fsSearchFiles(paneId: string, query: string): Promise<FileInfo[]>

  // Git
  gitStatus(paneId: string): Promise<GitStatus>
  gitDiff(paneId: string, path?: string): Promise<string>

  // Settings
  getSettings(): Promise<AppSettings>
  setSettings(settings: Partial<AppSettings>): Promise<void>

  // Skills
  skillList(): Promise<SkillInfo[]>
}
```

---

## State Ownership & Simplification Plan

The current process boundaries are sound, but the app has accumulated complexity from **state crossing layers without a single clear owner**. The `autoCompactThreshold` path is the canonical example: one UI control currently touches renderer form state, app settings persistence, per-pane live runtime sync, startup bootstrap, and agent/session-side state.

### Architectural Rule

A setting should have:

1. **one owner**
2. **one persisted home**
3. **one transport path to the runtime**

If a setting needs both a persisted default and a live runtime value, the persisted value should be owned in one place and the live value should be a derived replication of that source of truth.

### State Ownership Model

| State | Owner | Persisted where | Replicated to |
| --- | --- | --- | --- |
| App preferences (`theme`, `fontSize`, `defaultModel`, `rtkEnabled`, global `autoCompactThreshold`) | Main process | `~/.lucent/settings.json` | Renderer + live panes/agents |
| Per-pane permission mode (`danger-full-access` / `accept-on-edit` / `auto`) | PaneManager | In-memory + app settings sync | Agent process env var `LUCENT_CODE_PERMISSION_MODE` |
| Pane UI state (`activePaneId`, layout, local dialog state) | Renderer | In-memory only unless explicitly restored | None |
| Session transcript and session metadata | Agent / SessionService | Session files | Renderer |
| Runtime agent config (`thinkingLevel`, effective compaction threshold, permission mode) | Main process computes, agent caches in memory | Not session-persisted unless truly session-scoped | Agent process |
| Derived runtime signals (`isCompacting`, `contextUsage`, tool progress) | Agent / Orchestrator | Usually ephemeral | Renderer |

### Scope Boundaries

To keep the system understandable, every new setting should be classified before implementation:

- **App-global setting**: one value for the whole app, persisted in `SettingsService`
- **Pane/runtime setting**: must affect a running pane immediately, but is still derived from an app-global or pane-local owner
- **Session setting**: belongs to the conversation/session itself and should reload with that session

Avoid letting the same field behave as both a global preference and a session-owned setting unless that distinction is explicit.

### Control Plane vs Data Plane

A useful mental model is to separate:

- **Control plane**: settings, pane lifecycle, permissions, runtime config, startup/bootstrap
- **Data plane**: prompts, streaming assistant chunks, tool updates, transcripts, context usage events

`autoCompactThreshold` belongs to the **control plane**. It should not need to travel through session persistence unless it is intentionally redesigned as session-specific state.

### Simplification Target for Runtime Settings

For runtime-affecting settings, prefer this flow:

```text
Renderer Settings UI
  └─ bridge.setSettings(partial)
      └─ main SettingsService.save(partial)
          └─ build effective RuntimeConfig
              └─ PaneManager syncs RuntimeConfig to all live panes
                  └─ Agent stores RuntimeConfig in memory
                      └─ runtime logic reads effective config
```

This avoids separate code paths for:

- settings persistence
- live pane fan-out from the renderer
- startup environment bootstrap as a primary config channel
- session-level persistence of values that are really global runtime preferences

### Recommended RuntimeConfig Shape

As the app grows, field-specific mutation RPCs become hard to reason about. Prefer a single runtime configuration object over a growing set of one-off setters.

```typescript
type RuntimeConfig = {
  thinkingLevel: 'off' | 'auto' | 'low' | 'medium' | 'high'
  autoCompactThreshold: number
  permissionMode: 'danger-full-access' | 'accept-on-edit' | 'auto'
  rtkEnabled?: boolean  // RTK (Rust Token Killer) token optimization
}
```

The main process should derive this from persisted settings and push it to each live pane. The agent should treat it as runtime input, not as session-owned state.

### Compaction Threshold Refactor Direction

Current complexity comes from mixing multiple responsibilities for one value. The intended simplification direction is:

1. **Keep `autoCompactThreshold` app-global by default**
   - owned by `SettingsService`
   - persisted in `~/.lucent/settings.json`
2. **Main process computes effective runtime config**
   - one function builds the config from settings
3. **PaneManager pushes config to all active panes**
   - renderer should not manually fan out per-pane threshold updates
4. **Agent stores compaction threshold in memory**
   - avoid persisting it into session settings unless per-session overrides are explicitly supported
5. **Compaction logic reads one runtime source**
   - ideally make `shouldCompact()` pure or feed it the threshold directly from a single runtime config store

### Refactor Phases

#### Phase 1 — Centralize live sync in main

- Add a `buildRuntimeConfig(settings)` helper in the main process
- Add `PaneManager.syncRuntimeConfigToAllPanes(config)`
- Have `cmd:set-settings` trigger runtime sync for affected settings
- Remove renderer-side fan-out for compaction threshold updates

#### Phase 2 — Unify agent runtime config

- Replace field-specific runtime setters where practical with a single `applyRuntimeConfig(config)` or partial equivalent
- Store runtime config in one agent-side in-memory location
- Make compaction decisions read from that single runtime config source

#### Phase 3 — Reduce bootstrap duplication

- Treat environment variables as bootstrap fallback only
- On pane startup, send a runtime config snapshot after the agent is ready
- Avoid maintaining separate “startup path” and “live update path” for the same setting unless necessary

#### Phase 4 — Keep docs aligned with ownership boundaries

When adding new settings or behaviors, document:

- who owns the value
- where it is persisted
- how it reaches live runtimes
- whether it is app-global, pane-scoped, or session-scoped

This prevents accidental re-introduction of multi-owner state.

---

## RTK Integration & Token Optimization

### RTK (Rust Token Killer)

RTK is a token-optimized CLI proxy that rewrites bash commands to save 60-90% tokens on API calls. Integration happens at the agent level through a `BashSpawnHook`.

**Installation:**
```bash
brew install rtk
```

**Settings:**
- Toggled in Studio: Settings → **Token Optimization** → "RTK (Rust Token Killer)"
- Stored in app settings: `~/.lucent/settings.json` (`rtkEnabled: boolean`)
- Synced to all live panes via `RuntimeConfig.rtkEnabled`

**Visual Indicator:**
When RTK rewrites a command, an ⚡ **RTK badge** appears on tool call headers showing the token-optimized rewrite.

### Per-Pane Permission Modes

Each pane maintains an independent permission mode controlling tool access autonomy:

| Mode | Behavior |
|------|----------|
| `danger-full-access` | Tools execute immediately without prompts |
| `accept-on-edit` | CLI tools require manual confirmation before execution |
| `auto` | Permission engine (classifier) auto-approves based on safety rules |

**UI Control:**
- Toggled via pane header or command palette
- Per-pane setting (other panes unaffected)
- Persisted in app settings, synced to each pane's agent process via env var `LUCENT_CODE_PERMISSION_MODE`

**Interaction with Auto Mode:**
When `auto` is selected, the classifier evaluates tool requests against configured safety rules (Settings → **Auto Mode**). Each rule can:
- Match by tool name (glob pattern)
- Match by capability (read-only, write, execute, etc.)
- Auto-approve or require confirmation

---

## Thread Safety & Concurrency

### Agent Process Isolation

```
Each pane runs in its own agent process:

┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Pane 1    │     │   Pane 2    │     │   Pane 3    │     │   Pane 4    │
│             │     │             │     │             │     │             │
│  Agent Proc │     │  Agent Proc │     │  Agent Proc │     │  Agent Proc │
│  (PID 101)  │     │  (PID 102)  │     │  (PID 103)  │     │  (PID 104)  │
│             │     │             │     │             │     │             │
│  Isolated   │     │  Isolated   │     │  Isolated   │     │  Isolated   │
│  State      │     │  State      │     │  State      │     │  State      │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

- Each pane has its own agent process
- Processes are isolated (no shared memory)
- Main process manages lifecycle via ProcessManager
- Clean shutdown on pane close or app exit

---

## Performance Considerations

### Optimization Strategies

1. **Virtual scrolling** for long chat histories
2. **Debounced input** for search/filter operations
3. **Lazy loading** for file tree contents
4. **WebSocket pooling** for voice service (reuses connections)
5. **Chunked responses** streamed in real-time
6. **Memoized selectors** for Zustand stores
7. **Code splitting** for large dialogs (settings, model picker)

### Memory Management

- Agent processes are killed when panes close
- WebSocket connections cleaned up on unmount
- File contents cached with LRU eviction
- Audio buffers cleared after TTS playback

---

## Security

### API Key Storage

```
Settings (keytar)     →     System Keychain
   │                              │
   │                              │
   └────────── Encrypted ──────────┘
```

- API keys stored in system keychain via `keytar`
- Never logged or exposed in IPC
- Provider-specific encryption

### File System & Agent Sandbox Access

- **Sandboxed Operations**: File operations are restricted to user-selected directories. Path traversal protection ensures files cannot be read/written outside the designated project root.
- **Git Restrictions**: Git operations are read-only by default.
- **Agent Validation**: Tool calls (e.g. bash commands or file mutations) are intercepted via the `AgentBridge`.
- **Classifier Hardening**: When set to "Auto" mode, `ClassifierService` evaluates mutating tool calls via strict local static rules before falling back to an LLM classifier. For `bash` commands, it extracts subcommands (handling command chaining, subshells, path stripping, and env stripping) to evaluate against deny rules, preventing evasion tactics.
- **Session Validation**: Session paths are strictly validated to prevent directory traversal and ensure sessions are contained within authorized locations.

### WebBridgeServer Security

- **Opt-in Only**: The WebBridgeServer is strictly opt-in and only starts when `remoteAccessEnabled` is explicitly set to `true`.
- **Authentication**: Requires a Bearer token (`remoteAccessToken`) for all API and WebSocket requests.
- **CORS & Origin Control**: Limits access to Tailscale MagicDNS origins and localhost.
- **Capability Scoping**: Remote access limits sensitive commands like terminal I/O and specific file writes to prevent escalation.

---

## Layer Review (March 2026)

The forwarding chain for an Electron message is 8 hops deep. This was reviewed to determine whether the layering is justified or represents avoidable complexity.

### Verdict: All layers are necessary

The hops decompose into **3 unavoidable structural boundaries** and **2 clean internal separations**:

| Hop | Layer | Why it exists |
| --- | --- | --- |
| Renderer → IPC | Electron process boundary | Required by Electron; renderer cannot call main-process code directly |
| IPC → Orchestrator | Turn state machine | Manages turn lifecycle, safety timeouts, response locking |
| Orchestrator → AgentBridge | RPC serialization | Typed interface over child process stdio |
| AgentBridge → [stdio] → RPC Mode | Process isolation | Agent crashes don't take down the UI; independent lifecycle |
| RPC Mode → AgentSession | Command dispatch | Translates JSON protocol to session lifecycle, history, tools |
| AgentSession → Agent | Coding layer → generic core | AgentSession adds session persistence, tools, extensions; Agent manages generic state + queues |
| Agent → AgentLoop | State/lifecycle → pure iteration | Agent owns state, abort, events; AgentLoop is a stateless streaming function |

### Key separation decisions

**`pi-agent-core` stays as a separate package**
It is a protocol/contract package (agent loop, event types, tool contract) that is not coding-specific. Extensions resolve it as a distinct module. The `CustomAgentMessages` extensibility model is the intended seam for future non-coding agents. Merging it into `pi-coding-agent` would collapse the API boundary and force all extension/tooling consumers to depend on the full coding-agent surface.

**`settings-contract.ts` stays separate from `settings-service.ts`**
`settings-service.ts` owns disk persistence and migration. `settings-contract.ts` owns renderer boundary validation and redaction (pure functions). Keeping them separate allows testing validation logic without filesystem access (`settings-contract.test.ts`).

**Classifier split is already correct**
The rule engine, caching, rate limiting, and LLM classification logic live in `ClassifierService`. The ~80 LOC remaining in `ipc-handlers.ts` is host orchestration glue (bridge wiring, approval UI fallback, reading `LUCENT.md`) that belongs near the IPC event flow.

**`pane-root-policy.ts` is wired in correctly**
`resolveRemotePaneRoot` is called in `remote-bridge-dispatch.ts` for the web/PWA bridge, where it enforces that new pane roots must stay within the original `accessRoot` subtree. The local Electron IPC handler (`cmd:set-pane-root`) uses a different and correct security model — the `approvedPaneRoots` set populated by the system folder picker dialog. Both security models are appropriate to their contexts.

### Only optional simplification

The terminal IPC handlers (`cmd:terminal-create`, `cmd:terminal-input`, `cmd:terminal-resize`, `cmd:terminal-destroy`) are close to pure forwarding and could use a small declarative registration helper. This is a cosmetic noise reduction, not a correctness issue. All other IPC handlers combine enough business logic that explicit registration is the right choice for readability and traceability.

---

## Future Enhancements

- [ ] Shared panes (collaborative editing)
- [ ] Custom pane layouts (saved configurations)
- [ ] Plugin system for custom tools
- [ ] Local LLM support (Ollama, LM Studio)
- [ ] Multi-language TTS/STT
- [ ] Voice commands for UI control
- [ ] Cloud sync for sessions
