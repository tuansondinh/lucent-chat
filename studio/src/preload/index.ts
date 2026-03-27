import { contextBridge, ipcRenderer } from 'electron'

/**
 * Bridge API exposed to the renderer via contextBridge.
 * Commands are invoked via ipcRenderer.invoke (returns Promise).
 * Events are received via ipcRenderer.on listeners.
 *
 * Phase 4C: All pane-specific commands take paneId as the first argument.
 * All pane-specific events now include paneId in the payload.
 */
const bridge = {
  // -------------------------------------------------------------------------
  // Commands (renderer → main) — pane-specific
  // -------------------------------------------------------------------------

  /** Submit a text prompt to a specific pane. Returns turn_id. */
  prompt: (paneId: string, text: string): Promise<string> =>
    ipcRenderer.invoke('cmd:prompt', paneId, text),

  /** Abort the current generation in a specific pane. */
  abort: (paneId: string): Promise<void> =>
    ipcRenderer.invoke('cmd:abort', paneId),

  /** Switch the active model in a specific pane. */
  switchModel: (paneId: string, provider: string, modelId: string): Promise<void> =>
    ipcRenderer.invoke('cmd:switch-model', paneId, provider, modelId),

  /** Start a new session in a specific pane. */
  newSession: (paneId: string): Promise<{ cancelled: boolean }> =>
    ipcRenderer.invoke('cmd:new-session', paneId),

  /** Switch to a saved session by file path in a specific pane. */
  switchSession: (paneId: string, sessionPath: string): Promise<{ cancelled: boolean }> =>
    ipcRenderer.invoke('cmd:switch-session', paneId, sessionPath),

  /** Rename the current session in a specific pane. */
  renameSession: (paneId: string, name: string): Promise<void> =>
    ipcRenderer.invoke('cmd:rename-session', paneId, name),

  /** List saved sessions for a specific pane. */
  getSessions: (paneId: string): Promise<Array<{ path: string; name: string; modified: number }>> =>
    ipcRenderer.invoke('cmd:get-sessions', paneId),

  /** Delete a saved session by file path for a specific pane. */
  deleteSession: (paneId: string, path: string): Promise<void> =>
    ipcRenderer.invoke('cmd:delete-session', paneId, path),

  /** Get formatted message history for the current session of a specific pane. */
  getMessages: (paneId: string): Promise<Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>> =>
    ipcRenderer.invoke('cmd:get-messages', paneId),

  /** List available models for a specific pane. */
  getModels: (paneId: string): Promise<Array<{ provider: string; id: string }>> =>
    ipcRenderer.invoke('cmd:get-models', paneId),

  /** Get current agent session state for a specific pane. */
  getState: (paneId: string): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('cmd:get-state', paneId),

  /** Get process health states for a specific pane. */
  getHealth: (paneId: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke('cmd:get-health', paneId),

  // -------------------------------------------------------------------------
  // Pane lifecycle
  // -------------------------------------------------------------------------

  /** Create a new pane (spawns a fresh agent process). Returns { paneId }. */
  paneCreate: (): Promise<{ paneId: string }> =>
    ipcRenderer.invoke('cmd:pane-create'),

  /** Close and destroy a pane. */
  paneClose: (paneId: string): Promise<void> =>
    ipcRenderer.invoke('cmd:pane-close', paneId),

  /** List all active pane IDs. */
  paneList: (): Promise<string[]> =>
    ipcRenderer.invoke('cmd:pane-list'),

  // -------------------------------------------------------------------------
  // Commands — not pane-specific
  // -------------------------------------------------------------------------

  /** Get current app settings. */
  getSettings: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('cmd:get-settings'),

  /** Persist a partial settings update. Returns the full updated settings. */
  setSettings: (settings: Record<string, unknown>): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('cmd:set-settings', settings),

  /** Open a URL in the system's default browser. Only http/https allowed. */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('cmd:open-external', url),

  /** Set the native window title bar text. */
  setWindowTitle: (title: string): Promise<void> =>
    ipcRenderer.invoke('cmd:set-window-title', title),

  // -------------------------------------------------------------------------
  // Terminal commands — not pane-specific
  // -------------------------------------------------------------------------

  /** Spawn (or re-spawn) the main terminal process. */
  terminalCreate: (): Promise<void> =>
    ipcRenderer.invoke('cmd:terminal-create'),

  /** Send raw input data to the terminal. */
  terminalInput: (data: string): Promise<void> =>
    ipcRenderer.invoke('cmd:terminal-input', { data }),

  /** Notify the pty of a terminal resize. */
  terminalResize: (cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('cmd:terminal-resize', { cols, rows }),

  /** Kill the main terminal process. */
  terminalDestroy: (): Promise<void> =>
    ipcRenderer.invoke('cmd:terminal-destroy'),

  // -------------------------------------------------------------------------
  // Events (main → renderer) — all pane-specific events include paneId
  // -------------------------------------------------------------------------

  /** Streaming text chunk from the agent. Returns unsubscribe function. */
  onAgentChunk: (cb: (data: { paneId: string; turn_id: string; text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:agent-chunk', handler)
    return () => ipcRenderer.removeListener('event:agent-chunk', handler)
  },

  /** Turn complete — full accumulated text. Returns unsubscribe function. */
  onAgentDone: (cb: (data: { paneId: string; turn_id: string; full_text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:agent-done', handler)
    return () => ipcRenderer.removeListener('event:agent-done', handler)
  },

  /** Tool execution started. Returns unsubscribe function. */
  onToolStart: (cb: (data: { paneId: string; turn_id: string; tool: string; input: unknown }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:tool-start', handler)
    return () => ipcRenderer.removeListener('event:tool-start', handler)
  },

  /** Tool execution ended. Returns unsubscribe function. */
  onToolEnd: (
    cb: (data: { paneId: string; turn_id: string; tool: string; output: unknown; isError: boolean }) => void
  ): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:tool-end', handler)
    return () => ipcRenderer.removeListener('event:tool-end', handler)
  },

  /** Turn state changed. Returns unsubscribe function. */
  onTurnState: (cb: (data: { paneId: string; turn_id: string; state: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:turn-state', handler)
    return () => ipcRenderer.removeListener('event:turn-state', handler)
  },

  /** Process health update. Returns unsubscribe function. */
  onHealth: (cb: (data: { paneId: string; states: Record<string, string> }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:health', handler)
    return () => ipcRenderer.removeListener('event:health', handler)
  },

  /** Error from main process. Returns unsubscribe function. */
  onError: (cb: (data: { paneId: string; source: string; message: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:error', handler)
    return () => ipcRenderer.removeListener('event:error', handler)
  },

  /** Terminal output data from the pty. Returns unsubscribe function. */
  onTerminalData: (cb: (data: string) => void): (() => void) => {
    const handler = (_e: any, payload: { data: string }) => cb(payload.data)
    ipcRenderer.on('event:terminal-data', handler)
    return () => ipcRenderer.removeListener('event:terminal-data', handler)
  },

  /** Thinking block started. Returns unsubscribe function. */
  onThinkingStart: (cb: (data: { paneId: string; turn_id: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:thinking-start', handler)
    return () => ipcRenderer.removeListener('event:thinking-start', handler)
  },

  /** Thinking text delta. Returns unsubscribe function. */
  onThinkingChunk: (cb: (data: { paneId: string; turn_id: string; text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:thinking-chunk', handler)
    return () => ipcRenderer.removeListener('event:thinking-chunk', handler)
  },

  /** Thinking block finalized. Returns unsubscribe function. */
  onThinkingEnd: (cb: (data: { paneId: string; turn_id: string; text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:thinking-end', handler)
    return () => ipcRenderer.removeListener('event:thinking-end', handler)
  },

  /** New text block started. Returns unsubscribe function. */
  onTextBlockStart: (cb: (data: { paneId: string; turn_id: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:text-block-start', handler)
    return () => ipcRenderer.removeListener('event:text-block-start', handler)
  },

  /** Text block finalized. Returns unsubscribe function. */
  onTextBlockEnd: (cb: (data: { paneId: string; turn_id: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:text-block-end', handler)
    return () => ipcRenderer.removeListener('event:text-block-end', handler)
  },
}


console.log('[studio] preload loaded')
contextBridge.exposeInMainWorld('bridge', bridge)

export type Bridge = typeof bridge
