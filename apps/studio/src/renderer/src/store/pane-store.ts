/**
 * Pane store — per-pane chat state factory and pane layout store.
 *
 * Each pane gets its own zustand store instance, created lazily and cached
 * in a module-level Map. This avoids the shared global useChatStore and lets
 * each pane independently track its messages, health, and session.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { type ChatMessage, type AgentHealth, type ContentBlock, type SkillBlock, type SkillStepState, type SubItem } from './chat'

// ============================================================================
// Open file tab model
// ============================================================================

export interface OpenFile {
  kind: 'file'
  tabKey: string
  relativePath: string
  content: string
  source: 'user'
  truncated: boolean
  isBinary: boolean
}

export interface OpenDiff {
  kind: 'diff'
  tabKey: string
  relativePath: string
  diffText: string | null
  status: 'M' | 'A' | 'D' | 'R' | '??' | 'U'
  previousPath?: string
  isBinary: boolean
}

export type OpenViewerItem = OpenFile | OpenDiff

// ============================================================================
// Per-pane state shape
// ============================================================================

export interface PaneChatState {
  paneId: string
  messages: ChatMessage[]
  currentTurnId: string | null
  agentHealth: AgentHealth
  isGenerating: boolean
  pendingMessageCount: number
  isCompacting: boolean
  autoCompactionEnabled: boolean
  currentModel: string
  /** Open file tabs — ordered list. */
  openFiles: OpenViewerItem[]
  /** Active tab key (or null if none). */
  activeFilePath: string | null
  /** Current git branch for this pane's project root. */
  gitBranch: string | null
  /** This pane's project root path (display/browsing only). */
  projectRoot: string
  scrollPositions: Record<string, number>
  currentSessionPath: string | null
  currentSessionName: string
  /** Last 10 opened file paths (relative), most recent first. */
  recentFiles: string[]
  /** Per-pane permission mode. */
  permissionMode: 'danger-full-access' | 'accept-on-edit' | 'auto'
  /** Auto mode block-tracking state. */
  autoModeState: { paused: boolean; consecutiveBlocks: number; totalBlocks: number }

  // Actions
  addUserMessage: (text: string, turn_id: string) => void
  appendChunk: (turn_id: string, text: string) => void
  finalizeMessage: (turn_id: string, full_text: string) => void
  addToolCall: (turn_id: string, toolCallId: string, tool: string, input: unknown) => void
  finalizeToolCall: (turn_id: string, toolCallId: string, output: unknown, isError: boolean) => void
  /** Replace sub-activity items on a specific tool_use block (matched by toolCallId). */
  updateToolSubItems: (turn_id: string, toolCallId: string, subItems: SubItem[]) => void
  /** Mark all in-flight (done=false) tool_use blocks as errored. */
  markAllToolsErrored: (turn_id: string) => void
  addThinking: (turn_id: string) => void
  appendThinkingChunk: (turn_id: string, text: string) => void
  finalizeThinking: (turn_id: string, text: string) => void
  startTextBlock: (turn_id: string) => void
  finalizeTextBlock: (turn_id: string) => void
  setHealth: (states: Record<string, string>) => void
  setGenerating: (value: boolean) => void
  setPendingMessageCount: (value: number) => void
  setCompactionState: (isCompacting: boolean, autoCompactionEnabled?: boolean) => void
  setModel: (model: string) => void
  addErrorMessage: (message: string) => void
  loadHistory: (messages: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>) => void
  /** Open a file tab (or switch to it if already open). */
  openFile: (file: Omit<OpenFile, 'kind' | 'tabKey'>) => void
  /** Open a diff tab (or switch to it if already open). */
  openDiff: (diff: Omit<OpenDiff, 'kind' | 'tabKey'>) => void
  /** Close a file tab, selecting the nearest neighbor if it was active. */
  closeFile: (tabKey: string) => void
  /** Switch to an already-open file tab. */
  setActiveFile: (tabKey: string) => void
  /** Update the git branch for this pane. */
  setGitBranch: (branch: string | null) => void
  /** Update the project root for this pane. */
  setProjectRoot: (root: string) => void
  saveScrollPosition: (sessionPath: string, scrollTop: number) => void
  setSessionPath: (path: string | null) => void
  setSessionName: (name: string) => void
  /** Add a file to the recent files list (most recent first, capped at 10). */
  addRecentFile: (relativePath: string) => void
  /** Set the per-pane permission mode. */
  setPermissionMode: (mode: 'danger-full-access' | 'accept-on-edit' | 'auto') => void
  /** Update the auto mode block-tracking state. */
  setAutoModeState: (state: { paused: boolean; consecutiveBlocks: number; totalBlocks: number }) => void
  /** Add a new skill block to a turn's assistant message. */
  addSkillBlock: (turn_id: string, skillId: string, skillName: string, trigger: string, totalSteps: number) => void
  /** Update a skill step's progress. */
  updateSkillStep: (skillId: string, stepIndex: number, status: SkillStepState['status'], output?: string, error?: string) => void
  /** Finalize a skill block's overall status. */
  finalizeSkillBlock: (skillId: string, status: SkillBlock['status']) => void
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
    pendingMessageCount: 0,
    isCompacting: false,
    autoCompactionEnabled: true,
    currentModel: '',
    openFiles: [],
    activeFilePath: null,
    gitBranch: null,
    projectRoot: '',
    scrollPositions: {},
    currentSessionPath: null,
    currentSessionName: '',
    recentFiles: [],
    permissionMode: 'danger-full-access',
    autoModeState: { paused: false, consecutiveBlocks: 0, totalBlocks: 0 },

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

    addToolCall: (turn_id, toolCallId, tool, input) =>
      set((s) => {
        let messages = ensureAssistantMessage(s.messages, turn_id)
        messages = messages.map((m) => {
          if (m.turn_id !== turn_id || m.role !== 'assistant') return m
          const id = nextToolId(turn_id)
          return {
            ...m,
            contentBlocks: [
              ...m.contentBlocks,
              { type: 'tool_use' as const, id, toolCallId, tool, input, done: false },
            ],
          }
        })
        return { messages }
      }),

    finalizeToolCall: (turn_id, toolCallId, output, isError) =>
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.turn_id !== turn_id || m.role !== 'assistant') return m
          const contentBlocks = m.contentBlocks.map((b) => {
            if (b.type === 'tool_use' && b.toolCallId === toolCallId && !b.done) {
              // Clear subItems when finalized — final output replaces them
              return { ...b, output, isError, done: true, subItems: undefined }
            }
            return b
          })
          return { ...m, contentBlocks }
        }),
      })),

    updateToolSubItems: (turn_id, toolCallId, subItems) =>
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.turn_id !== turn_id || m.role !== 'assistant') return m
          const contentBlocks = m.contentBlocks.map((b) => {
            if (b.type === 'tool_use' && b.toolCallId === toolCallId && !b.done) {
              const toolCallCount = subItems.filter((si) => si.type === 'toolCall').length
              return {
                ...b,
                subItems,
                subItemCount: toolCallCount > 0 ? Math.max(b.subItemCount ?? 0, toolCallCount) : b.subItemCount,
              }
            }
            return b
          })
          return { ...m, contentBlocks }
        }),
      })),

    markAllToolsErrored: (turn_id) =>
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.turn_id !== turn_id || m.role !== 'assistant') return m
          const contentBlocks = m.contentBlocks.map((b) => {
            if (b.type === 'tool_use' && !b.done) {
              return { ...b, done: true, isError: true }
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

    setGenerating: (value) =>
      set({ isGenerating: value }),

    setPendingMessageCount: (value) =>
      set({ pendingMessageCount: Math.max(0, value) }),

    setCompactionState: (isCompacting, autoCompactionEnabled = true) =>
      set({ isCompacting, autoCompactionEnabled }),

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
        pendingMessageCount: 0,
      }),

    openFile: (file) =>
      set((s) => {
        const nextFile: OpenFile = {
          ...file,
          kind: 'file',
          tabKey: file.relativePath,
        }
        const exists = s.openFiles.some((f) => f.tabKey === nextFile.tabKey)
        const filtered = s.recentFiles.filter((p) => p !== file.relativePath)
        const newRecent = [file.relativePath, ...filtered].slice(0, 10)
        if (exists) {
          return {
            openFiles: s.openFiles.map((openFile) =>
              openFile.tabKey === nextFile.tabKey ? nextFile : openFile,
            ),
            activeFilePath: nextFile.tabKey,
            recentFiles: newRecent,
          }
        }
        return {
          openFiles: [nextFile, ...s.openFiles],
          activeFilePath: nextFile.tabKey,
          recentFiles: newRecent,
        }
      }),

    openDiff: (diff) =>
      set((s) => {
        const nextDiff: OpenDiff = {
          ...diff,
          kind: 'diff',
          tabKey: `diff:${diff.relativePath}`,
        }
        const exists = s.openFiles.some((f) => f.tabKey === nextDiff.tabKey)
        if (exists) {
          return {
            openFiles: s.openFiles.map((openFile) =>
              openFile.tabKey === nextDiff.tabKey ? nextDiff : openFile,
            ),
            activeFilePath: nextDiff.tabKey,
          }
        }
        return {
          openFiles: [nextDiff, ...s.openFiles],
          activeFilePath: nextDiff.tabKey,
        }
      }),

    closeFile: (tabKey) =>
      set((s) => {
        const idx = s.openFiles.findIndex((f) => f.tabKey === tabKey)
        if (idx === -1) return {}
        const newFiles = s.openFiles.filter((f) => f.tabKey !== tabKey)
        let newActive = s.activeFilePath
        if (s.activeFilePath === tabKey) {
          // Select right neighbor, then left, then null
          if (newFiles.length === 0) {
            newActive = null
          } else if (idx < newFiles.length) {
            newActive = newFiles[idx].tabKey
          } else {
            newActive = newFiles[newFiles.length - 1].tabKey
          }
        }
        return { openFiles: newFiles, activeFilePath: newActive }
      }),

    setActiveFile: (tabKey) => set({ activeFilePath: tabKey }),

    setGitBranch: (branch) => set({ gitBranch: branch }),

    setProjectRoot: (root) => set({ projectRoot: root }),

    saveScrollPosition: (sessionPath, scrollTop) =>
      set((s) => ({
        scrollPositions: { ...s.scrollPositions, [sessionPath]: scrollTop },
      })),

    setSessionPath: (path) => set({ currentSessionPath: path }),

    setSessionName: (name) => set({ currentSessionName: name }),
    setPermissionMode: (mode) => set({ permissionMode: mode }),
    setAutoModeState: (autoModeState) => set({ autoModeState }),

    addRecentFile: (relativePath) =>
      set((s) => {
        const filtered = s.recentFiles.filter((p) => p !== relativePath)
        return { recentFiles: [relativePath, ...filtered].slice(0, 10) }
      }),

    addSkillBlock: (turn_id, skillId, skillName, trigger, totalSteps) =>
      set((s) => {
        // Add skill block to a "skill" role message (or create assistant message placeholder)
        // We attach skill blocks to the nearest recent assistant message, or create one
        let messages = ensureAssistantMessage(s.messages, turn_id)
        messages = messages.map((m) => {
          if (m.turn_id !== turn_id || m.role !== 'assistant') return m
          const block: SkillBlock = {
            type: 'skill',
            id: skillId,
            skillId,
            skillName,
            trigger,
            steps: Array.from({ length: totalSteps }, (_, i): SkillStepState => ({
              index: i,
              status: 'pending',
            })),
            totalSteps,
            status: 'running',
            startedAt: Date.now(),
          }
          return { ...m, contentBlocks: [...m.contentBlocks, block] }
        })
        return { messages }
      }),

    updateSkillStep: (skillId, stepIndex, status, output, error) =>
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.role !== 'assistant') return m
          const contentBlocks = m.contentBlocks.map((b) => {
            if (b.type !== 'skill' || (b as SkillBlock).skillId !== skillId) return b
            const skill = b as SkillBlock
            const steps = skill.steps.map((step) => {
              if (step.index !== stepIndex) return step
              return { ...step, status, ...(output !== undefined ? { output } : {}), ...(error !== undefined ? { error } : {}) }
            })
            return { ...skill, steps }
          })
          return { ...m, contentBlocks }
        }),
      })),

    finalizeSkillBlock: (skillId, status) =>
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.role !== 'assistant') return m
          const contentBlocks = m.contentBlocks.map((b) => {
            if (b.type !== 'skill' || (b as SkillBlock).skillId !== skillId) return b
            return { ...b, status, endedAt: Date.now() } as SkillBlock
          })
          return { ...m, contentBlocks }
        }),
      })),
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
// Pane layout store — layout tree + active pane tracking
// ============================================================================

export type PaneOrientation = 'horizontal' | 'vertical'

// ----------------------------------------------------------------------------
// Layout tree types
// ----------------------------------------------------------------------------

export type SplitNode = {
  type: 'split'
  id: string
  orientation: 'horizontal' | 'vertical'
  children: LayoutNode[]  // 2+ elements
}

export type LeafNode = {
  type: 'leaf'
  paneId: string
}

export type LayoutNode = SplitNode | LeafNode

// ----------------------------------------------------------------------------
// Pure layout tree utilities
// ----------------------------------------------------------------------------

export function collectLeafIds(node: LayoutNode): string[] {
  if (node.type === 'leaf') return [node.paneId]
  return node.children.flatMap(collectLeafIds)
}

export function countLeaves(node: LayoutNode): number {
  if (node.type === 'leaf') return 1
  return node.children.reduce((acc, child) => acc + countLeaves(child), 0)
}

/**
 * Ghostty-style N-ary split insertion.
 *
 * When the active pane's parent already has the SAME orientation as the
 * requested split, the new pane is inserted flat into that parent (no extra
 * nesting). When orientations differ, a new nested 2-child split is created.
 */
export function splitNode(
  root: LayoutNode,
  targetPaneId: string,
  newPaneId: string,
  orientation: PaneOrientation,
  splitId: string,
): { layout: LayoutNode; inserted: boolean } {
  // Base: root is the target leaf — wrap in a new 2-child split
  if (root.type === 'leaf') {
    if (root.paneId !== targetPaneId) return { layout: root, inserted: false }
    return {
      layout: {
        type: 'split',
        id: splitId,
        orientation,
        children: [root, { type: 'leaf', paneId: newPaneId }],
      },
      inserted: true,
    }
  }

  // Check if any DIRECT child is the target leaf
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]
    if (child.type === 'leaf' && child.paneId === targetPaneId) {
      if (root.orientation === orientation) {
        // Same orientation → insert flat, right after the target
        const newChildren = [
          ...root.children.slice(0, i + 1),
          { type: 'leaf' as const, paneId: newPaneId },
          ...root.children.slice(i + 1),
        ]
        return { layout: { ...root, children: newChildren }, inserted: true }
      } else {
        // Different orientation → create a nested 2-child split
        const nested: SplitNode = {
          type: 'split',
          id: splitId,
          orientation,
          children: [child, { type: 'leaf', paneId: newPaneId }],
        }
        const newChildren = [...root.children]
        newChildren[i] = nested
        return { layout: { ...root, children: newChildren }, inserted: true }
      }
    }
  }

  // Recurse into children
  for (let i = 0; i < root.children.length; i++) {
    const result = splitNode(root.children[i], targetPaneId, newPaneId, orientation, splitId)
    if (result.inserted) {
      const newChildren = [...root.children]
      newChildren[i] = result.layout
      return { layout: { ...root, children: newChildren }, inserted: true }
    }
  }

  return { layout: root, inserted: false }
}

/**
 * Alias for splitNode — exported under the legacy name used in tests.
 */
export const splitLeaf = splitNode

function findFirstLeaf(node: LayoutNode): string {
  if (node.type === 'leaf') return node.paneId
  return findFirstLeaf(node.children[0])
}

/**
 * N-ary remove: removing from a 3+ child split shrinks it; removing from a
 * 2-child split collapses it (promotes the remaining child up).
 */
export function removeLeaf(
  root: LayoutNode,
  paneId: string,
): { layout: LayoutNode; siblingPaneId: string | null } {
  if (root.type === 'leaf') {
    return { layout: root, siblingPaneId: null }
  }

  // Check if any direct child is the target leaf
  const idx = root.children.findIndex(
    (c) => c.type === 'leaf' && (c as LeafNode).paneId === paneId,
  )
  if (idx !== -1) {
    const newChildren = root.children.filter((_, i) => i !== idx)
    // Prefer sibling to the left (or the new first if it was first)
    const siblingIdx = Math.min(idx, newChildren.length - 1)
    const siblingPaneId = newChildren.length > 0 ? findFirstLeaf(newChildren[siblingIdx]) : null

    if (newChildren.length === 1) {
      // Collapse — promote sole child
      return { layout: newChildren[0], siblingPaneId }
    }
    return { layout: { ...root, children: newChildren }, siblingPaneId }
  }

  // Recurse
  for (let i = 0; i < root.children.length; i++) {
    if (collectLeafIds(root.children[i]).includes(paneId)) {
      const result = removeLeaf(root.children[i], paneId)
      const newChildren = [...root.children]
      newChildren[i] = result.layout
      return { layout: { ...root, children: newChildren }, siblingPaneId: result.siblingPaneId }
    }
  }

  return { layout: root, siblingPaneId: null }
}

// ----------------------------------------------------------------------------
// Pane layout store
// ----------------------------------------------------------------------------

interface PanesLayoutState {
  layout: LayoutNode
  activePaneId: string
  nextSplitIndex: number
  splitPending: boolean

  splitPane: (targetPaneId: string, newPaneId: string, orientation: PaneOrientation) => boolean
  removePane: (paneId: string) => void
  setActivePane: (paneId: string) => void
  setSplitPending: (v: boolean) => void
}

export const usePanesStore = create<PanesLayoutState>((set, get) => ({
  layout: { type: 'leaf', paneId: 'pane-0' },
  activePaneId: 'pane-0',
  nextSplitIndex: 0,
  splitPending: false,

  splitPane: (targetPaneId, newPaneId, orientation) => {
    const { layout, nextSplitIndex } = get()
    const splitId = `split-${nextSplitIndex}`
    const { layout: newLayout, inserted } = splitNode(layout, targetPaneId, newPaneId, orientation, splitId)
    if (inserted) {
      set({ layout: newLayout, activePaneId: newPaneId, nextSplitIndex: nextSplitIndex + 1 })
    }
    return inserted
  },

  removePane: (paneId) => {
    const { layout, activePaneId } = get()
    const { layout: newLayout, siblingPaneId } = removeLeaf(layout, paneId)
    const newActiveId = activePaneId === paneId
      ? (siblingPaneId ?? 'pane-0')
      : activePaneId
    set({ layout: newLayout, activePaneId: newActiveId })
  },

  setActivePane: (paneId) => set({ activePaneId: paneId }),

  setSplitPending: (v) => set({ splitPending: v }),
}))

export function usePaneIds(): string[] {
  return usePanesStore((s) => collectLeafIds(s.layout))
}
