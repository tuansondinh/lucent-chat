/**
 * AgentBridge — typed RPC interface over the Pi SDK agent child process.
 *
 * Communicates via JSON lines on stdin/stdout (same protocol as RpcClient).
 * Inlines a minimal JSONL line reader to avoid cross-package imports at runtime.
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

// ============================================================================
// Types (local mirrors of rpc-types to avoid runtime cross-package imports)
// ============================================================================

export interface AgentState {
  model?: { provider: string; id: string }
  permissionMode?: 'danger-full-access' | 'accept-on-edit' | 'auto'
  thinkingLevel: string
  isStreaming: boolean
  isCompacting: boolean
  autoCompactionEnabled?: boolean
  sessionFile?: string
  sessionId: string
  sessionName?: string
  messageCount: number
  pendingMessageCount: number
  extensionsReady: boolean
}

export interface ModelInfo {
  provider: string
  id: string
  contextWindow?: number
  reasoning?: boolean
}

// ============================================================================
// Inline JSONL helpers (avoids runtime import from packages/*)
// ============================================================================

function attachLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
): () => void {
  let buf = ''
  const onData = (chunk: Buffer | string) => {
    buf += chunk.toString('utf8')
    let idx: number
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line) onLine(line)
    }
  }
  stream.on('data', onData)
  return () => stream.removeListener('data', onData)
}

function serializeJsonLine(obj: unknown): string {
  return JSON.stringify(obj) + '\n'
}

// ============================================================================
// AgentBridge
// ============================================================================

export interface ApprovalRequest {
  id: string
  action: 'write' | 'edit' | 'delete' | 'move'
  path: string
  message: string
}

export interface ClassifierRequest {
  id: string
  toolName: string
  toolCallId: string
  args: any
}

export interface UiSelectRequest {
  id: string
  method: 'select'
  title: string
  options: string[]
  allowMultiple?: boolean
  timeout?: number
}

export class AgentBridge extends EventEmitter {
  private proc: ChildProcess | null = null
  private stopReading: (() => void) | null = null
  private stopExitHandler: (() => void) | null = null
  private pendingRequests = new Map<
    string,
    { resolve: (r: any) => void; reject: (e: Error) => void }
  >()
  private requestId = 0

  /** Attach to a newly spawned agent process. */
  attach(proc: ChildProcess): void {
    this.proc = proc

    if (!proc.stdout) {
      console.error('[agent-bridge] process has no stdout pipe')
      return
    }

    this.stopReading = attachLineReader(proc.stdout, (line) => {
      this.handleLine(line)
    })

    const exitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
      console.log(`[agent-bridge] agent process exited (code=${code}, signal=${signal})`)
      this.stopReading?.()
      this.stopReading = null
      this.stopExitHandler = null
      this.proc = null

      // Reject all in-flight RPC requests
      const reason = signal ? `signal ${signal}` : `code ${code}`
      const err = new Error(`Agent process exited unexpectedly (${reason})`)
      for (const [id, pending] of this.pendingRequests) {
        this.pendingRequests.delete(id)
        pending.reject(err)
      }

      // Notify any in-progress turn via the event stream so the orchestrator
      // can surface an error immediately instead of waiting 5 minutes.
      this.emit('agent-event', { type: 'agent_process_exit', reason })
    }

    proc.once('exit', exitHandler)
    this.stopExitHandler = () => proc.removeListener('exit', exitHandler)
  }

  /** Detach from the current process (called before re-attaching to a new one). */
  detach(): void {
    // Remove the exit handler first so the intentional detach doesn't
    // trigger the "agent_process_exit" error event in the orchestrator.
    this.stopExitHandler?.()
    this.stopExitHandler = null
    this.stopReading?.()
    this.stopReading = null
    this.proc = null
    // Reject pending requests
    const err = new Error('AgentBridge detached')
    for (const [id, pending] of this.pendingRequests) {
      this.pendingRequests.delete(id)
      pending.reject(err)
    }
  }

  /** Subscribe to events from the agent (AgentEvent / AgentSessionEvent). */
  onAgentEvent(handler: (event: any) => void): () => void {
    this.on('agent-event', handler)
    return () => this.off('agent-event', handler)
  }

  // =========================================================================
  // RPC commands
  // =========================================================================

  /** Send a user prompt. Returns immediately; events stream asynchronously. */
  async prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }, images?: Array<{ type: 'image'; data: string; mimeType: string }>): Promise<void> {
    await this.send({ type: 'prompt', message: text, streamingBehavior: options?.streamingBehavior, images })
  }

  /** Abort the current generation. */
  async abort(): Promise<void> {
    await this.send({ type: 'abort' })
  }

  /** Change model. */
  async setModel(provider: string, modelId: string): Promise<void> {
    await this.send({ type: 'set_model', provider, modelId })
  }

  /** Start a new session. */
  async newSession(): Promise<{ cancelled: boolean }> {
    const resp = await this.send({ type: 'new_session' })
    return this.getData(resp)
  }

  /** Switch to a saved session file. */
  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const resp = await this.send({ type: 'switch_session', sessionPath })
    return this.getData(resp)
  }

  /** Get current session state. */
  async getState(): Promise<AgentState> {
    const resp = await this.send({ type: 'get_state' })
    return this.getData(resp)
  }

  /** Get all messages in current session. */
  async getMessages(): Promise<any[]> {
    const resp = await this.send({ type: 'get_messages' })
    return this.getData<{ messages: any[] }>(resp).messages
  }

  /** Set a display name for the current session. */
  async setSessionName(name: string): Promise<void> {
    await this.send({ type: 'set_session_name', name })
  }

  /** List available models. */
  async getAvailableModels(): Promise<ModelInfo[]> {
    const resp = await this.send({ type: 'get_available_models' })
    return this.getData<{ models: ModelInfo[] }>(resp).models
  }

  /** Change the permission mode on the live agent without restarting. */
  async setPermissionMode(mode: 'danger-full-access' | 'accept-on-edit' | 'auto'): Promise<void> {
    await this.send({ type: 'set_permission_mode', mode })
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private handleLine(line: string): void {
    let data: any
    try {
      data = JSON.parse(line)
    } catch {
      // Ignore non-JSON
      return
    }

    // Check for a response correlated to a pending request
    if (data.type === 'response' && data.id && this.pendingRequests.has(data.id)) {
      const pending = this.pendingRequests.get(data.id)!
      this.pendingRequests.delete(data.id)
      pending.resolve(data)
      return
    }

    // Intercept approval requests — emit so the host can show a modal,
    // then write the response back to the agent's stdin.
    if (data.type === 'approval_request' && typeof data.id === 'string') {
      this.emit('approval-request', data as ApprovalRequest)
      return
    }

    // Intercept classifier requests — emit so the host can evaluate,
    // then write the response back to the agent's stdin.
    if (data.type === 'classifier_request' && typeof data.id === 'string') {
      this.emit('classifier-request', data as ClassifierRequest)
      return
    }

    // Intercept select UI requests — emit so the host can show interactive UI
    if (data.type === 'extension_ui_request' && data.method === 'select' && typeof data.id === 'string') {
      this.emit('ui-select-request', data as UiSelectRequest)
      return
    }

    // Otherwise treat as an event and broadcast
    this.emit('agent-event', data)
  }

  /**
   * Send an approval response back to the agent stdin.
   * Called by ipc-handlers after the user makes a decision in the modal.
   */
  respondToApproval(id: string, approved: boolean): void {
    if (!this.proc?.stdin) {
      console.warn('[agent-bridge] respondToApproval: no agent process stdin available')
      return
    }
    const msg = serializeJsonLine({ type: 'approval_response', id, approved })
    this.proc.stdin.write(msg)
    this.emit('approval-responded', { id, approved })
  }

  /**
   * Send a UI select response back to the agent stdin.
   * Called by ipc-handlers after the user makes a selection in the UI.
   */
  respondToUiSelect(id: string, selected: string | string[]): void {
    if (!this.proc?.stdin) {
      console.warn('[agent-bridge] respondToUiSelect: no agent process stdin available')
      return
    }
    const msg = serializeJsonLine({ type: 'extension_ui_response', id, selected })
    this.proc.stdin.write(msg)
  }

  /**
   * Send a classifier response back to the agent stdin.
   * Called by ipc-handlers after the host evaluates rules or calls the classifier LLM.
   */
  respondToClassifier(id: string, approved: boolean): void {
    if (!this.proc?.stdin) {
      console.warn('[agent-bridge] respondToClassifier: no agent process stdin available')
      return
    }
    const msg = serializeJsonLine({ type: 'classifier_response', id, approved })
    this.proc.stdin.write(msg)
    this.emit('classifier-responded', { id, approved })
  }

  private send(command: Record<string, unknown>): Promise<any> {
    if (!this.proc?.stdin) {
      return Promise.reject(new Error('AgentBridge: no agent process attached'))
    }

    const id = `req_${++this.requestId}`
    const fullCommand = { ...command, id }

    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`AgentBridge: timeout waiting for response to ${command.type as string}`))
      }, 30_000)

      this.pendingRequests.set(id, {
        resolve: (resp) => {
          clearTimeout(timeout)
          resolve(resp)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        },
      })

      this.proc!.stdin!.write(serializeJsonLine(fullCommand))
    })
  }

  private getData<T = any>(response: any): T {
    if (!response.success) {
      throw new Error(response.error ?? 'Unknown RPC error')
    }
    return response.data as T
  }
}
