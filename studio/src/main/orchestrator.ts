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

export interface OrchestratorCallbacks {
  onChunk: (data: { turn_id: string; text: string }) => void
  onDone: (data: { turn_id: string; full_text: string }) => void
  onToolStart: (data: { turn_id: string; tool: string; input: any }) => void
  onToolEnd: (data: { turn_id: string; tool: string; output: any; isError: boolean }) => void
  onTurnState: (data: { turn_id: string; state: TurnState }) => void
  onError: (data: { source: string; message: string }) => void
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

    // Set up event listener BEFORE sending prompt to avoid missing events
    const unsubscribe = this.agentBridge.onAgentEvent((event: any) => {
      if (turn.state === 'aborted') return

      if (event.type === 'message_update') {
        // Extract text delta from the assistantMessageEvent
        const amEvent = event.assistantMessageEvent
        if (amEvent) {
          // Handle content_block_delta with text_delta
          if (
            amEvent.type === 'content_block_delta' &&
            amEvent.delta?.type === 'text_delta' &&
            typeof amEvent.delta.text === 'string'
          ) {
            const chunk = amEvent.delta.text
            fullText += chunk
            this.callbacks.onChunk({ turn_id: turn.turn_id, text: chunk })
          }
        }
      } else if (event.type === 'tool_execution_start') {
        this.callbacks.onToolStart({
          turn_id: turn.turn_id,
          tool: event.toolName ?? event.tool_name ?? '',
          input: event.args ?? {},
        })
      } else if (event.type === 'tool_execution_end') {
        this.callbacks.onToolEnd({
          turn_id: turn.turn_id,
          tool: event.toolName ?? event.tool_name ?? '',
          output: event.result ?? {},
          isError: event.isError ?? false,
        })
      } else if (event.type === 'agent_end') {
        agentEndReceived = true
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

    // Safety: if agent_end never arrives (crash, stuck), release lock after 5 minutes
    const safetyTimer = setTimeout(() => {
      if (!agentEndReceived) {
        console.warn('[orchestrator] safety timeout: no agent_end received, releasing lock')
        unsubscribe()
        this.callbacks.onError({ source: 'orchestrator', message: 'Generation timed out (5 min)' })
        if (turn.state !== 'aborted') {
          this.setTurnState(turn, 'idle')
        }
        this.releaseLock()
      }
    }, 5 * 60 * 1000)

    try {
      await this.agentBridge.prompt(turn.text)
    } catch (err: any) {
      clearTimeout(safetyTimer)
      unsubscribe()
      console.error('[orchestrator] prompt error:', err.message)
      this.callbacks.onError({ source: 'agent', message: err.message })
      this.setTurnState(turn, 'idle')
      this.releaseLock()
      return
    }

    // When agent_end fires, it will clear the safety timer indirectly (agentEndReceived flag)
    // The timeout callback checks agentEndReceived before acting
    // We store safetyTimer reference to cancel it when agent_end fires naturally
    // Hook into the unsubscribe to also cancel the timer
    const origUnsubscribe = unsubscribe
    // Replace unsubscribe to also clear safety timer (already called above in closure,
    // so we patch agentEndReceived tracking through the flag set before releaseLock)
    void origUnsubscribe // already referenced in closure; safetyTimer cleared via flag check
    void safetyTimer     // eslint-disable-line -- referenced by timeout callback
  }
}
