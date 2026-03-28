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
│  │  ┌──────────────────┐  ┌──────────────────┐                  │ │
│  │  │ AgentBridge      │  │ VoiceService     │                  │ │
│  │  │ • Spawn proc     │  │ • Start sidecar  │                  │ │
│  │  │ • SendMessage    │  │ • WebSocket      │                  │ │
│  │  │ • GetState       │  │ • Probe deps     │                  │ │
│  │  └──────────────────┘  └──────────────────┘                  │ │
│  │  ┌──────────────────┐  ┌──────────────────┐                  │ │
│  │  │ SessionService   │  │ FileService      │                  │ │
│  │  │ • Create/Load    │  │ • Read files     │                  │ │
│  │  │ • Save/Update    │  │ • Git status     │                  │ │
│  │  │ • Delete         │  │ • Search         │                  │ │
│  │  └──────────────────┘  └──────────────────┘                  │ │
│  │  ┌──────────────────┐  ┌──────────────────┐                  │ │
│  │  │ PaneManager      │  │ Orchestrator     │                  │ │
│  │  │ • Create pane    │  │ • Route chunks   │                  │ │
│  │  │ • Close pane     │  │ • Extract TTS    │                  │ │
│  │  │ • Track layout   │  │ • Handle events  │                  │ │
│  │  └──────────────────┘  └──────────────────┘                  │ │
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

### File System Access

- Sandboxed to user-selected directories
- Git operations read-only by default
- File writes require explicit user action

---

## Future Enhancements

- [ ] Shared panes (collaborative editing)
- [ ] Custom pane layouts (saved configurations)
- [ ] Plugin system for custom tools
- [ ] Local LLM support (Ollama, LM Studio)
- [ ] Multi-language TTS/STT
- [ ] Voice commands for UI control
- [ ] Cloud sync for sessions
