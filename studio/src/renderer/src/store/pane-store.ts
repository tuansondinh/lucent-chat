/**
 * Pane store — per-pane chat state factory and pane layout store.
 *
 * Each pane gets its own zustand store instance, created lazily and cached
 * in a module-level Map. This avoids the shared global useChatStore and lets
 * each pane independently track its messages, health, and session.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { type ChatMessage, type AgentHealth, type ViewedFile, type ContentBlock } from './chat'

// ============================================================================
// Per-pane state shape
// ============================================================================

export interface PaneChatState {
  paneId: string
  messages: ChatMessage[]
  currentTurnId: string | null
  agentHealth: AgentHealth
  isGenerating: boolean
  currentModel: string
  viewedFile: ViewedFile | null
  scrollPositions: Record<string, number>
  currentSessionPath: string | null
  currentSessionName: string

  // Actions
  addUserMessage: (text: string, turn_id: string) => void
  appendChunk: (turn_id: string, text: string) => void
  finalizeMessage: (turn_id: string, full_text: string) => void
  addToolCall: (turn_id: string, tool: string, input: unknown) => void
  finalizeToolCall: (turn_id: string, tool: string, output: unknown, isError: boolean) => void
  addThinking: (turn_id: string) => void
  appendThinkingChunk: (turn_id: string, text: string) => void
  finalizeThinking: (turn_id: string, text: string) => void
  startTextBlock: (turn_id: string) => void
  finalizeTextBlock: (turn_id: string) => void
  setHealth: (states: Record<string, string>) => void
  setModel: (model: string) => void
  addErrorMessage: (message: string) => void
  loadHistory: (messages: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>) => void
  setViewedFile: (file: ViewedFile) => void
  clearViewedFile: () => void
  saveScrollPosition: (sessionPath: string, scrollTop: number) => void
  setSessionPath: (path: string | null) => void
  setSessionName: (name: string) => void
}

// ============================================================================
// Internal helpers (mirrors chat.ts logic)
// ============================================================================

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

function ensureAssistantMessage(messages: ChatMessage[], turn_id: string): ChatMessage[] {
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

const toolCounters: Record<string, number> = {}

function nextToolId(turn_id: string): string {
  toolCounters[turn_id] = (toolCounters[turn_id] ?? 0) + 1
  return `${turn_id}-tool-${toolCounters[turn_id]}`
}

const FILE_READ_TOOLS = new Set(['read', 'read_file', 'readfile', 'view'])
const FILE_WRITE_TOOLS = new Set(['write', 'write_file', 'writefile', 'edit', 'create', 'str_replace_editor'])

function extractFileInfo(
  tool: string,
  input: unknown,
  output: unknown,
): { path: string; content: string } | null {
  const toolLower = tool.toLowerCase()
  const isReadTool = FILE_READ_TOOLS.has(toolLower)
  const isWriteTool = FILE_WRITE_TOOLS.has(toolLower)
  if (!isReadTool && !isWriteTool) return null

  const strProp = (obj: unknown, ...keys: string[]): string | undefined => {
    if (typeof obj !== 'object' || obj === null) return undefined
    const record = obj as Record<string, unknown>
    for (const key of keys) {
      const val = record[key]
      if (typeof val === 'string' && val.length > 0) return val
    }
    return undefined
  }

  const path = strProp(input, 'path', 'file_path', 'file', 'filename')
  if (!path) return null

  let content: string | undefined
  if (isReadTool) {
    if (typeof output === 'string') {
      content = output
    } else {
      content = strProp(output, 'content', 'text', 'result', 'output')
    }
  } else {
    content = strProp(input, 'new_content', 'content', 'file_text', 'text')
    if (!content && typeof output === 'string' && output.length > 0) {
      content = output
    }
  }

  if (content === undefined) return null
  return { path, content }
}

// ============================================================================
// Per-pane store factory
// ============================================================================

export type PaneChatStore = UseBoundStore<StoreApi<PaneChatState>>

export function createPaneChatStore(paneId: string): PaneChatStore {
  return create<PaneChatState>((set) => ({
    paneId,
    messages: [],
    currentTurnId: null,
    agentHealth: 'unknown',
    isGenerating: false,
    currentModel: '',
    viewedFile: null,
    scrollPositions: {},
    currentSessionPath: null,
    currentSessionName: '',

    addUserMessage: (text, turn_id) =>
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: turn_id + '-user',
            turn_id,
            role: 'user',
            contentBlocks: [{ type: 'text' as const, id: `${turn_id}-user-text`, text, isStreaming: false }],
            isStreaming: false,
            createdAt: Date.now(),
          },
        ],
        currentTurnId: turn_id,
        isGenerating: true,
      })),

    appendChunk: (turn_id, text) =>
      set((s) => {
        let messages = ensureAssistantMessage(s.messages, turn_id)
        messages = messages.map((m) => {
          if (m.turn_id !== turn_id || m.role !== 'assistant') return m
          const blocks = m.contentBlocks
          const last = blocks[blocks.length - 1]
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

          let blocks = m.contentBlocks.map((b) => {
            if (b.type === 'tool_use' && !b.done) {
              return { ...b, done: true, isError: true, output: 'Aborted' }
            }
            if (b.type === 'thinking' || b.type === 'text') {
              return { ...b, isStreaming: false }
            }
            return b
          })

          const hasText = blocks.some((b) => b.type === 'text')
          if (!hasText && full_text) {
            blocks = [
              ...blocks,
              { type: 'text' as const, id: `${turn_id}-final`, text: full_text, isStreaming: false },
            ]
          }

          return { ...m, contentBlocks: blocks, isStreaming: false }
        })

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
      set((s) => {
        let toolInput: unknown = undefined
        for (const m of s.messages) {
          if (m.turn_id === turn_id && m.role === 'assistant') {
            for (const b of m.contentBlocks) {
              if (b.type === 'tool_use' && b.tool === tool && !b.done) {
                toolInput = b.input
                break
              }
            }
            break
          }
        }

        let viewedFile = s.viewedFile
        if (!isError) {
          const fileInfo = extractFileInfo(tool, toolInput, output)
          if (fileInfo) {
            const toolLower = tool.toLowerCase()
            viewedFile = {
              path: fileInfo.path,
              content: fileInfo.content,
              tool: FILE_READ_TOOLS.has(toolLower) ? 'read' : 'write',
            }
          }
        }

        return {
          viewedFile,
          messages: s.messages.map((m) => {
            if (m.turn_id !== turn_id || m.role !== 'assistant') return m
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
        }
      }),

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

    setViewedFile: (file) => set({ viewedFile: file }),

    clearViewedFile: () => set({ viewedFile: null }),

    saveScrollPosition: (sessionPath, scrollTop) =>
      set((s) => ({
        scrollPositions: { ...s.scrollPositions, [sessionPath]: scrollTop },
      })),

    setSessionPath: (path) => set({ currentSessionPath: path }),

    setSessionName: (name) => set({ currentSessionName: name }),
  }))
}

// ============================================================================
// Module-level pane store registry
// ============================================================================

const paneStores = new Map<string, PaneChatStore>()

export function getPaneStore(paneId: string): PaneChatStore {
  if (!paneStores.has(paneId)) {
    paneStores.set(paneId, createPaneChatStore(paneId))
  }
  return paneStores.get(paneId)!
}

export function deletePaneStore(paneId: string): void {
  paneStores.delete(paneId)
}

// ============================================================================
// Pane layout store — tracks which panes exist and which is active
// ============================================================================

export type PaneOrientation = 'horizontal' | 'vertical'

interface PanesLayoutState {
  paneIds: string[]
  activePaneId: string

  addPane: (paneId: string) => void
  removePane: (paneId: string) => void
  setActivePane: (paneId: string) => void
}

export const usePanesStore = create<PanesLayoutState>((set) => ({
  paneIds: ['pane-0'],
  activePaneId: 'pane-0',

  addPane: (paneId) =>
    set((s) => ({
      paneIds: [...s.paneIds, paneId],
      activePaneId: paneId,
    })),

  removePane: (paneId) =>
    set((s) => {
      const paneIds = s.paneIds.filter((id) => id !== paneId)
      const activePaneId =
        s.activePaneId === paneId
          ? (paneIds[paneIds.length - 1] ?? 'pane-0')
          : s.activePaneId
      return { paneIds, activePaneId }
    }),

  setActivePane: (paneId) => set({ activePaneId: paneId }),
}))
