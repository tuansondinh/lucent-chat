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

/** Represents a file being viewed as a result of a tool call. */
export interface ViewedFile {
  path: string
  content: string
  tool: 'read' | 'write'
}

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
  text: string
  isStreaming: boolean
  toolCalls: ToolCall[]
  createdAt: number
}

// ============================================================================
// Store
// ============================================================================

// Tool names that represent file read operations (case-insensitive match used in finalizeToolCall)
const FILE_READ_TOOLS = new Set(['read', 'read_file', 'readfile', 'view'])
// Tool names that represent file write/edit operations
const FILE_WRITE_TOOLS = new Set(['write', 'write_file', 'writefile', 'edit', 'create', 'str_replace_editor'])

/**
 * Attempt to extract { path, content } from a tool's input/output payload.
 * Supports both Claude-SDK-style objects and plain string outputs.
 */
function extractFileInfo(
  tool: string,
  input: unknown,
  output: unknown,
): { path: string; content: string } | null {
  const toolLower = tool.toLowerCase()
  const isReadTool = FILE_READ_TOOLS.has(toolLower)
  const isWriteTool = FILE_WRITE_TOOLS.has(toolLower)
  if (!isReadTool && !isWriteTool) return null

  // Helper: safely read string property from an unknown object
  const strProp = (obj: unknown, ...keys: string[]): string | undefined => {
    if (typeof obj !== 'object' || obj === null) return undefined
    const record = obj as Record<string, unknown>
    for (const key of keys) {
      const val = record[key]
      if (typeof val === 'string' && val.length > 0) return val
    }
    return undefined
  }

  // Path is always in the input
  const path = strProp(input, 'path', 'file_path', 'file', 'filename')
  if (!path) return null

  // Content: for read tools, it comes from output; for write/edit tools, from input
  let content: string | undefined
  if (isReadTool) {
    if (typeof output === 'string') {
      content = output
    } else {
      content = strProp(output, 'content', 'text', 'result', 'output')
    }
  } else {
    // Write/edit: new_content or content in input
    content = strProp(input, 'new_content', 'content', 'file_text', 'text')
    // Also check output for confirmation message (some agents echo content)
    if (!content && typeof output === 'string' && output.length > 0) {
      content = output
    }
  }

  if (content === undefined) return null
  return { path, content }
}

interface ChatState {
  messages: ChatMessage[]
  currentTurnId: string | null
  agentHealth: AgentHealth
  isGenerating: boolean
  currentModel: string
  /** The most recently viewed file, set when a read/write tool completes. */
  viewedFile: ViewedFile | null
  /** Persisted scroll positions keyed by session path. */
  scrollPositions: Record<string, number>

  // Actions
  addUserMessage: (text: string, turn_id: string) => void
  startAssistantMessage: (turn_id: string) => void
  appendChunk: (turn_id: string, text: string) => void
  finalizeMessage: (turn_id: string, full_text: string) => void
  addToolCall: (turn_id: string, tool: string, input: unknown) => void
  finalizeToolCall: (turn_id: string, tool: string, output: unknown, isError: boolean) => void
  setHealth: (states: Record<string, string>) => void
  setGenerating: (val: boolean) => void
  setModel: (model: string) => void
  addErrorMessage: (message: string) => void
  clearMessages: () => void
  /** Clears existing messages and loads historical ones from a switched session. */
  loadHistory: (messages: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>) => void
  /** Set the currently viewed file. */
  setViewedFile: (file: ViewedFile) => void
  /** Clear the currently viewed file (close the panel). */
  clearViewedFile: () => void
  /** Save the scroll position for a given session path. */
  saveScrollPosition: (sessionPath: string, scrollTop: number) => void
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

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  currentTurnId: null,
  agentHealth: 'unknown',
  isGenerating: false,
  currentModel: '',
  viewedFile: null,
  scrollPositions: {},

  addUserMessage: (text, turn_id) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: turn_id + '-user',
          turn_id,
          role: 'user',
          text,
          isStreaming: false,
          toolCalls: [],
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
            text: '',
            isStreaming: true,
            toolCalls: [],
            createdAt: Date.now(),
          },
        ],
      }
    }),

  appendChunk: (turn_id, text) =>
    set((s) => {
      const messages = s.messages.map((m) => {
        if (m.turn_id === turn_id && m.role === 'assistant') {
          return { ...m, text: m.text + text, isStreaming: true }
        }
        return m
      })
      // If no assistant message exists yet, create one
      const hasAssistant = messages.some(
        (m) => m.turn_id === turn_id && m.role === 'assistant'
      )
      if (!hasAssistant) {
        messages.push({
          id: turn_id + '-assistant',
          turn_id,
          role: 'assistant',
          text,
          isStreaming: true,
          toolCalls: [],
          createdAt: Date.now(),
        })
      }
      return { messages }
    }),

  finalizeMessage: (turn_id, full_text) =>
    set((s) => {
      const messages = s.messages.map((m) => {
        if (m.turn_id === turn_id && m.role === 'assistant') {
          // If we got full_text but message is empty (no streaming chunks), use full_text
          const finalText = m.text || full_text
          return { ...m, text: finalText, isStreaming: false }
        }
        return m
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
          text: full_text,
          isStreaming: false,
          toolCalls: [],
          createdAt: Date.now(),
        })
      }
      return { messages, isGenerating: false }
    }),

  addToolCall: (turn_id, tool, input) =>
    set((s) => {
      const messages = s.messages.map((m) => {
        if (m.turn_id === turn_id && m.role === 'assistant') {
          return {
            ...m,
            toolCalls: [...m.toolCalls, { tool, input, done: false }],
          }
        }
        return m
      })
      // If no assistant message exists yet (agent's first action is a tool call),
      // create one so the tool call is not silently dropped.
      const hasAssistant = messages.some((m) => m.turn_id === turn_id && m.role === 'assistant')
      if (!hasAssistant) {
        messages.push({
          id: turn_id + '-assistant',
          turn_id,
          role: 'assistant',
          text: '',
          isStreaming: true,
          toolCalls: [{ tool, input, done: false }],
          createdAt: Date.now(),
        })
      }
      return { messages }
    }),

  finalizeToolCall: (turn_id, tool, output, isError) =>
    set((s) => {
      // Find the input for this tool call so we can extract file info
      let toolInput: unknown = undefined
      for (const m of s.messages) {
        if (m.turn_id === turn_id && m.role === 'assistant') {
          for (const tc of m.toolCalls) {
            if (tc.tool === tool && !tc.done) {
              toolInput = tc.input
              break
            }
          }
          break
        }
      }

      // Extract viewed file info if this is a file read/write tool
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
          if (m.turn_id === turn_id && m.role === 'assistant') {
            // Find the first unfinished call with this tool name (FIFO order).
            // This correctly handles the case where the same tool is called
            // multiple times in a single turn (e.g., two 'read' calls).
            let matched = false
            const toolCalls = m.toolCalls.map((tc) => {
              if (tc.tool === tool && !tc.done && !matched) {
                matched = true
                return { ...tc, output, isError, done: true }
              }
              return tc
            })
            return { ...m, toolCalls }
          }
          return m
        }),
      }
    }),

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
          text: message,
          isStreaming: false,
          toolCalls: [],
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
        text: m.text,
        isStreaming: false,
        toolCalls: [],
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
}))
