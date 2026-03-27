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

  /** Delete a saved session by file path. */
  deleteSession: (path: string): Promise<void> =>
    ipcRenderer.invoke('cmd:delete-session', path),

  /** Get formatted message history for the current session. */
  getMessages: (): Promise<Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>> =>
    ipcRenderer.invoke('cmd:get-messages'),

  /** Get current app settings. */
  getSettings: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('cmd:get-settings'),

  /** Persist a partial settings update. Returns the full updated settings. */
  setSettings: (settings: Record<string, unknown>): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('cmd:set-settings', settings),

  /** List available models. */
  getModels: (): Promise<Array<{ provider: string; id: string }>> =>
    ipcRenderer.invoke('cmd:get-models'),

  /** Get current agent session state. */
  getState: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('cmd:get-state'),

  /** Get process health states. */
  getHealth: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('cmd:get-health'),

  /** Open a URL in the system's default browser. Only http/https allowed. */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('cmd:open-external', url),

  // -------------------------------------------------------------------------
  // Terminal commands
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
  // Events (main → renderer)
  // -------------------------------------------------------------------------

  /** Streaming text chunk from the agent. Returns unsubscribe function. */
  onAgentChunk: (cb: (data: { turn_id: string; text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:agent-chunk', handler)
    return () => ipcRenderer.removeListener('event:agent-chunk', handler)
  },

  /** Turn complete — full accumulated text. Returns unsubscribe function. */
  onAgentDone: (cb: (data: { turn_id: string; full_text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:agent-done', handler)
    return () => ipcRenderer.removeListener('event:agent-done', handler)
  },

  /** Tool execution started. Returns unsubscribe function. */
  onToolStart: (cb: (data: { turn_id: string; tool: string; input: unknown }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:tool-start', handler)
    return () => ipcRenderer.removeListener('event:tool-start', handler)
  },

  /** Tool execution ended. Returns unsubscribe function. */
  onToolEnd: (
    cb: (data: { turn_id: string; tool: string; output: unknown; isError: boolean }) => void
  ): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:tool-end', handler)
    return () => ipcRenderer.removeListener('event:tool-end', handler)
  },

  /** Turn state changed. Returns unsubscribe function. */
  onTurnState: (cb: (data: { turn_id: string; state: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:turn-state', handler)
    return () => ipcRenderer.removeListener('event:turn-state', handler)
  },

  /** Process health update. Returns unsubscribe function. */
  onHealth: (cb: (data: Record<string, string>) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:health', handler)
    return () => ipcRenderer.removeListener('event:health', handler)
  },

  /** Error from main process. Returns unsubscribe function. */
  onError: (cb: (data: { source: string; message: string }) => void): (() => void) => {
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
}


console.log('[studio] preload loaded')
contextBridge.exposeInMainWorld('bridge', bridge)

export type Bridge = typeof bridge
