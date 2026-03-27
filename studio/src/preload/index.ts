import { contextBridge, ipcRenderer } from 'electron'

// Provider auth status shape — mirrored from auth-service.ts
interface ProviderAuthStatus {
  id: string
  label: string
  configured: boolean
  configuredVia: 'auth_file' | 'environment' | null
  removeAllowed: boolean
  recommended?: boolean
  supportsApiKey: boolean
  supportsOAuth: boolean
}

export type GitChangeStatus = 'M' | 'A' | 'D' | 'R' | '??' | 'U'

export interface GitChangedFile {
  path: string
  status: GitChangeStatus
  previousPath?: string
}

export interface GitFileDiff {
  path: string
  status: GitChangeStatus
  previousPath?: string
  isBinary: boolean
  diffText: string | null
}

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

  /** Validate an API key via HTTP and save it atomically. Returns ok, message, updated statuses. */
  validateAndSaveProviderKey: (
    providerId: string,
    apiKey: string,
  ): Promise<{ ok: boolean; message: string; providerStatuses: ProviderAuthStatus[] }> =>
    ipcRenderer.invoke('cmd:validate-and-save-provider-key', providerId, apiKey),

  /** Remove all API key credentials for a provider. Returns updated statuses. */
  removeProviderKey: (providerId: string): Promise<ProviderAuthStatus[]> =>
    ipcRenderer.invoke('cmd:remove-provider-key', providerId),

  /** Get rich auth status for all providers. */
  getProviderAuthStatus: (): Promise<ProviderAuthStatus[]> =>
    ipcRenderer.invoke('cmd:get-provider-auth-status'),

  /** Get the static provider catalog (id, label, keyPlaceholder, recommended, supportsApiKey, supportsOAuth). */
  getProviderCatalog: (): Promise<Array<{ id: string; label: string; keyPlaceholder?: string; recommended?: boolean; supportsApiKey: boolean; supportsOAuth: boolean }>> =>
    ipcRenderer.invoke('cmd:get-provider-catalog'),

  /** Start an OAuth login flow. Long-running — resolves when complete. */
  oauthStart: (providerId: string): Promise<{ ok: boolean; message: string; providerStatuses: ProviderAuthStatus[] }> =>
    ipcRenderer.invoke('cmd:oauth-start', providerId),

  /** Submit a pasted code for an in-flight OAuth code-paste flow. */
  oauthSubmitCode: (providerId: string, code: string): Promise<void> =>
    ipcRenderer.invoke('cmd:oauth-submit-code', providerId, code),

  /** Cancel an in-flight OAuth flow. */
  oauthCancel: (providerId: string): Promise<void> =>
    ipcRenderer.invoke('cmd:oauth-cancel', providerId),

  /** OAuth progress event (browser open, device code, awaiting input, generic progress). */
  onOAuthProgress: (
    cb: (data: {
      providerId: string
      type: 'open_browser' | 'awaiting_input' | 'awaiting_code' | 'progress'
      url?: string
      instructions?: string
      message?: string
      placeholder?: string
      allowEmpty?: boolean
    }) => void
  ): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:oauth-progress', handler)
    return () => ipcRenderer.removeListener('event:oauth-progress', handler)
  },

  // -------------------------------------------------------------------------
  // File system commands — pane-scoped
  // -------------------------------------------------------------------------

  /** List directory contents within the pane's project root. */
  fsListDir: (paneId: string, relativePath: string): Promise<{ entries: { name: string; type: 'file' | 'directory' }[]; truncated: boolean }> =>
    ipcRenderer.invoke('cmd:fs-list-dir', paneId, relativePath),

  /** Read a file within the pane's project root. */
  fsReadFile: (paneId: string, relativePath: string): Promise<{ content: string; size: number; truncated: boolean; isBinary: boolean }> =>
    ipcRenderer.invoke('cmd:fs-read-file', paneId, relativePath),

  /** Subscribe to filesystem changes under a pane's current project root. */
  onFileChanged: (
    cb: (data: {
      paneId: string
      changes: Array<{ relativePath: string | null; eventType: 'change' | 'rename' | 'root' }>
    }) => void,
  ): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:file-changed', handler)
    return () => ipcRenderer.removeListener('event:file-changed', handler)
  },

  /** Get the current git branch for a pane's project root. */
  gitBranch: (paneId: string): Promise<string | null> =>
    ipcRenderer.invoke('cmd:git-branch', paneId),

  /** List local git branches for a pane's project root. */
  gitListBranches: (paneId: string): Promise<{ current: string | null; branches: string[] }> =>
    ipcRenderer.invoke('cmd:git-list-branches', paneId),

  /** Switch the current pane's repository to another branch. */
  gitCheckoutBranch: (paneId: string, branch: string): Promise<string | null> =>
    ipcRenderer.invoke('cmd:git-checkout-branch', paneId, branch),

  /** Get the resolved project root path for a pane. */
  gitProjectRoot: (paneId: string): Promise<string> =>
    ipcRenderer.invoke('cmd:git-project-root', paneId),

  /** Get list of modified/untracked files for a pane's project root. */
  gitModifiedFiles: (paneId: string): Promise<string[]> =>
    ipcRenderer.invoke('cmd:git-modified-files', paneId),

  /** Get changed files with Git status metadata for a pane's project root. */
  gitChangedFiles: (paneId: string): Promise<GitChangedFile[]> =>
    ipcRenderer.invoke('cmd:git-changed-files', paneId),

  /** Get the unified diff for a specific file against HEAD. */
  gitFileDiff: (paneId: string, relativePath: string): Promise<GitFileDiff | null> =>
    ipcRenderer.invoke('cmd:git-file-diff', paneId, relativePath),

  /** Get pane info including project root. */
  getPaneInfo: (paneId: string): Promise<{ paneId: string; projectRoot: string }> =>
    ipcRenderer.invoke('cmd:get-pane-info', paneId),

  /** Set the project root for a pane's file browsing context. */
  setPaneRoot: (paneId: string, absolutePath: string): Promise<{ projectRoot: string }> =>
    ipcRenderer.invoke('cmd:set-pane-root', paneId, absolutePath),

  /** Open native folder picker dialog. Returns selected path or null if cancelled. */
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('cmd:pick-folder'),

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

  // -------------------------------------------------------------------------
  // Subagent commands — pane-scoped
  // -------------------------------------------------------------------------

  /** Spawn a subagent for a parent turn. Returns subagentId. */
  subagentSpawn: (paneId: string, parentTurnId: string, agentType: string, prompt: string): Promise<string> =>
    ipcRenderer.invoke('cmd:subagent-spawn', paneId, parentTurnId, agentType, prompt),

  /** List all tracked subagents. */
  subagentList: (paneId: string): Promise<Array<{ id: string; parentTurnId: string; agentType: string; prompt: string; status: string; startedAt: number; endedAt?: number }>> =>
    ipcRenderer.invoke('cmd:subagent-list', paneId),

  /** Abort a subagent by ID. */
  subagentAbort: (paneId: string, subagentId: string): Promise<void> =>
    ipcRenderer.invoke('cmd:subagent-abort', paneId, subagentId),

  // -------------------------------------------------------------------------
  // Subagent events (main → renderer)
  // -------------------------------------------------------------------------

  /** Subagent streaming chunk. */
  onSubagentChunk: (cb: (data: { paneId: string; turn_id: string; subagentId: string; text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:subagent-chunk', handler)
    return () => ipcRenderer.removeListener('event:subagent-chunk', handler)
  },

  /** Subagent tool call started. */
  onSubagentToolStart: (cb: (data: { paneId: string; turn_id: string; subagentId: string; tool: string; input: unknown }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:subagent-tool-start', handler)
    return () => ipcRenderer.removeListener('event:subagent-tool-start', handler)
  },

  /** Subagent tool call ended. */
  onSubagentToolEnd: (cb: (data: { paneId: string; turn_id: string; subagentId: string; tool: string; output: unknown; isError: boolean }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:subagent-tool-end', handler)
    return () => ipcRenderer.removeListener('event:subagent-tool-end', handler)
  },

  /** Subagent completed. */
  onSubagentDone: (cb: (data: { paneId: string; turn_id: string; subagentId: string; full_text: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:subagent-done', handler)
    return () => ipcRenderer.removeListener('event:subagent-done', handler)
  },

  /** Subagent status changed. */
  onSubagentState: (cb: (data: { paneId: string; turn_id: string; subagentId: string; status: string }) => void): (() => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('event:subagent-state', handler)
    return () => ipcRenderer.removeListener('event:subagent-state', handler)
  },

  // -------------------------------------------------------------------------
  // Voice — not pane-specific (sidecar is app-global)
  // Phase 2 wires the main-process IPC handlers; these are the renderer-side stubs.
  // -------------------------------------------------------------------------

  /** Check whether Python and voice_bridge are available on this machine. */
  voiceProbe: (): Promise<{ available: boolean; reason?: string }> =>
    ipcRenderer.invoke('cmd:voice-probe'),

  /** Start the audio service sidecar. Resolves with the port it bound to. */
  voiceStart: (): Promise<{ port: number }> =>
    ipcRenderer.invoke('cmd:voice-start'),

  /** Stop the audio service sidecar. */
  voiceStop: (): Promise<void> =>
    ipcRenderer.invoke('cmd:voice-stop'),

  /** Get the current voice service status snapshot. */
  voiceStatus: (): Promise<{ available: boolean; state: string; port: number | null }> =>
    ipcRenderer.invoke('cmd:voice-status'),

  // -------------------------------------------------------------------------
  // Voice events (main → renderer)
  // -------------------------------------------------------------------------

  /** Subscribe to voice service status changes. Returns unsubscribe function. */
  onVoiceStatus: (
    cb: (data: { available: boolean; state: string; port: number | null }) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { available: boolean; state: string; port: number | null }) => cb(data)
    ipcRenderer.on('event:voice-status', handler)
    return () => ipcRenderer.removeListener('event:voice-status', handler)
  },
}


console.log('[studio] preload loaded')
contextBridge.exposeInMainWorld('bridge', bridge)

export type Bridge = typeof bridge
