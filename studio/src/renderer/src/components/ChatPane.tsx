/**
 * ChatPane — a single self-contained chat pane with its own agent process.
 *
 * Owns: per-pane store subscription, bridge event listeners (filtered to this pane),
 * submit/abort handlers, session state, and the full chat column UI.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { ChevronDown, Cpu, Folder, GitBranch, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ChatMessage } from './ChatMessage'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ModelPicker } from './ModelPicker'
import { getPaneStore } from '../store/pane-store'
import { formatModelDisplay, getModelRefFromState } from '../lib/models'
import { useVoice } from '../lib/useVoice'
import { useVoiceStore } from '../store/voice-store'
import { registerPaneElement, registerPaneFocus } from '../lib/pane-refs'

// ============================================================================
// ThinkingBubble (local copy to avoid circular dep with App.tsx)
// ============================================================================

function ThinkingBubble() {
  return (
    <div className="flex w-full mb-4 justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm px-4 py-3 bg-bg-secondary border border-border">
        <span className="w-2 h-2 rounded-full bg-accent opacity-60 animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-accent opacity-60 animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-accent opacity-60 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  )
}

// ============================================================================
// PaneFooter — shows git branch + project root, supports changing root
// ============================================================================

function PaneFooter({ paneId }: { paneId: string }) {
  const gitBranch = getPaneStore(paneId)((s) => s.gitBranch)
  const projectRoot = getPaneStore(paneId)((s) => s.projectRoot)
  const bridge = window.bridge
  const [branchListLoading, setBranchListLoading] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [checkoutTarget, setCheckoutTarget] = useState<string | null>(null)

  const shortRoot = projectRoot
    ? projectRoot.replace(/^\/Users\/[^/]+/, '~')
    : '-'

  const loadBranches = useCallback(async () => {
    setBranchListLoading(true)
    try {
      const result = await bridge.gitListBranches(paneId)
      setBranches(result.branches)
      getPaneStore(paneId).getState().setGitBranch(result.current)
    } catch {
      setBranches(gitBranch ? [gitBranch] : [])
    } finally {
      setBranchListLoading(false)
    }
  }, [bridge, gitBranch, paneId])

  useEffect(() => {
    void loadBranches()
  }, [loadBranches, projectRoot])

  const handleCheckoutBranch = useCallback(async (branch: string) => {
    if (!branch || branch === gitBranch) {
      return
    }

    setCheckoutTarget(branch)
    try {
      const nextBranch = await bridge.gitCheckoutBranch(paneId, branch)
      if (!nextBranch) {
        throw new Error(`Failed to switch to ${branch}`)
      }

      getPaneStore(paneId).getState().setGitBranch(nextBranch)
      setBranches((current) => {
        if (current.includes(nextBranch)) return current
        return [...current, nextBranch].sort((a, b) => a.localeCompare(b))
      })
      toast.success(`Switched to ${nextBranch}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to switch to ${branch}`
      toast.error(message)
    } finally {
      setCheckoutTarget(null)
    }
  }, [bridge, gitBranch, paneId])

  const handleChangeRoot = useCallback(async () => {
    try {
      const folder = await bridge.pickFolder()
      if (folder) {
        await bridge.setPaneRoot(paneId, folder)
        const info = await bridge.getPaneInfo(paneId)
        getPaneStore(paneId).getState().setProjectRoot(info.projectRoot)
        const branch = await bridge.gitBranch(paneId)
        getPaneStore(paneId).getState().setGitBranch(branch)
        setBranches([])
      }
    } catch {
      // ignore picker errors
    }
  }, [paneId, bridge])

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1 border-t border-border bg-bg-secondary text-[10px] text-text-tertiary flex-shrink-0 select-none">
      <div className="flex min-w-0 items-center gap-1">
        {checkoutTarget || branchListLoading ? (
          <Loader2 className="size-3 flex-shrink-0 animate-spin" />
        ) : (
          <GitBranch className="size-3 flex-shrink-0" />
        )}
        <div className="relative min-w-0">
          <select
            value={gitBranch ?? ''}
            onChange={(event) => {
              void handleCheckoutBranch(event.target.value)
            }}
            title="Switch git branch"
            disabled={Boolean(checkoutTarget) || (branches.length === 0 && branchListLoading)}
            className="max-w-[180px] cursor-pointer appearance-none rounded-md border border-border bg-bg-primary py-1 pl-2 pr-6 text-[10px] text-text-secondary transition-colors hover:border-border-active hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-default disabled:opacity-60"
          >
            {gitBranch && !branches.includes(gitBranch) ? (
              <option value={gitBranch}>{gitBranch}</option>
            ) : null}
            {branches.length === 0 ? (
              <option value="">{branchListLoading ? 'Loading branches...' : 'No branches'}</option>
            ) : (
              branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 opacity-60" />
        </div>
      </div>
      <button
        onClick={() => void handleChangeRoot()}
        className="flex items-center gap-1 min-w-0 hover:text-text-primary transition-colors cursor-pointer"
        title="Change project root"
      >
        <Folder className="size-3 flex-shrink-0" />
        <span className="truncate max-w-[200px]">{shortRoot}</span>
      </button>
    </div>
  )
}

// ============================================================================
// Props
// ============================================================================

interface ChatPaneProps {
  paneId: string
  isActive: boolean
  /** Show collapse sidebar padding (true = sidebar icon strip is visible). */
  sidebarCollapsed: boolean
  /** Configured push-to-talk shortcut for this pane when active. */
  voicePttShortcut: 'space' | 'alt+space' | 'cmd+shift+space'
  /** Called when user clicks on this pane to focus it. */
  onFocus: () => void
  /** Called to close this pane — undefined if this is the only pane. */
  onClose?: () => void
  /** Open a file in the file viewer for this pane. */
  onOpenFile?: (paneId: string, relativePath: string) => Promise<void>
}

const SPACE_HOLD_TO_TALK_DELAY_MS = 220
const BRANCH_POLL_INTERVAL_MS = 3_000

const suggestions = [
  'What can you help me with?',
  'Show me the project structure',
  'Read the README',
  'What files are here?',
]

// ============================================================================
// ChatPane
// ============================================================================

export function ChatPane({ paneId, isActive, sidebarCollapsed, voicePttShortcut, onFocus, onClose, onOpenFile }: ChatPaneProps) {
  const store = getPaneStore(paneId)
  const {
    messages,
    agentHealth,
    isGenerating,
    appendChunk,
    finalizeMessage,
    addUserMessage,
    addToolCall,
    finalizeToolCall,
    addThinking,
    appendThinkingChunk,
    finalizeThinking,
    startTextBlock,
    finalizeTextBlock,
    setHealth,
    addErrorMessage,
    setModel,
    loadHistory,
    setSessionPath,
    setSessionName,
    currentModel,
    projectRoot,
    addSubagentBlock,
    updateSubagentStatus,
    activeSubagentCount,
  } = store()

  const bridge = window.bridge
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLElement>(null)
  const inputRef = useRef<ChatInputHandle>(null)
  const pttPressedRef = useRef(false)
  const pttStartedVoiceRef = useRef(false)
  const pttActivationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pttShortcutHeldRef = useRef(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  // Voice integration — app-global store, but forwarding is scoped to this pane
  const voiceStore = useVoiceStore()
  const voiceOwnedByThisPane = voiceStore.active && voiceStore.activePaneId === paneId
  const { toggleVoice, beginVoiceCapture, finishVoiceCapture, stopTts, feedAgentChunk, flushTts } = useVoice({
    onTranscript: (text) => void handleSubmit(text),
    activePaneId: paneId,
  })

  // Stable callback ref for root div — registers the element for spatial navigation
  const rootRef = useCallback((el: HTMLDivElement | null) => {
    registerPaneElement(paneId, el)
  }, [paneId])

  // Register focus callback and clean up on unmount
  useEffect(() => {
    registerPaneFocus(paneId, () => inputRef.current?.focus())
    return () => {
      registerPaneElement(paneId, null)
      registerPaneFocus(paneId, null)
    }
  }, [paneId])

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const matchesVoiceShortcut = (e: KeyboardEvent): boolean => {
      switch (voicePttShortcut) {
        case 'space':
          return !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'Space'
        case 'alt+space':
          return e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'Space'
        case 'cmd+shift+space':
          return e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'Space'
      }
    }

    const isVoiceShortcutRelease = (e: KeyboardEvent): boolean => {
      switch (voicePttShortcut) {
        case 'space':
          return e.code === 'Space'
        case 'alt+space':
          return e.code === 'Space' || e.code === 'AltLeft' || e.code === 'AltRight'
        case 'cmd+shift+space':
          return e.code === 'Space' || e.code === 'MetaLeft' || e.code === 'MetaRight' || e.code === 'ShiftLeft' || e.code === 'ShiftRight'
      }
    }

    const clearPttActivationTimer = () => {
      if (pttActivationTimerRef.current) {
        clearTimeout(pttActivationTimerRef.current)
        pttActivationTimerRef.current = null
      }
    }

    const startPushToTalk = () => {
      if (pttPressedRef.current) return
      pttPressedRef.current = true

      const voiceState = useVoiceStore.getState()
      if (!voiceState.active || voiceState.activePaneId !== paneId) {
        pttStartedVoiceRef.current = true
      }
      void beginVoiceCapture()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesVoiceShortcut(e)) return
      if (!isActive) return

      if (voicePttShortcut === 'space') {
        pttShortcutHeldRef.current = true

        if (pttPressedRef.current) {
          e.preventDefault()
          return
        }
        if (e.repeat || pttActivationTimerRef.current) {
          return
        }

        pttActivationTimerRef.current = setTimeout(() => {
          pttActivationTimerRef.current = null
          if (!pttShortcutHeldRef.current) return
          startPushToTalk()
        }, SPACE_HOLD_TO_TALK_DELAY_MS)
        return
      }

      if (e.repeat || pttPressedRef.current) return

      e.preventDefault()
      startPushToTalk()
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isVoiceShortcutRelease(e)) return

      pttShortcutHeldRef.current = false
      clearPttActivationTimer()
      if (!pttPressedRef.current) return

      e.preventDefault()
      pttPressedRef.current = false

      if (pttStartedVoiceRef.current) {
        pttStartedVoiceRef.current = false
        const voiceState = useVoiceStore.getState()
        if (voiceState.active && voiceState.activePaneId === paneId) {
          finishVoiceCapture()
        }
      }
    }

    const handleBlur = () => {
      pttShortcutHeldRef.current = false
      clearPttActivationTimer()
      const wasPressed = pttPressedRef.current
      pttPressedRef.current = false
      if (!wasPressed) {
        pttStartedVoiceRef.current = false
        return
      }
      if (pttStartedVoiceRef.current) {
        pttStartedVoiceRef.current = false
        const voiceState = useVoiceStore.getState()
        if (voiceState.active && voiceState.activePaneId === paneId) {
          finishVoiceCapture()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      clearPttActivationTimer()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [beginVoiceCapture, finishVoiceCapture, isActive, paneId, voicePttShortcut])

  // Register bridge event listeners filtered to THIS pane
  useEffect(() => {
    const unsubs = [
      bridge.onAgentChunk(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId) return
        store.getState().appendChunk(turn_id, text)
        // Forward chunk to TTS sentence accumulator when voice is active on this pane
        const voiceState = useVoiceStore.getState()
        if (isActive && voiceState.active && voiceState.activePaneId === paneId) feedAgentChunk(text, turn_id)
      }),
      bridge.onAgentDone(({ paneId: pid, turn_id, full_text }) => {
        if (pid !== paneId) return
        store.getState().finalizeMessage(turn_id, full_text)
        // Flush remaining TTS buffer at end of turn
        const voiceState = useVoiceStore.getState()
        if (isActive && voiceState.active && voiceState.activePaneId === paneId) flushTts(turn_id)
      }),
      bridge.onToolStart(({ paneId: pid, turn_id, tool, input }) => {
        if (pid !== paneId) return
        store.getState().addToolCall(turn_id, tool, input)
      }),
      bridge.onToolEnd(({ paneId: pid, turn_id, tool, output, isError }) => {
        if (pid !== paneId) return
        store.getState().finalizeToolCall(turn_id, tool, output, isError)
      }),
      bridge.onThinkingStart(({ paneId: pid, turn_id }) => {
        if (pid !== paneId) return
        store.getState().addThinking(turn_id)
      }),
      bridge.onThinkingChunk(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId) return
        store.getState().appendThinkingChunk(turn_id, text)
      }),
      bridge.onThinkingEnd(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId) return
        store.getState().finalizeThinking(turn_id, text)
      }),
      bridge.onTextBlockStart(({ paneId: pid, turn_id }) => {
        if (pid !== paneId) return
        store.getState().startTextBlock(turn_id)
      }),
      bridge.onTextBlockEnd(({ paneId: pid, turn_id }) => {
        if (pid !== paneId) return
        store.getState().finalizeTextBlock(turn_id)
      }),
      bridge.onHealth(({ paneId: pid, states }) => {
        if (pid !== paneId) return
        store.getState().setHealth(states)
      }),
      bridge.onTurnState(({ paneId: pid, state }) => {
        if (pid !== paneId) return
        if (state === 'aborted' || state === 'idle') {
          store.getState().setGenerating(false)
        }
      }),
      bridge.onError(({ paneId: pid, message }) => {
        if (pid !== paneId) return
        store.getState().addErrorMessage(message)
        toast.error(message)
      }),
      // Subagent events — optional (bridge may not have these methods in older preloads)
      ...(bridge.onSubagentState ? [
        bridge.onSubagentState(({ turn_id, subagentId, status }) => {
          const s = store.getState()
          if (status === 'running') {
            // Will be added via onSubagentChunk or a separate spawn event
          } else {
            s.updateSubagentStatus(turn_id, subagentId, status as 'running' | 'done' | 'error', Date.now())
          }
        }),
      ] : []),
      ...(bridge.onSubagentDone ? [
        bridge.onSubagentDone(({ turn_id, subagentId }) => {
          store.getState().updateSubagentStatus(turn_id, subagentId, 'done', Date.now())
        }),
      ] : []),
    ]

    // Fetch initial state for this pane
    bridge.getHealth(paneId).then((states) => store.getState().setHealth(states)).catch(() => {})
    bridge
      .getState(paneId)
      .then((state) => {
        const modelRef = getModelRefFromState(state)
        if (modelRef) {
          store.getState().setModel(modelRef)
        }
        if (typeof state.sessionFile === 'string' && state.sessionFile) {
          store.getState().setSessionPath(state.sessionFile)
        }
        if (typeof state.sessionName === 'string' && state.sessionName) {
          store.getState().setSessionName(state.sessionName)
        }
      })
      .catch(() => {})

    return () => {
      unsubs.forEach((u) => u())
    }
  }, [paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false

    const syncPaneGitState = async () => {
      try {
        const info = await bridge.getPaneInfo(paneId)
        if (cancelled) return

        const paneState = store.getState()
        if (info.projectRoot !== paneState.projectRoot) {
          paneState.setProjectRoot(info.projectRoot)
        }

        const branch = await bridge.gitBranch(paneId)
        if (cancelled) return

        if (branch !== store.getState().gitBranch) {
          store.getState().setGitBranch(branch)
        }
      } catch {
        // Ignore transient git state failures.
      }
    }

    void syncPaneGitState()
    const intervalId = setInterval(() => {
      void syncPaneGitState()
    }, BRANCH_POLL_INTERVAL_MS)

    const handleWindowFocus = () => {
      void syncPaneGitState()
    }

    window.addEventListener('focus', handleWindowFocus)
    return () => {
      cancelled = true
      clearInterval(intervalId)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [bridge, paneId, store])

  // Submit handler
  const handleSubmit = useCallback(async (text: string, imageDataUrl?: string) => {
    try {
      const fullText = imageDataUrl
        ? (text ? `${text}\n[image: ${imageDataUrl}]` : `[image: ${imageDataUrl}]`)
        : text
      const turn_id = await bridge.prompt(paneId, fullText)
      store.getState().addUserMessage(text || '[image]', turn_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message'
      store.getState().addErrorMessage(msg)
    }
  }, [paneId, bridge, store])

  const handleAbort = useCallback(() => {
    store.getState().setGenerating(false)
    stopTts()
    bridge.abort(paneId).catch(() => {})
  }, [paneId, bridge, store, stopTts])

  const handleOpenFileReference = useCallback(async (relativePath: string) => {
    if (!relativePath || !onOpenFile) return
    onFocus()
    await onOpenFile(paneId, relativePath)
  }, [onFocus, onOpenFile, paneId])

  useEffect(() => {
    const handleStopActivePane = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId: string }>).detail
      if (!isActive || detail?.paneId !== paneId) return
      handleAbort()
    }

    window.addEventListener('lucent:stop-active-pane', handleStopActivePane as EventListener)
    return () => {
      window.removeEventListener('lucent:stop-active-pane', handleStopActivePane as EventListener)
    }
  }, [handleAbort, isActive, paneId])

  const inputDisabled = agentHealth === 'crashed' || agentHealth === 'degraded'

  const isOnlyPane = !onClose

  return (
    <>
      <div
        ref={rootRef}
        className={[
          'flex flex-1 flex-col h-full min-w-0 w-full overflow-hidden',
          isActive && !isOnlyPane ? 'outline outline-1 outline-accent/30' : '',
        ].join(' ')}
        onClick={!isActive ? onFocus : undefined}
      >
        {/* Messages area */}
        <main
          ref={scrollContainerRef as React.RefObject<HTMLElement | null>}
          className="flex-1 overflow-y-auto px-4 py-3 min-h-0"
        >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-2xl font-semibold text-text-primary">Lucent Chat</div>
            <p className="text-sm text-text-secondary max-w-xs">
              {agentHealth === 'ready'
                ? 'Ask anything to get started.'
                : agentHealth === 'starting'
                  ? 'Agent is starting up...'
                  : agentHealth === 'crashed'
                    ? 'Agent crashed. Restarting automatically...'
                    : 'Connecting to agent...'}
            </p>
            {agentHealth === 'ready' && (
              <div className="mt-3 grid grid-cols-2 gap-2 max-w-md w-full">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void handleSubmit(s)}
                    disabled={inputDisabled || isGenerating}
                    className="rounded-xl border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-secondary hover:border-border-active hover:text-text-primary transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="w-full">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                projectRoot={projectRoot}
                onOpenFileReference={handleOpenFileReference}
              />
            ))}
            {isGenerating && (() => {
              const last = messages[messages.length - 1]
              const showThinking = !last || last.role === 'user' || (last.role === 'assistant' && last.contentBlocks.length === 0)
              return showThinking ? <ThinkingBubble /> : null
            })()}
            <div ref={messagesEndRef} />
          </div>
        )}
        </main>

        {/* Input bar */}
        <div className="flex-shrink-0 w-full">
          <ChatInput
            ref={inputRef}
            onSubmit={(t, img) => void handleSubmit(t, img)}
            onAbort={handleAbort}
            isGenerating={isGenerating}
            disabled={inputDisabled}
            voiceAvailable={voiceStore.available}
            voiceActive={voiceOwnedByThisPane}
            voiceSidecarState={voiceStore.sidecarState}
            isSpeaking={voiceOwnedByThisPane ? voiceStore.speaking : false}
            isTtsPlaying={voiceOwnedByThisPane ? voiceStore.ttsPlaying : false}
            partialTranscript={voiceOwnedByThisPane ? voiceStore.partialTranscript : ''}
            unavailableReason={voiceStore.unavailableReason}
            onVoiceToggle={toggleVoice}
            onStopTts={stopTts}
          />
        </div>

        {/* Per-pane model picker bar */}
        <div className="flex-shrink-0 flex items-center justify-center border-t border-border/40 py-1">
          <button
            onClick={(e) => { e.stopPropagation(); if (!isActive) onFocus(); setModelPickerOpen(true) }}
            title={formatModelDisplay(currentModel, { includeProvider: true, fallback: 'Select model' })}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-text-tertiary transition-colors hover:text-text-secondary hover:bg-bg-hover"
          >
            <Cpu className="h-2.5 w-2.5 flex-shrink-0" />
            <span className="font-mono">{formatModelDisplay(currentModel, { fallback: 'Select model' })}</span>
            <ChevronDown className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
          </button>
        </div>

        {/* Per-pane footer — git branch + project root */}
        <PaneFooter paneId={paneId} />
      </div>
      <ModelPicker open={modelPickerOpen} onOpenChange={setModelPickerOpen} paneId={paneId} />
    </>
  )
}
