/**
 * Orchestrator — turn state machine that coordinates between AgentBridge
 * and the renderer. Serializes concurrent inputs via a response lock.
 *
 * Phase 2: text-only path. Voice/TTS stubs reserved for Phase 4.
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AgentBridge } from './agent-bridge.js'

// ============================================================================
// Types
// ============================================================================

export type TurnState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'queued'
  | 'generating'
  | 'speaking'
  | 'playback_pending'
  | 'aborted'

export interface Turn {
  turn_id: string
  session_id: string
  input_type: 'voice' | 'text'
  text: string
  state: TurnState
  created_at: number
}

/** Sub-activity item from a subagent tool call. */
export interface SubItem {
  type: 'text' | 'toolCall'
  text?: string
  name?: string
  args?: Record<string, any>
}

export interface OrchestratorCallbacks {
  onChunk: (data: { turn_id: string; text: string }) => void
  onDone: (data: { turn_id: string; full_text: string }) => void
  onToolStart: (data: { turn_id: string; toolCallId: string; tool: string; input: any }) => void
  onToolEnd: (data: { turn_id: string; toolCallId: string; tool: string; output: any; isError: boolean }) => void
  onToolUpdate: (data: { turn_id: string; tool: string; toolCallId: string; subItems: SubItem[] }) => void
  onTurnState: (data: { turn_id: string; state: TurnState }) => void
  onError: (data: { source: string; message: string }) => void
  onThinkingStart: (data: { turn_id: string }) => void
  onThinkingChunk: (data: { turn_id: string; text: string }) => void
  onThinkingEnd: (data: { turn_id: string; text: string }) => void
  onTextBlockStart: (data: { turn_id: string }) => void
  onTextBlockEnd: (data: { turn_id: string }) => void
}

// ============================================================================
// Orchestrator
// ============================================================================

export class Orchestrator extends EventEmitter {
  private currentTurn: Turn | null = null
  private lockHeld = false
  private lockQueue: Array<() => void> = []
  private agentBridge: AgentBridge
  private callbacks: OrchestratorCallbacks

  constructor(agentBridge: AgentBridge, callbacks: OrchestratorCallbacks) {
    super()
    this.agentBridge = agentBridge
    this.callbacks = callbacks
  }

  /**
   * Submit a new turn (from text input or future voice transcript).
   * Returns the turn_id immediately; generation is asynchronous.
   */
  submitTurn(text: string, inputType: 'voice' | 'text' = 'text'): string {
    const turn: Turn = {
      turn_id: randomUUID(),
      session_id: '',   // populated after get_state in future; empty is fine for Phase 2
      input_type: inputType,
      text,
      state: 'queued',
      created_at: Date.now(),
    }

    this.currentTurn = turn
    this.setTurnState(turn, 'queued')

    // Acquire lock then run (non-blocking return)
    this.acquireLock().then(() => this.runTurn(turn)).catch((err: Error) => {
      console.error('[orchestrator] runTurn error:', err)
      this.callbacks.onError({ source: 'orchestrator', message: err.message })
      this.releaseLock()
    })

    return turn.turn_id
  }

  /** Abort the currently generating turn. */
  async abortCurrentTurn(): Promise<void> {
    if (!this.currentTurn || this.currentTurn.state === 'idle' || this.currentTurn.state === 'aborted') {
      return
    }
    this.setTurnState(this.currentTurn, 'aborted')
    this.emit('voice-abort') // renderer listens to stop TTS
    try {
      await this.agentBridge.abort()
    } catch (err: any) {
      console.warn('[orchestrator] abort error:', err.message)
    }
    this.releaseLock()
  }

  /** Get the current turn (may be null). */
  getCurrentTurn(): Turn | null {
    return this.currentTurn
  }

  /**
   * Set voice-specific turn phase. Only affects voice-input turns.
   * Called by the voice service layer (Phase 2) to reflect sidecar state.
   */
  setVoicePhase(phase: 'listening' | 'transcribing' | 'speaking' | 'playback_pending'): void {
    if (this.currentTurn && this.currentTurn.input_type === 'voice') {
      this.setTurnState(this.currentTurn, phase)
    }
  }

  // =========================================================================
  // Private
  // =========================================================================

  private setTurnState(turn: Turn, state: TurnState): void {
    turn.state = state
    this.callbacks.onTurnState({ turn_id: turn.turn_id, state })
  }

  private acquireLock(): Promise<void> {
    if (!this.lockHeld) {
      this.lockHeld = true
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.lockQueue.push(resolve)
    })
  }

  private releaseLock(): void {
    const next = this.lockQueue.shift()
    if (next) {
      next()
    } else {
      this.lockHeld = false
    }
  }

  private async runTurn(turn: Turn): Promise<void> {
    if (turn.state === 'aborted') {
      this.releaseLock()
      return
    }

    this.setTurnState(turn, 'generating')

    let fullText = ''
    let agentEndReceived = false
    let firstActivityReceived = false

    // Rolling idle safety timer — reset on every event, fires after 5 min of silence
    let safetyTimerHandle: ReturnType<typeof setTimeout> | null = null
    const resetSafetyTimer = () => {
      if (safetyTimerHandle) clearTimeout(safetyTimerHandle)
      safetyTimerHandle = setTimeout(() => {
        if (!agentEndReceived) {
          console.warn('[orchestrator] safety timeout: no agent_end received, releasing lock')
          clearTimeout(firstActivityTimer)
          unsubscribe()
          this.callbacks.onError({ source: 'orchestrator', message: 'Generation timed out (5 min idle)' })
          if (turn.state !== 'aborted') {
            this.setTurnState(turn, 'idle')
          }
          this.releaseLock()
        }
      }, 5 * 60 * 1000)
    }

    // Set up event listener BEFORE sending prompt to avoid missing events
    const unsubscribe = this.agentBridge.onAgentEvent((event: any) => {
      if (turn.state === 'aborted') return
      if (!firstActivityReceived) {
        firstActivityReceived = true
        clearTimeout(firstActivityTimer)
      }

      // Reset rolling idle timer on every event
      resetSafetyTimer()

      if (event.type === 'message_update') {
        // Extract events from the assistantMessageEvent
        const amEvent = event.assistantMessageEvent
        if (amEvent) {
          // thinking_start
          if (amEvent.type === 'thinking_start') {
            this.callbacks.onThinkingStart({ turn_id: turn.turn_id })
          }

          // thinking_delta
          if (
            amEvent.type === 'thinking_delta' &&
            typeof amEvent.delta === 'string'
          ) {
            this.callbacks.onThinkingChunk({ turn_id: turn.turn_id, text: amEvent.delta })
          }
          // Also handle delta object with thinking property
          if (
            amEvent.type === 'thinking_delta' &&
            amEvent.delta &&
            typeof amEvent.delta.thinking === 'string'
          ) {
            this.callbacks.onThinkingChunk({ turn_id: turn.turn_id, text: amEvent.delta.thinking })
          }

          // thinking_end
          if (amEvent.type === 'thinking_end') {
            const text = typeof amEvent.content === 'string' ? amEvent.content : ''
            this.callbacks.onThinkingEnd({ turn_id: turn.turn_id, text })
          }

          // text_start
          if (amEvent.type === 'text_start') {
            this.callbacks.onTextBlockStart({ turn_id: turn.turn_id })
          }

          // text_delta — direct string delta (current Pi SDK format)
          if (amEvent.type === 'text_delta' && typeof amEvent.delta === 'string') {
            const chunk = amEvent.delta
            fullText += chunk
            this.callbacks.onChunk({ turn_id: turn.turn_id, text: chunk })
          }
          // text_delta via content_block_delta (legacy format fallback)
          if (
            amEvent.type === 'content_block_delta' &&
            amEvent.delta?.type === 'text_delta' &&
            typeof amEvent.delta.text === 'string'
          ) {
            const chunk = amEvent.delta.text
            fullText += chunk
            this.callbacks.onChunk({ turn_id: turn.turn_id, text: chunk })
          }

          // text_end
          if (amEvent.type === 'text_end') {
            this.callbacks.onTextBlockEnd({ turn_id: turn.turn_id })
          }

          // Native Anthropic web search — server_tool_use start
          if (amEvent.type === 'server_tool_use') {
            this.callbacks.onToolStart({
              turn_id: turn.turn_id,
              tool: 'web_search',
              input: {},
            })
          }

          // Native Anthropic web search — result
          if (amEvent.type === 'web_search_result') {
            this.callbacks.onToolEnd({
              turn_id: turn.turn_id,
              tool: 'web_search',
              output: 'Search completed',
              isError: false,
            })
          }
        }
      } else if (event.type === 'tool_execution_start') {
        this.callbacks.onToolStart({
          turn_id: turn.turn_id,
          toolCallId: event.toolCallId ?? '',
          tool: event.toolName ?? event.tool_name ?? '',
          input: event.args ?? {},
        })
      } else if (event.type === 'tool_execution_update') {
        // Extract subItems from partialResult.details.results[].messages[]
        const subItems: SubItem[] = []
        const results: any[] = event.partialResult?.details?.results ?? []
        for (const result of results) {
          const messages: any[] = result.messages ?? []
          for (const msg of messages) {
            if (msg.role !== 'assistant') continue
            const content: any[] = Array.isArray(msg.content) ? msg.content : []
            for (const block of content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                subItems.push({ type: 'text', text: block.text })
              } else if (block.type === 'toolCall' || block.type === 'tool_use') {
                subItems.push({
                  type: 'toolCall',
                  name: block.name ?? block.tool_name ?? '',
                  args: block.arguments ?? block.input ?? {},
                })
              }
            }
          }
        }
        this.callbacks.onToolUpdate({
          turn_id: turn.turn_id,
          tool: event.toolName ?? '',
          toolCallId: event.toolCallId ?? '',
          subItems,
        })
      } else if (event.type === 'tool_execution_end') {
        this.callbacks.onToolEnd({
          turn_id: turn.turn_id,
          toolCallId: event.toolCallId ?? '',
          tool: event.toolName ?? event.tool_name ?? '',
          output: event.result ?? {},
          isError: event.isError ?? false,
        })
      } else if (event.type === 'agent_process_exit') {
        if (safetyTimerHandle) clearTimeout(safetyTimerHandle)
        clearTimeout(firstActivityTimer)
        unsubscribe()
        this.callbacks.onError({
          source: 'agent',
          message: `Agent stopped unexpectedly (${event.reason ?? 'unknown'}) — check your provider credentials in Settings (⌘,)`,
        })
        if (turn.state !== 'aborted') {
          this.setTurnState(turn, 'idle')
        }
        this.releaseLock()
      } else if (event.type === 'agent_end') {
        agentEndReceived = true
        if (safetyTimerHandle) clearTimeout(safetyTimerHandle)
        clearTimeout(firstActivityTimer)
        unsubscribe()

        // If we got no streaming text, try to get it from the final message
        if (!fullText && event.messages && Array.isArray(event.messages)) {
          for (const msg of event.messages) {
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'text' && typeof block.text === 'string') {
                  fullText += block.text
                }
              }
            }
          }
        }

        this.callbacks.onDone({ turn_id: turn.turn_id, full_text: fullText })
        this.setTurnState(turn, 'idle')
        this.releaseLock()
      }
    })

    // First-activity timeout: if the agent produces NO events at all within
    // 30 s the provider is likely misconfigured or unreachable.
    const firstActivityTimer = setTimeout(() => {
      if (!firstActivityReceived) {
        console.warn('[orchestrator] first-activity timeout: no response from agent')
        if (safetyTimerHandle) clearTimeout(safetyTimerHandle)
        unsubscribe()
        this.callbacks.onError({
          source: 'orchestrator',
          message: 'No response from AI provider — verify your credentials in Settings (⌘,).',
        })
        if (turn.state !== 'aborted') {
          this.setTurnState(turn, 'idle')
        }
        this.releaseLock()
      }
    }, 30_000)

    // Start the rolling idle safety timer
    resetSafetyTimer()

    try {
      await this.agentBridge.prompt(turn.text)
    } catch (err: any) {
      if (safetyTimerHandle) clearTimeout(safetyTimerHandle)
      unsubscribe()
      console.error('[orchestrator] prompt error:', err.message)
      this.callbacks.onError({ source: 'agent', message: err.message })
      this.setTurnState(turn, 'idle')
      this.releaseLock()
      return
    }

  }
}
