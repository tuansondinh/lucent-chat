/**
 * Chat store — manages messages, streaming state, and agent health.
 * Uses zustand for reactive state management.
 */

import { create } from 'zustand'

// ============================================================================
// Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'error'
export type AgentHealth = 'unknown' | 'starting' | 'ready' | 'degraded' | 'crashed'

/** Subagent content block — an inline nested agent execution. */
export interface SubagentBlock {
  type: 'subagent'
  id: string
  agentType: string
  prompt: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  endedAt?: number
  /** Nested content blocks from the child agent (tool calls, text). Typed as any[] for forward compat. */
  children: unknown[]
}

/** Skill step progress. */
export interface SkillStepState {
  index: number
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted'
  output?: string
  error?: string
}

/** Skill content block — a multi-step skill execution visible in chat. */
export interface SkillBlock {
  type: 'skill'
  id: string
  skillId: string
  skillName: string
  trigger: string
  steps: SkillStepState[]
  totalSteps: number
  status: 'running' | 'done' | 'error' | 'aborted'
  startedAt: number
  endedAt?: number
}

/** Unknown future block type — render as a collapsed info block (forward compat). */
export interface UnknownBlock {
  type: string
  id: string
  [key: string]: unknown
}

/** Ordered content block within an assistant message. */
export type ContentBlock =
  | { type: 'thinking'; id: string; text: string; isStreaming: boolean }
  | { type: 'text'; id: string; text: string; isStreaming: boolean }
  | { type: 'tool_use'; id: string; tool: string; input: unknown; output?: unknown; isError?: boolean; done: boolean }
  | SubagentBlock
  | SkillBlock
  | UnknownBlock

/** @deprecated Use ContentBlock instead. Kept for type compatibility in ToolCallItem. */
export interface ToolCall {
  tool: string
  input: unknown
  output?: unknown
  isError?: boolean
  done: boolean
}

export interface ChatMessage {
  id: string
  turn_id: string
  role: MessageRole
  contentBlocks: ContentBlock[]
  isStreaming: boolean
  createdAt: number
}

/** Helper: concatenate all text blocks from a message (for copy). */
export function getMessageText(msg: ChatMessage): string {
  return msg.contentBlocks
    .filter((b): b is Extract<ContentBlock, { type: 'text'; id: string; text: string; isStreaming: boolean }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

// ============================================================================
// Store
// ============================================================================

/** Per-turn counter for tool_execution blocks (which lack contentIndex). */
const toolCounters: Record<string, number> = {}

function nextToolId(turn_id: string): string {
  toolCounters[turn_id] = (toolCounters[turn_id] ?? 0) + 1
  return `${turn_id}-tool-${toolCounters[turn_id]}`
}

interface ChatState {
  messages: ChatMessage[]
  currentTurnId: string | null
  agentHealth: AgentHealth
  isGenerating: boolean
  currentModel: string
  /** Persisted scroll positions keyed by session path. */
  scrollPositions: Record<string, number>

  // Actions
  addUserMessage: (text: string, turn_id: string) => void
  startAssistantMessage: (turn_id: string) => void
  appendChunk: (turn_id: string, text: string) => void
  finalizeMessage: (turn_id: string, full_text: string) => void
  addToolCall: (turn_id: string, tool: string, input: unknown) => void
  finalizeToolCall: (turn_id: string, tool: string, output: unknown, isError: boolean) => void
  /** Start a new thinking block for a turn. */
  addThinking: (turn_id: string) => void
  /** Append a delta to the current thinking block. */
  appendThinkingChunk: (turn_id: string, text: string) => void
  /** Finalize the current thinking block with full text. */
  finalizeThinking: (turn_id: string, text: string) => void
  /** Start a new streaming text block. */
  startTextBlock: (turn_id: string) => void
  /** Finalize the last streaming text block. */
  finalizeTextBlock: (turn_id: string) => void
  setHealth: (states: Record<string, string>) => void
  setGenerating: (val: boolean) => void
  setModel: (model: string) => void
  addErrorMessage: (message: string) => void
  clearMessages: () => void
  /** Clears existing messages and loads historical ones from a switched session. */
  loadHistory: (messages: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>) => void
  /** Save the scroll position for a given session path. */
  saveScrollPosition: (sessionPath: string, scrollTop: number) => void

  // ---- Subagent actions ----
  /** Add a new subagent block to a turn's assistant message. */
  addSubagentBlock: (turn_id: string, subagentId: string, agentType: string, prompt: string) => void
  /** Update the status of a subagent block. */
  updateSubagentStatus: (turn_id: string, subagentId: string, status: 'running' | 'done' | 'error', endedAt?: number) => void
  /** Number of active subagents across all messages. */
  activeSubagentCount: number
}

function mapHealth(state: string): AgentHealth {
  switch (state) {
    case 'ready':    return 'ready'
    case 'starting': return 'starting'
    case 'degraded': return 'degraded'
    case 'crashed':  return 'crashed'
    case 'stopped':  return 'unknown'
    default:         return 'unknown'
  }
}

/** Ensure an assistant message exists for this turn, returning updated messages array. */
function ensureAssistantMessage(
  messages: ChatMessage[],
  turn_id: string,
): ChatMessage[] {
  const exists = messages.some((m) => m.turn_id === turn_id && m.role === 'assistant')
  if (exists) return messages
  return [
    ...messages,
    {
      id: turn_id + '-assistant',
      turn_id,
      role: 'assistant',
      contentBlocks: [],
      isStreaming: true,
      createdAt: Date.now(),
    },
  ]
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentTurnId: null,
  agentHealth: 'unknown',
  isGenerating: false,
  currentModel: '',
  scrollPositions: {},
  activeSubagentCount: 0,

  addUserMessage: (text, turn_id) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: turn_id + '-user',
          turn_id,
          role: 'user',
          contentBlocks: [{ type: 'text', id: `${turn_id}-user-text`, text, isStreaming: false }],
          isStreaming: false,
          createdAt: Date.now(),
        },
      ],
      currentTurnId: turn_id,
      isGenerating: true,
    })),

  startAssistantMessage: (turn_id) =>
    set((s) => {
      // Avoid duplicate assistant placeholders
      const exists = s.messages.some(
        (m) => m.turn_id === turn_id && m.role === 'assistant'
      )
      if (exists) return {}
      return {
        messages: [
          ...s.messages,
          {
            id: turn_id + '-assistant',
            turn_id,
            role: 'assistant',
            contentBlocks: [],
            isStreaming: true,
            createdAt: Date.now(),
          },
        ],
      }
    }),

  appendChunk: (turn_id, text) =>
    set((s) => {
      let messages = ensureAssistantMessage(s.messages, turn_id)
      messages = messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const blocks = m.contentBlocks
        const last = blocks[blocks.length - 1]
        // Append to last text block if it's streaming, else create a new one
        if (last && last.type === 'text' && last.isStreaming) {
          return {
            ...m,
            isStreaming: true,
            contentBlocks: [
              ...blocks.slice(0, -1),
              { ...last, text: last.text + text },
            ],
          }
        }
        // Create new text block
        const newId = `${turn_id}-chunk-${Date.now()}`
        return {
          ...m,
          isStreaming: true,
          contentBlocks: [
            ...blocks,
            { type: 'text' as const, id: newId, text, isStreaming: true },
          ],
        }
      })
      return { messages }
    }),

  finalizeMessage: (turn_id, full_text) =>
    set((s) => {
      let messages = s.messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m

        // Close all streaming blocks
        let blocks = m.contentBlocks.map((b) => {
          if (b.type === 'tool_use' && !b.done) {
            return { ...b, done: true, isError: true, output: 'Aborted' }
          }
          if (b.type === 'thinking' || b.type === 'text') {
            return { ...b, isStreaming: false }
          }
          return b
        })

        // If no text blocks at all and we have full_text, add one
        const hasText = blocks.some((b) => b.type === 'text')
        if (!hasText && full_text) {
          blocks = [
            ...blocks,
            {
              type: 'text' as const,
              id: `${turn_id}-final`,
              text: full_text,
              isStreaming: false,
            },
          ]
        }

        return { ...m, contentBlocks: blocks, isStreaming: false }
      })

      // If no assistant message at all, add one (shouldn't happen but be safe)
      const hasAssistant = messages.some(
        (m) => m.turn_id === turn_id && m.role === 'assistant'
      )
      if (!hasAssistant && full_text) {
        messages.push({
          id: turn_id + '-assistant',
          turn_id,
          role: 'assistant',
          contentBlocks: [
            { type: 'text', id: `${turn_id}-final`, text: full_text, isStreaming: false },
          ],
          isStreaming: false,
          createdAt: Date.now(),
        })
      }
      return { messages, isGenerating: false }
    }),

  addToolCall: (turn_id, tool, input) =>
    set((s) => {
      let messages = ensureAssistantMessage(s.messages, turn_id)
      messages = messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const id = nextToolId(turn_id)
        return {
          ...m,
          contentBlocks: [
            ...m.contentBlocks,
            { type: 'tool_use' as const, id, tool, input, done: false },
          ],
        }
      })
      return { messages }
    }),

  finalizeToolCall: (turn_id, tool, output, isError) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        // Find the first undone tool_use block with matching tool name (FIFO)
        let matched = false
        const contentBlocks = m.contentBlocks.map((b) => {
          if (b.type === 'tool_use' && b.tool === tool && !b.done && !matched) {
            matched = true
            return { ...b, output, isError, done: true }
          }
          return b
        })
        return { ...m, contentBlocks }
      }),
    })),

  addThinking: (turn_id) =>
    set((s) => {
      let messages = ensureAssistantMessage(s.messages, turn_id)
      messages = messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const id = `${turn_id}-thinking-${m.contentBlocks.length}`
        return {
          ...m,
          isStreaming: true,
          contentBlocks: [
            ...m.contentBlocks,
            { type: 'thinking' as const, id, text: '', isStreaming: true },
          ],
        }
      })
      return { messages }
    }),

  appendThinkingChunk: (turn_id, text) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const blocks = m.contentBlocks
        // Find the last thinking block that is streaming
        const idx = [...blocks].reverse().findIndex(
          (b) => b.type === 'thinking' && b.isStreaming
        )
        if (idx === -1) return m
        const realIdx = blocks.length - 1 - idx
        const block = blocks[realIdx] as Extract<ContentBlock, { type: 'thinking' }>
        return {
          ...m,
          contentBlocks: [
            ...blocks.slice(0, realIdx),
            { ...block, text: block.text + text },
            ...blocks.slice(realIdx + 1),
          ],
        }
      }),
    })),

  finalizeThinking: (turn_id, text) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const blocks = m.contentBlocks
        // Find the last streaming thinking block
        const idx = [...blocks].reverse().findIndex(
          (b) => b.type === 'thinking' && b.isStreaming
        )
        if (idx === -1) return m
        const realIdx = blocks.length - 1 - idx
        const block = blocks[realIdx] as Extract<ContentBlock, { type: 'thinking' }>
        return {
          ...m,
          contentBlocks: [
            ...blocks.slice(0, realIdx),
            { ...block, text: text || block.text, isStreaming: false },
            ...blocks.slice(realIdx + 1),
          ],
        }
      }),
    })),

  startTextBlock: (turn_id) =>
    set((s) => {
      let messages = ensureAssistantMessage(s.messages, turn_id)
      messages = messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const id = `${turn_id}-text-${m.contentBlocks.length}`
        return {
          ...m,
          isStreaming: true,
          contentBlocks: [
            ...m.contentBlocks,
            { type: 'text' as const, id, text: '', isStreaming: true },
          ],
        }
      })
      return { messages }
    }),

  finalizeTextBlock: (turn_id) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const blocks = m.contentBlocks
        // Find the last streaming text block
        const idx = [...blocks].reverse().findIndex(
          (b) => b.type === 'text' && b.isStreaming
        )
        if (idx === -1) return m
        const realIdx = blocks.length - 1 - idx
        const block = blocks[realIdx] as Extract<ContentBlock, { type: 'text' }>
        return {
          ...m,
          contentBlocks: [
            ...blocks.slice(0, realIdx),
            { ...block, isStreaming: false },
            ...blocks.slice(realIdx + 1),
          ],
        }
      }),
    })),

  setHealth: (states) =>
    set({ agentHealth: mapHealth(states.agent ?? 'unknown') }),

  setGenerating: (val) =>
    set({ isGenerating: val }),

  setModel: (model) =>
    set({ currentModel: model }),

  addErrorMessage: (message) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `err-${Date.now()}`,
          turn_id: '',
          role: 'error',
          contentBlocks: [
            { type: 'text', id: `err-text-${Date.now()}`, text: message, isStreaming: false },
          ],
          isStreaming: false,
          createdAt: Date.now(),
        },
      ],
      isGenerating: false,
    })),

  clearMessages: () =>
    set({ messages: [], currentTurnId: null, isGenerating: false }),

  loadHistory: (history) =>
    set({
      messages: history.map((m, i) => ({
        id: `history-${i}-${m.timestamp}`,
        turn_id: `history-${i}`,
        role: m.role,
        contentBlocks: [
          { type: 'text' as const, id: `history-${i}-text`, text: m.text, isStreaming: false },
        ],
        isStreaming: false,
        createdAt: m.timestamp,
      })),
      currentTurnId: null,
      isGenerating: false,
    }),

  saveScrollPosition: (sessionPath, scrollTop) =>
    set((s) => ({
      scrollPositions: { ...s.scrollPositions, [sessionPath]: scrollTop },
    })),

  addSubagentBlock: (turn_id, subagentId, agentType, prompt) =>
    set((s) => {
      let messages = ensureAssistantMessage(s.messages, turn_id)
      messages = messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const block: SubagentBlock = {
          type: 'subagent',
          id: subagentId,
          agentType,
          prompt,
          status: 'running',
          startedAt: Date.now(),
          children: [],
        }
        return { ...m, contentBlocks: [...m.contentBlocks, block] }
      })
      // Count active subagents
      const activeSubagentCount = messages.reduce((acc, msg) => {
        return acc + msg.contentBlocks.filter(
          (b) => b.type === 'subagent' && (b as SubagentBlock).status === 'running'
        ).length
      }, 0)
      return { messages, activeSubagentCount }
    }),

  updateSubagentStatus: (turn_id, subagentId, status, endedAt) =>
    set((s) => {
      const messages = s.messages.map((m) => {
        if (m.turn_id !== turn_id || m.role !== 'assistant') return m
        const contentBlocks = m.contentBlocks.map((b) => {
          if (b.type === 'subagent' && b.id === subagentId) {
            return { ...b, status, ...(endedAt !== undefined ? { endedAt } : {}) } as SubagentBlock
          }
          return b
        })
        return { ...m, contentBlocks }
      })
      const activeSubagentCount = messages.reduce((acc, msg) => {
        return acc + msg.contentBlocks.filter(
          (b) => b.type === 'subagent' && (b as SubagentBlock).status === 'running'
        ).length
      }, 0)
      return { messages, activeSubagentCount }
    }),
}))
