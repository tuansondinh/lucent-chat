import { contextBridge, ipcRenderer } from 'electron'

/**
 * Bridge API exposed to the renderer via contextBridge.
 * Commands are invoked via ipcRenderer.invoke (returns Promise).
 * Events are received via ipcRenderer.on listeners.
 */
const bridge = {
  // -------------------------------------------------------------------------
  // Commands (renderer → main)
  // -------------------------------------------------------------------------

  /** Submit a text prompt. Returns turn_id. */
  prompt: (text: string): Promise<string> =>
    ipcRenderer.invoke('cmd:prompt', text),

  /** Abort the current generation. */
  abort: (): Promise<void> =>
    ipcRenderer.invoke('cmd:abort'),

  /** Switch the active model. */
  switchModel: (provider: string, modelId: string): Promise<void> =>
    ipcRenderer.invoke('cmd:switch-model', provider, modelId),

  /** Start a new session. */
  newSession: (): Promise<{ cancelled: boolean }> =>
    ipcRenderer.invoke('cmd:new-session'),

  /** Switch to a saved session by file path. */
  switchSession: (sessionPath: string): Promise<{ cancelled: boolean }> =>
    ipcRenderer.invoke('cmd:switch-session', sessionPath),

  /** Rename the current session. */
  renameSession: (name: string): Promise<void> =>
    ipcRenderer.invoke('cmd:rename-session', name),

  /** List saved sessions. */
  getSessions: (): Promise<Array<{ path: string; name: string; modified: number }>> =>
    ipcRenderer.invoke('cmd:get-sessions'),

  /** List available models. */
  getModels: (): Promise<Array<{ provider: string; id: string }>> =>
    ipcRenderer.invoke('cmd:get-models'),

  /** Get current agent session state. */
  getState: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('cmd:get-state'),

  /** Get process health states. */
  getHealth: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('cmd:get-health'),

  // -------------------------------------------------------------------------
  // Events (main → renderer)
  // -------------------------------------------------------------------------

  /** Streaming text chunk from the agent. */
  onAgentChunk: (cb: (data: { turn_id: string; text: string }) => void): void =>
    void ipcRenderer.on('event:agent-chunk', (_e, data) => cb(data)),

  /** Turn complete — full accumulated text. */
  onAgentDone: (cb: (data: { turn_id: string; full_text: string }) => void): void =>
    void ipcRenderer.on('event:agent-done', (_e, data) => cb(data)),

  /** Tool execution started. */
  onToolStart: (cb: (data: { turn_id: string; tool: string; input: unknown }) => void): void =>
    void ipcRenderer.on('event:tool-start', (_e, data) => cb(data)),

  /** Tool execution ended. */
  onToolEnd: (
    cb: (data: { turn_id: string; tool: string; output: unknown; isError: boolean }) => void
  ): void => void ipcRenderer.on('event:tool-end', (_e, data) => cb(data)),

  /** Turn state changed. */
  onTurnState: (cb: (data: { turn_id: string; state: string }) => void): void =>
    void ipcRenderer.on('event:turn-state', (_e, data) => cb(data)),

  /** Process health update. */
  onHealth: (cb: (data: Record<string, string>) => void): void =>
    void ipcRenderer.on('event:health', (_e, data) => cb(data)),

  /** Error from main process. */
  onError: (cb: (data: { source: string; message: string }) => void): void =>
    void ipcRenderer.on('event:error', (_e, data) => cb(data)),

  /** Remove all listeners for a given channel. */
  removeAllListeners: (channel: string): void =>
    void ipcRenderer.removeAllListeners(channel),
}

console.log('[studio] preload loaded')
contextBridge.exposeInMainWorld('bridge', bridge)

export type Bridge = typeof bridge
