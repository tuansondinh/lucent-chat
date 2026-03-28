/**
 * WebBridge — PWA-mode bridge implementation.
 *
 * When running as a PWA (not Electron), this class replaces window.bridge
 * by routing:
 *   - Commands  → POST /api/cmd/:name   (fetch, Bearer token auth)
 *   - Events    → WebSocket connection  (bidirectional, Bearer token in first message)
 *
 * The interface mirrors the Electron preload bridge exactly so callers
 * see no difference.
 */

import type { Bridge } from '../../../preload/index'

type EventCallback = (data: unknown) => void

// ---------------------------------------------------------------------------
// Connection status observable — for reconnecting banner UI (Task 9)
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'connected' | 'reconnecting' | 'failed' | 'reauth'

type StatusCallback = (status: ConnectionStatus) => void

// ---------------------------------------------------------------------------
// Internal WebSocket event bus
// ---------------------------------------------------------------------------

class WebEventBus {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<EventCallback>>()
  private statusListeners = new Set<StatusCallback>()
  private token: string
  private baseUrl: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private status: ConnectionStatus = 'connected'
  private hasConnectedOnce = false

  private static readonly BASE_DELAY = 1_000
  private static readonly MAX_DELAY = 30_000

  private getDelay(): number {
    return Math.min(
      WebEventBus.BASE_DELAY * Math.pow(2, this.reconnectAttempt),
      WebEventBus.MAX_DELAY,
    )
  }

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
    this.connect()
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.statusListeners.forEach((cb) => cb(next))
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.statusListeners.add(cb)
    // Emit current status immediately so subscriber is in sync
    cb(this.status)
    return () => this.statusListeners.delete(cb)
  }

  private connect(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/events'
    try {
      this.ws = new WebSocket(wsUrl)

      this.ws.addEventListener('open', () => {
        // Authenticate immediately after connect
        this.ws?.send(JSON.stringify({ type: 'auth', token: this.token }))
        this.reconnectAttempt = 0
        this.hasConnectedOnce = true
        this.setStatus('connected')
      })

      this.ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { event: string; data: unknown; error?: string }
          if (msg.event === 'auth:failed') {
            // Token rejected — show re-auth prompt, don't keep reconnecting
            this.setStatus('reauth')
            return
          }
          if (msg.event) {
            this.emit(msg.event, msg.data)
          }
        } catch {
          // Ignore malformed messages
        }
      })

      this.ws.addEventListener('close', () => {
        if (this.status === 'reauth') return // Don't retry after auth failure
        if (this.hasConnectedOnce) {
          this.setStatus('reconnecting')
        }
        const delay = this.getDelay()
        this.reconnectAttempt += 1
        this.reconnectTimer = setTimeout(() => this.connect(), delay)
      })

      this.ws.addEventListener('error', () => {
        this.ws?.close()
      })
    } catch {
      if (this.status === 'reauth') return
      if (this.hasConnectedOnce) {
        this.setStatus('reconnecting')
      }
      const delay = this.getDelay()
      this.reconnectAttempt += 1
      this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }
  }

  on(event: string, cb: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  private emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data))
  }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
  }
}

// ---------------------------------------------------------------------------
// WebBridge
// ---------------------------------------------------------------------------

export class WebBridge implements Bridge {
  private baseUrl: string
  private token: string
  private bus: WebEventBus

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
    this.bus = new WebEventBus(baseUrl, token)
  }

  // -------------------------------------------------------------------------
  // Connection status (for reconnecting banner) — Task 9
  // -------------------------------------------------------------------------

  onConnectionStatusChange(cb: (status: ConnectionStatus) => void): () => void {
    return this.bus.onStatusChange(cb)
  }

  // -------------------------------------------------------------------------
  // Internal command helper
  // -------------------------------------------------------------------------

  private async cmd<T>(name: string, ...args: unknown[]): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const res = await fetch(`${this.baseUrl}/api/cmd/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ args }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`[WebBridge] cmd:${name} failed: ${text}`)
    }
    return res.json() as Promise<T>
  }

  // -------------------------------------------------------------------------
  // Commands — pane-specific
  // -------------------------------------------------------------------------

  prompt(paneId: string, text: string): Promise<string> {
    return this.cmd('prompt', paneId, text)
  }

  abort(paneId: string): Promise<void> {
    return this.cmd('abort', paneId)
  }

  switchModel(paneId: string, provider: string, modelId: string): Promise<void> {
    return this.cmd('switch-model', paneId, provider, modelId)
  }

  newSession(paneId: string): Promise<{ cancelled: boolean }> {
    return this.cmd('new-session', paneId)
  }

  switchSession(paneId: string, sessionPath: string): Promise<{ cancelled: boolean }> {
    return this.cmd('switch-session', paneId, sessionPath)
  }

  renameSession(paneId: string, name: string): Promise<void> {
    return this.cmd('rename-session', paneId, name)
  }

  getSessions(paneId: string): Promise<Array<{ path: string; name: string; modified: number }>> {
    return this.cmd('get-sessions', paneId)
  }

  deleteSession(paneId: string, path: string): Promise<void> {
    return this.cmd('delete-session', paneId, path)
  }

  getMessages(paneId: string): Promise<Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>> {
    return this.cmd('get-messages', paneId)
  }

  getModels(paneId: string): Promise<Array<{ provider: string; id: string }>> {
    return this.cmd('get-models', paneId)
  }

  getState(paneId: string): Promise<Record<string, unknown>> {
    return this.cmd('get-state', paneId)
  }

  getHealth(paneId: string): Promise<Record<string, string>> {
    return this.cmd('get-health', paneId)
  }

  // -------------------------------------------------------------------------
  // Pane lifecycle
  // -------------------------------------------------------------------------

  paneCreate(): Promise<{ paneId: string }> {
    return this.cmd('pane-create')
  }

  paneClose(paneId: string): Promise<void> {
    return this.cmd('pane-close', paneId)
  }

  paneList(): Promise<string[]> {
    return this.cmd('pane-list')
  }

  // -------------------------------------------------------------------------
  // Commands — not pane-specific
  // -------------------------------------------------------------------------

  getSettings(): Promise<Record<string, unknown>> {
    return this.cmd('get-settings')
  }

  setSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.cmd('set-settings', settings)
  }

  openExternal(url: string): Promise<void> {
    return this.cmd('open-external', url)
  }

  setWindowTitle(_title: string): Promise<void> {
    return Promise.resolve()
  }

  setWindowWidth(_minWidth: number): Promise<void> {
    return Promise.resolve()
  }

  onAppShortcut(_cb: (data: { action: 'new-session' | 'toggle-file-viewer' }) => void): () => void {
    return () => {}
  }

  validateAndSaveProviderKey(
    providerId: string,
    apiKey: string,
  ): Promise<{ ok: boolean; message: string; providerStatuses: unknown[] }> {
    return this.cmd('validate-and-save-provider-key', providerId, apiKey)
  }

  removeProviderKey(providerId: string): Promise<unknown[]> {
    return this.cmd('remove-provider-key', providerId)
  }

  getProviderAuthStatus(): Promise<unknown[]> {
    return this.cmd('get-provider-auth-status')
  }

  getProviderCatalog(): Promise<unknown[]> {
    return this.cmd('get-provider-catalog')
  }

  oauthStart(_providerId: string): Promise<{ ok: boolean; message: string; providerStatuses: unknown[] }> {
    return Promise.reject(new Error('OAuth not available in PWA mode'))
  }

  oauthSubmitCode(_providerId: string, _code: string): Promise<void> {
    return Promise.reject(new Error('OAuth not available in PWA mode'))
  }

  oauthCancel(_providerId: string): Promise<void> {
    return Promise.resolve()
  }

  onOAuthProgress(_cb: (data: unknown) => void): () => void {
    return () => {}
  }

  // -------------------------------------------------------------------------
  // File system commands — pane-scoped (read-only allowed in PWA)
  // -------------------------------------------------------------------------

  fsListDir(paneId: string, relativePath: string): Promise<{ entries: { name: string; type: 'file' | 'directory' }[]; truncated: boolean }> {
    return this.cmd('fs-list-dir', paneId, relativePath)
  }

  fsReadFile(paneId: string, relativePath: string): Promise<{ content: string; size: number; truncated: boolean; isBinary: boolean }> {
    return this.cmd('fs-read-file', paneId, relativePath)
  }

  fsReadFull(paneId: string, relativePath: string): Promise<{ content: string; size: number; truncated: boolean; isBinary: boolean }> {
    return this.cmd('fs-read-full', paneId, relativePath)
  }

  fsWriteFile(paneId: string, relativePath: string, content: string): Promise<{ bytesWritten: number }> {
    return this.cmd('fs-write-file', paneId, relativePath, content)
  }

  onFileChanged(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:file-changed', cb)
  }

  gitBranch(paneId: string): Promise<string | null> {
    return this.cmd('git-branch', paneId)
  }

  gitListBranches(paneId: string): Promise<{ current: string | null; branches: string[] }> {
    return this.cmd('git-list-branches', paneId)
  }

  gitCheckoutBranch(paneId: string, branch: string): Promise<string | null> {
    return this.cmd('git-checkout-branch', paneId, branch)
  }

  gitProjectRoot(paneId: string): Promise<string> {
    return this.cmd('git-project-root', paneId)
  }

  gitModifiedFiles(paneId: string): Promise<string[]> {
    return this.cmd('git-modified-files', paneId)
  }

  gitChangedFiles(paneId: string): Promise<unknown[]> {
    return this.cmd('git-changed-files', paneId)
  }

  gitFileDiff(paneId: string, relativePath: string): Promise<unknown> {
    return this.cmd('git-file-diff', paneId, relativePath)
  }

  getPaneInfo(paneId: string): Promise<{ paneId: string; projectRoot: string }> {
    return this.cmd('get-pane-info', paneId)
  }

  setPaneRoot(paneId: string, absolutePath: string): Promise<{ projectRoot: string }> {
    return this.cmd('set-pane-root', paneId, absolutePath)
  }

  pickFolder(): Promise<string | null> {
    return Promise.reject(new Error('pickFolder not available in PWA mode'))
  }

  // -------------------------------------------------------------------------
  // Terminal — not available remotely
  // -------------------------------------------------------------------------

  terminalCreate(): Promise<void> {
    return Promise.reject(new Error('Terminal not available in PWA mode'))
  }

  terminalInput(_data: string): Promise<void> {
    return Promise.reject(new Error('Terminal not available in PWA mode'))
  }

  terminalResize(_cols: number, _rows: number): Promise<void> {
    return Promise.reject(new Error('Terminal not available in PWA mode'))
  }

  terminalDestroy(): Promise<void> {
    return Promise.reject(new Error('Terminal not available in PWA mode'))
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  onAgentChunk(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:agent-chunk', cb)
  }

  onAgentDone(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:agent-done', cb)
  }

  onToolStart(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:tool-start', cb)
  }

  onToolEnd(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:tool-end', cb)
  }

  onTurnState(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:turn-state', cb)
  }

  onHealth(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:health', cb)
  }

  onError(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:error', cb)
  }

  onTerminalData(_cb: (data: string) => void): () => void {
    return () => {}
  }

  onThinkingStart(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:thinking-start', cb)
  }

  onThinkingChunk(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:thinking-chunk', cb)
  }

  onThinkingEnd(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:thinking-end', cb)
  }

  onTextBlockStart(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:text-block-start', cb)
  }

  onTextBlockEnd(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:text-block-end', cb)
  }

  // -------------------------------------------------------------------------
  // Voice — forwarded through bridge server
  // -------------------------------------------------------------------------

  voiceProbe(): Promise<{ available: boolean; reason?: string }> {
    return this.cmd('voice-probe')
  }

  voiceStart(): Promise<{ port: number; token: string }> {
    return this.cmd('voice-start')
  }

  voiceStop(): Promise<void> {
    return this.cmd('voice-stop')
  }

  voiceStatus(): Promise<{ available: boolean; state: string; port: number | null; token: string | null }> {
    return this.cmd('voice-status')
  }

  onVoiceStatus(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:voice-status', cb)
  }

  // -------------------------------------------------------------------------
  // Approval RPC — bidirectional file change approval for accept-on-edit mode
  // -------------------------------------------------------------------------

  onApprovalRequest(cb: (data: unknown) => void): () => void {
    return this.bus.on('event:approval-request', cb)
  }

  approvalRespond(paneId: string, id: string, approved: boolean): Promise<void> {
    return this.cmd('approval-respond', paneId, id, approved)
  }
}
