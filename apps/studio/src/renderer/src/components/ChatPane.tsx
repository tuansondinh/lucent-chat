/**
 * ChatPane — a single self-contained chat pane with its own agent process.
 *
 * Owns: per-pane store subscription, bridge event listeners (filtered to this pane),
 * submit/abort handlers, session state, and the full chat column UI.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { ChevronDown, Cpu, Folder, GitBranch, Loader2, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { ChatMessage } from './ChatMessage'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ModelPicker } from './ModelPicker'
import { ApprovalCard, type ApprovalRequest } from './ApprovalModal'
import { getPaneStore } from '../store/pane-store'
import { formatModelDisplay, getModelRefFromState } from '../lib/models'
import { useVoice } from '../lib/useVoice'
import { useVoiceStore } from '../store/voice-store'
import { registerPaneElement, registerPaneFocus } from '../lib/pane-refs'
import { Kbd, KbdGroup } from './ui/kbd'
import { getBridge } from '../lib/bridge'
import { getCapabilities } from '../lib/capabilities'
import { chrome } from '../lib/theme'

// ============================================================================
// UiSelectCard — shown when agent emits extension_ui_request / ask_user_questions
// ============================================================================

interface UiSelectRequest {
  paneId: string
  id: string
  method: 'select'
  title: string
  options: string[]
  allowMultiple?: boolean
  timeout?: number
}

function UiSelectCard({
  request,
  onRespond,
}: {
  request: UiSelectRequest
  onRespond: (selected: string | string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>([])

  const toggle = (opt: string) => {
    if (request.allowMultiple) {
      setSelected((prev) =>
        prev.includes(opt) ? prev.filter((s) => s !== opt) : [...prev, opt],
      )
    } else {
      onRespond(opt)
    }
  }

  return (
    <div className="mx-4 mb-2 flex flex-col gap-2 px-3 py-3 bg-accent/5 border border-accent/30 rounded-lg text-sm">
      <p className="font-medium text-text-primary">{request.title}</p>
      <div className="flex flex-wrap gap-2">
        {request.options.map((opt) => (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            className={[
              'px-3 py-1.5 rounded border text-xs font-medium transition-colors',
              selected.includes(opt)
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-secondary text-text-primary border-border hover:border-accent hover:text-accent',
            ].join(' ')}
          >
            {opt}
          </button>
        ))}
      </div>
      {request.allowMultiple && selected.length > 0 && (
        <button
          onClick={() => onRespond(selected)}
          className="self-start px-3 py-1.5 rounded bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors"
        >
          Confirm ({selected.length})
        </button>
      )}
    </div>
  )
}

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
// PaneFooter — shows git branch + project root + model picker, supports changing root
// ============================================================================

function PaneFooter({
  paneId,
  isActive,
  onFocus,
  onOpenModelPicker
}: {
  paneId: string
  isActive: boolean
  onFocus: () => void
  onOpenModelPicker: () => void
}) {
  const gitBranch = getPaneStore(paneId)((s) => s.gitBranch)
  const projectRoot = getPaneStore(paneId)((s) => s.projectRoot)
  const currentModel = getPaneStore(paneId)((s) => s.currentModel)
  const permissionMode = getPaneStore(paneId)((s) => s.permissionMode)
  const bridge = getBridge()
  const footerRef = useRef<HTMLDivElement>(null)
  const [footerWidth, setFooterWidth] = useState(0)
  const [branchListLoading, setBranchListLoading] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [checkoutTarget, setCheckoutTarget] = useState<string | null>(null)

  // Track footer width to conditionally show full permission mode label
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setFooterWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const showModeLabel = footerWidth > 320

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
    <div ref={footerRef} className={`flex items-center justify-between gap-3 px-3 py-1 border-t border-border ${chrome.bar} ${chrome.text} flex-shrink-0 select-none`}>
      <div className="flex min-w-0 items-center gap-3">
        {/* Git branch selector */}
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
              className="max-w-[180px] cursor-pointer appearance-none rounded-md border border-white/10 bg-white/10 py-1 pl-2 pr-6 text-[10px] text-text-primary transition-colors hover:border-white/20 focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-default disabled:opacity-60"
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

        {/* Project root */}
        <button
          onClick={() => void handleChangeRoot()}
          className="flex items-center gap-1 min-w-0 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          title="Change project root"
        >
          <Folder className="size-3 flex-shrink-0" />
          <span className="truncate max-w-[200px]">{shortRoot}</span>
        </button>
      </div>

      {/* Right side: permission mode indicator + model picker */}
      <div className="flex items-center gap-1">
      {/* Permission mode indicator */}
      <button
        onClick={() => bridge.togglePanePermissionMode?.(paneId).catch(() => {})}
        title={
          permissionMode === 'auto'
            ? 'Auto Mode — classifier filters tool calls'
            : permissionMode === 'accept-on-edit'
            ? 'Accept Edits — prompt before each change'
            : 'Bypass Permissions — no approval prompts'
        }
        className="flex items-center gap-1 px-1.5 py-0.5 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
        data-permission-mode={permissionMode}
      >
        {permissionMode === 'auto' ? (
          <ShieldCheck className="h-3 w-3 text-green-500 flex-shrink-0" />
        ) : permissionMode === 'accept-on-edit' ? (
          <ShieldAlert className="h-3 w-3 text-yellow-400 flex-shrink-0" />
        ) : (
          <Shield className="h-3 w-3 text-red-400 flex-shrink-0" />
        )}
        {showModeLabel && (
          <span
            className={`text-[10px] font-medium ${
              permissionMode === 'auto'
                ? 'text-green-500'
                : permissionMode === 'accept-on-edit'
                ? 'text-yellow-400'
                : 'text-red-400'
            }`}
          >
            {permissionMode === 'auto'
              ? 'Auto Mode'
              : permissionMode === 'accept-on-edit'
              ? 'Accept Edits'
              : 'Bypass Permissions'}
            <span className="ml-1 opacity-50 font-normal">⇧Tab</span>
          </span>
        )}
      </button>

      {/* Model picker */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (!isActive) onFocus()
          onOpenModelPicker()
        }}
        title={formatModelDisplay(currentModel, { includeProvider: true, fallback: 'Select model' })}
        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-text-primary opacity-70 transition-all hover:opacity-100 hover:text-accent-gray hover:bg-accent-gray/10"
      >
        <Cpu className="h-2.5 w-2.5 flex-shrink-0" />
        <span className="font-mono">{formatModelDisplay(currentModel, { fallback: 'Select model' })}</span>
        <ChevronDown className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
      </button>
      </div>
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
  /** Whether assistant TTS playback is enabled globally. */
  voiceAudioEnabled: boolean
  /** Called when user clicks on this pane to focus it. */
  onFocus: () => void
  /** Called to close this pane — undefined if this is the only pane. */
  onClose?: () => void
  /** Open a file in the file viewer for this pane. */
  onOpenFile?: (paneId: string, relativePath: string) => Promise<void>
  /** When true, hides terminal/file viewer/split-pane controls and fills full viewport width. */
  isMobile?: boolean
}

const SPACE_HOLD_TO_TALK_DELAY_MS = 220
const BRANCH_POLL_INTERVAL_MS = 3_000

const keyboardShortcuts = [
  { key: <><Kbd>⌘</Kbd><Kbd>K</Kbd></>, label: 'Command palette' },
  { key: <><Kbd>hold</Kbd><Kbd>␣</Kbd></>, label: 'Push to talk' },
  { key: <><Kbd>⌘</Kbd><Kbd>M</Kbd></>, label: 'Model picker' },
  { key: <><Kbd>⌘</Kbd><Kbd>E</Kbd></>, label: 'File explorer' },
  { key: <><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>F</Kbd></>, label: 'File viewer' },
  { key: <><Kbd>⌘</Kbd><Kbd>B</Kbd></>, label: 'Toggle sidebar' },
  { key: <><Kbd>⌘</Kbd><Kbd>D</Kbd></>, label: 'Split pane' },
  { key: <><Kbd>⌘</Kbd><Kbd>⌥</Kbd><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd></>, label: 'Navigate panes' },
  { key: <><Kbd>⇧</Kbd><Kbd>⇥</Kbd></>, label: 'Toggle permission mode' },
  { key: <><Kbd>esc</Kbd></>, label: 'Interrupt' },
  { key: <><Kbd>⌘</Kbd><Kbd>R</Kbd></>, label: 'Restart app' },
]

// ============================================================================
// ChatPane
// ============================================================================

export function ChatPane({
  paneId,
  isActive,
  sidebarCollapsed,
  voicePttShortcut,
  voiceAudioEnabled,
  onFocus,
  onClose,
  onOpenFile,
  isMobile = false,
}: ChatPaneProps) {
  const capabilities = getCapabilities()
  const store = getPaneStore(paneId)
  const {
    messages,
    agentHealth,
    isGenerating,
    pendingMessageCount,
    isCompacting,
    autoCompactionEnabled,
    sessionEpoch,
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
    setPendingMessageCount,
    setCompactionState,
    addErrorMessage,
    setModel,
    loadHistory,
    setSessionPath,
    setSessionName,
    currentModel,
    currentSessionPath,
    projectRoot,
  } = store()

  const bridge = getBridge()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLElement>(null)
  const inputRef = useRef<ChatInputHandle>(null)
  const pttPressedRef = useRef(false)
  const pttStartedVoiceRef = useRef(false)
  const pttActivationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pttShortcutHeldRef = useRef(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [queuedPrompt, setQueuedPrompt] = useState<{ label: string; text: string; imageDataUrl?: string } | null>(null)
  const [availableSkills, setAvailableSkills] = useState<Array<{ trigger: string; name: string; description: string }>>([])
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
  const [pendingUiSelect, setPendingUiSelect] = useState<UiSelectRequest | null>(null)
  const autoModeState = store((s) => s.autoModeState)

  // Helper to map bridge response to store shape
  const applyAutoModeState = useCallback((bridgeState: { paused: boolean; consecutive: number; total: number }) => {
    getPaneStore(paneId).getState().setAutoModeState({
      paused: bridgeState.paused,
      consecutiveBlocks: bridgeState.consecutive,
      totalBlocks: bridgeState.total,
    })
  }, [paneId])

  // Load auto mode state
  useEffect(() => {
    if (bridge.getAutoModeState && store.getState().permissionMode === 'auto') {
      bridge.getAutoModeState(paneId).then(applyAutoModeState).catch(() => {})
    }
  }, [bridge, paneId, applyAutoModeState, store().permissionMode])

  // Load skills for autocomplete
  useEffect(() => {
    if (bridge.skillList) {
      bridge.skillList().then((skills) => {
        setAvailableSkills(skills.map((s) => ({ trigger: s.trigger, name: s.name, description: s.description })))
      }).catch(() => {})
    }
  }, [bridge])

  // Voice integration — app-global store, but forwarding is scoped to this pane
  const voiceStore = useVoiceStore()
  const voiceOwnedByThisPane = voiceStore.active && voiceStore.activePaneId === paneId
  const { toggleVoice, beginVoiceCapture, finishVoiceCapture, stopTts, feedAgentChunk, flushTts } = useVoice({
    onTranscript: (text) => void handleSubmit(text),
    activePaneId: paneId,
    ttsEnabled: voiceAudioEnabled,
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

  // Register bridge event listeners filtered to THIS pane.
  // Capture sessionEpoch so stale events from a prior session are dropped.
  useEffect(() => {
    const epochAtMount = store.getState().sessionEpoch
    const isStale = () => store.getState().sessionEpoch !== epochAtMount
    const unsubs = [
      bridge.onAgentChunk(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId || isStale()) return
        store.getState().appendChunk(turn_id, text)
        // Forward chunk to TTS sentence accumulator when voice is active on this pane
        const voiceState = useVoiceStore.getState()
        if (isActive && voiceState.active && voiceState.activePaneId === paneId) feedAgentChunk(text, turn_id)
      }),
      bridge.onAgentDone(({ paneId: pid, turn_id, full_text }) => {
        if (pid !== paneId || isStale()) return
        store.getState().finalizeMessage(turn_id, full_text)
        // Flush remaining TTS buffer at end of turn
        const voiceState = useVoiceStore.getState()
        if (isActive && voiceState.active && voiceState.activePaneId === paneId) flushTts(turn_id)
      }),
      bridge.onToolStart(({ paneId: pid, turn_id, toolCallId, tool, input }) => {
        if (pid !== paneId || isStale()) return
        store.getState().addToolCall(turn_id, toolCallId, tool, input)
      }),
      bridge.onToolEnd(({ paneId: pid, turn_id, toolCallId, tool, output, isError }) => {
        if (pid !== paneId || isStale()) return
        store.getState().finalizeToolCall(turn_id, toolCallId, output, isError)
      }),
      ...(bridge.onToolUpdate ? [
        bridge.onToolUpdate(({ paneId: pid, turn_id, toolCallId, subItems }) => {
          if (pid !== paneId || isStale()) return
          store.getState().updateToolSubItems(turn_id, toolCallId, subItems)
        }),
      ] : []),
      bridge.onThinkingStart(({ paneId: pid, turn_id }) => {
        if (pid !== paneId || isStale()) return
        store.getState().addThinking(turn_id)
      }),
      bridge.onThinkingChunk(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId || isStale()) return
        store.getState().appendThinkingChunk(turn_id, text)
      }),
      bridge.onThinkingEnd(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId || isStale()) return
        store.getState().finalizeThinking(turn_id, text)
      }),
      bridge.onTextBlockStart(({ paneId: pid, turn_id }) => {
        if (pid !== paneId || isStale()) return
        store.getState().startTextBlock(turn_id)
      }),
      bridge.onTextBlockEnd(({ paneId: pid, turn_id }) => {
        if (pid !== paneId || isStale()) return
        store.getState().finalizeTextBlock(turn_id)
      }),
      bridge.onHealth(({ paneId: pid, states }) => {
        if (pid !== paneId) return
        store.getState().setHealth(states)
      }),
      bridge.onTurnState(({ paneId: pid, turn_id, state }) => {
        if (pid !== paneId || isStale()) return
        if (state === 'aborted' || state === 'idle') {
          store.getState().setGenerating(false)
        }
        if (state === 'aborted') {
          store.getState().markAllToolsErrored(turn_id)
        }
        void bridge.getState(paneId)
          .then((sessionState) => {
            store.getState().setPendingMessageCount(typeof sessionState.pendingMessageCount === 'number' ? sessionState.pendingMessageCount : 0)
            store.getState().setCompactionState(
              sessionState.isCompacting === true,
              sessionState.autoCompactionEnabled !== false,
            )
          })
          .catch(() => {})
      }),
      bridge.onError(({ paneId: pid, message }) => {
        if (pid !== paneId || isStale()) return
        // Mark all in-flight tools as errored on agent exit/crash
        const currentTurnId = store.getState().currentTurnId
        if (currentTurnId) {
          store.getState().markAllToolsErrored(currentTurnId)
        }
        store.getState().addErrorMessage(message)
        toast.error(message)
      }),
      // Skill events — optional (bridge may not have these in older preloads)
      ...(bridge.onSkillProgress ? [
        bridge.onSkillProgress(({ skillId, skillName, trigger, stepIndex, totalSteps, status, output, error }) => {
          const s = store.getState()
          // Create skill block on first step event
          if (stepIndex === 0 && status === 'running') {
            const currentTurnId = s.currentTurnId
            if (currentTurnId) {
              s.addSkillBlock(currentTurnId, skillId, skillName, trigger, totalSteps)
            }
          }
          s.updateSkillStep(skillId, stepIndex, status, output, error)
        }),
      ] : []),
      ...(bridge.onSkillComplete ? [
        bridge.onSkillComplete(({ skillId, status }) => {
          store.getState().finalizeSkillBlock(skillId, status)
        }),
      ] : []),
      ...(bridge.onClassifierDecision ? [
        bridge.onClassifierDecision((data) => {
          if (data.paneId !== paneId) return
          bridge.getAutoModeState?.(paneId).then(applyAutoModeState).catch(() => {})
          if (!data.approved) {
            toast.error(`Auto mode blocked ${data.toolName} (${data.source})`, {
              duration: 5000,
            })
          }
        }),
      ] : []),
      ...(bridge.onAutoModeResumed ? [
        bridge.onAutoModeResumed((data) => {
          if (data.paneId !== paneId) return
          bridge.getAutoModeState?.(paneId).then(applyAutoModeState).catch(() => {})
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
        store.getState().setPendingMessageCount(typeof state.pendingMessageCount === 'number' ? state.pendingMessageCount : 0)
        store.getState().setCompactionState(state.isCompacting === true, state.autoCompactionEnabled !== false)
      })
      .catch(() => {})

    return () => {
      unsubs.forEach((u) => u())
    }
  }, [paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false

    const syncPaneStateMeta = async () => {
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

        const state = await bridge.getState(paneId)
        if (cancelled) return
        store.getState().setPendingMessageCount(typeof state.pendingMessageCount === 'number' ? state.pendingMessageCount : 0)
        store.getState().setCompactionState(state.isCompacting === true, state.autoCompactionEnabled !== false)
      } catch {
        // Ignore transient git state failures.
      }
    }

    void syncPaneStateMeta()
    const intervalId = setInterval(() => {
      void syncPaneStateMeta()
    }, BRANCH_POLL_INTERVAL_MS)

    const handleWindowFocus = () => {
      void syncPaneStateMeta()
    }

    window.addEventListener('focus', handleWindowFocus)
    return () => {
      cancelled = true
      clearInterval(intervalId)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [bridge, paneId, store])

  const isReplyAudioPlaying = voiceOwnedByThisPane && voiceStore.ttsPlaying
  const isAssistantBusy = isGenerating || isReplyAudioPlaying

  // Submit handler
  const handleSubmit = useCallback(async (text: string, imageDataUrl?: string) => {
    const displayText = text || '[image]'

    if (isAssistantBusy) {
      if (queuedPrompt) return
      setQueuedPrompt({ label: displayText, text, imageDataUrl })
      return
    }

    try {
      const turn_id = await bridge.prompt(paneId, text, imageDataUrl)
      store.getState().addUserMessage(displayText, turn_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message'
      store.getState().addErrorMessage(msg)
    }
  }, [paneId, bridge, store, isAssistantBusy, queuedPrompt])

  useEffect(() => {
    if (!queuedPrompt || isAssistantBusy) return

    const nextPrompt = queuedPrompt
    setQueuedPrompt(null)
    void handleSubmit(nextPrompt.text, nextPrompt.imageDataUrl)
  }, [queuedPrompt, isAssistantBusy, handleSubmit])

  useEffect(() => {
    setQueuedPrompt(null)
  }, [currentSessionPath])

  const handleAbort = useCallback(() => {
    setQueuedPrompt(null)
    store.getState().setGenerating(false)
    stopTts()
    bridge.abort(paneId).catch(() => {})
  }, [paneId, bridge, store, stopTts])

  const handleOpenFileReference = useCallback(async (relativePath: string) => {
    if (!relativePath || !onOpenFile) return
    onFocus()
    await onOpenFile(paneId, relativePath)
  }, [onFocus, onOpenFile, paneId])

  const handleEditQueuedMessage = useCallback(() => {
    if (!queuedPrompt) return
    inputRef.current?.setDraft(queuedPrompt.text, queuedPrompt.imageDataUrl ?? null)
    setQueuedPrompt(null)
  }, [queuedPrompt])

  const handleClearQueuedMessage = useCallback(() => {
    setQueuedPrompt(null)
  }, [])

  // Listen for per-pane permission mode changes from main process
  useEffect(() => {
    if (!bridge.onPanePermissionModeChanged) return
    return bridge.onPanePermissionModeChanged((data) => {
      if (data.paneId !== paneId) return
      getPaneStore(paneId).getState().setPermissionMode(data.mode)
    })
  }, [bridge, paneId])

  // Listen for approval requests for THIS pane and show inline card
  useEffect(() => {
    if (!bridge.onApprovalRequest) return
    return bridge.onApprovalRequest((req) => {
      if (req.paneId !== paneId) return
      setPendingApproval(req)
    })
  }, [bridge, paneId])

  const handleApprovalRespond = useCallback(async (approved: boolean) => {
    if (!pendingApproval) return
    setPendingApproval(null)
    try {
      await bridge.approvalRespond?.(pendingApproval.paneId, pendingApproval.id, approved)
    } catch (err) {
      console.error('[approval-card] failed to send response:', err)
    }
  }, [bridge, pendingApproval])

  // Listen for UI select requests for THIS pane
  useEffect(() => {
    const b = bridge as any
    if (typeof b.onUiSelectRequest !== 'function') return
    return b.onUiSelectRequest((req: UiSelectRequest) => {
      if (req.paneId !== paneId) return
      setPendingUiSelect(req)
    })
  }, [bridge, paneId])

  const handleUiSelectRespond = useCallback(async (selected: string | string[]) => {
    if (!pendingUiSelect) return
    setPendingUiSelect(null)
    try {
      const b = bridge as any
      await b.uiSelectRespond?.(pendingUiSelect.paneId, pendingUiSelect.id, selected)
    } catch (err) {
      console.error('[ui-select] failed to send response:', err)
    }
  }, [bridge, pendingUiSelect])

  // Keyboard shortcuts for approval card: Cmd+Enter = allow, Escape = deny
  useEffect(() => {
    if (!pendingApproval) return
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'Enter') {
        e.preventDefault()
        void handleApprovalRespond(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        void handleApprovalRespond(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingApproval, handleApprovalRespond])

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
  const canQueueMessage = isAssistantBusy && !queuedPrompt
  const queuedMessageLabel = queuedPrompt?.label ?? null

  const isOnlyPane = !onClose

  // Pane-wide drag-and-drop: accept image/file drops anywhere in the pane
  const [isPaneDragging, setIsPaneDragging] = useState(false)

  const handlePaneDragOver = useCallback((e: React.DragEvent) => {
    const hasFiles = Array.from(e.dataTransfer.items).some((item) => item.kind === 'file')
    if (!hasFiles) return
    e.preventDefault()
    e.stopPropagation()
    setIsPaneDragging(true)
  }, [])

  const handlePaneDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the pane root itself (not a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsPaneDragging(false)
  }, [])

  const handlePaneDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsPaneDragging(false)

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
    if (!imageFile) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result
      if (typeof dataUrl === 'string') {
        inputRef.current?.setImage(dataUrl)
        if (!isActive) onFocus()
      }
    }
    reader.readAsDataURL(imageFile)
  }, [inputRef, isActive, onFocus])

  return (
    <>
      <div
        ref={rootRef}
        className={[
          'flex flex-1 flex-col h-full min-w-0 w-full overflow-hidden',
          isMobile ? 'w-full' : '',
          isActive && !isOnlyPane ? 'outline outline-1 outline-accent/30' : '',
          isPaneDragging ? 'outline outline-2 outline-accent/60' : '',
        ].join(' ')}
        onClick={!isActive ? onFocus : undefined}
        onDragOver={handlePaneDragOver}
        onDragLeave={handlePaneDragLeave}
        onDrop={handlePaneDrop}
      >
        {/* Messages area */}
        <main
          ref={scrollContainerRef as React.RefObject<HTMLElement | null>}
          className="flex-1 overflow-y-auto px-4 py-3 min-h-0"
        >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-2xl font-semibold text-text-primary">Lucent Code</div>
            <p className="text-sm text-text-secondary max-w-xs">
              {agentHealth === 'ready'
                ? 'Ask anything to get started.'
                : agentHealth === 'starting'
                  ? 'Agent is starting up...'
                  : agentHealth === 'crashed'
                    ? 'Agent crashed. Restarting automatically...'
                    : 'Connecting to agent...'}
            </p>
            {/* Keyboard shortcut hints — desktop only (not useful on mobile) */}
            {agentHealth === 'ready' && !isMobile && capabilities.multiPane && (
              <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 max-w-md w-full">
                {keyboardShortcuts.map((shortcut) => (
                  <div key={shortcut.label} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-text-secondary">{shortcut.label}</span>
                    <KbdGroup>{shortcut.key}</KbdGroup>
                  </div>
                ))}
              </div>
            )}
            {agentHealth === 'ready' && !isMobile && !capabilities.multiPane && (
              <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 max-w-md w-full">
                {keyboardShortcuts.filter(s => !['Split pane', 'Navigate panes', 'File explorer', 'File viewer'].includes(s.label)).map((shortcut) => (
                  <div key={shortcut.label} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-text-secondary">{shortcut.label}</span>
                    <KbdGroup>{shortcut.key}</KbdGroup>
                  </div>
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
              return showThinking ? <ThinkingBubble /> : (
                // Show subtle streaming indicator when assistant has content
                <div className="flex w-full mb-4 justify-start">
                  <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-accent/10 border border-accent/30">
                    <Loader2 className="size-3 animate-spin text-accent" />
                    <span className="text-xs text-accent font-medium">Streaming...</span>
                  </div>
                </div>
              )
            })()}
            <div ref={messagesEndRef} />
          </div>
        )}
        </main>

        {/* Inline approval card — shown when agent requests edit/write approval */}
        {pendingApproval && (
          <ApprovalCard
            request={pendingApproval}
            onRespond={(approved) => void handleApprovalRespond(approved)}
          />
        )}

        {/* Inline UI select card — shown when agent emits ask_user_questions */}
        {pendingUiSelect && (
          <UiSelectCard
            request={pendingUiSelect}
            onRespond={(selected) => void handleUiSelectRespond(selected)}
          />
        )}

        {/* Auto Mode Paused Banner */}
        {autoModeState.paused && store().permissionMode === 'auto' && (
          <div className="mx-4 mb-2 flex items-center justify-between gap-3 px-3 py-2 bg-yellow-400/10 border border-yellow-400/30 rounded-lg text-xs text-yellow-400">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <span>Auto mode paused due to frequent blocks. Manual approval required.</span>
            </div>
            <button
              onClick={async () => {
                const newState = await bridge.resumeAutoMode?.(paneId)
                if (newState) applyAutoModeState(newState)
              }}
              className="px-2 py-1 bg-yellow-400 text-black font-semibold rounded hover:bg-yellow-300 transition-colors"
            >
              Resume
            </button>
          </div>
        )}

        {/* Input bar */}
        <div className="flex-shrink-0 w-full">
          <ChatInput
            ref={inputRef}
            onSubmit={(t, img) => void handleSubmit(t, img)}
            onAbort={handleAbort}
            isGenerating={isGenerating}
            canQueueMessage={canQueueMessage}
            hasQueuedMessage={Boolean(queuedPrompt)}
            queuedMessageLabel={queuedMessageLabel}
            disabled={inputDisabled}
            skills={availableSkills}
            voiceAvailable={voiceStore.available}
            voiceActive={voiceOwnedByThisPane}
            voiceSidecarState={voiceStore.sidecarState}
            isSpeaking={voiceOwnedByThisPane ? voiceStore.speaking : false}
            isTtsPlaying={voiceOwnedByThisPane ? voiceStore.ttsPlaying : false}
            partialTranscript={voiceOwnedByThisPane ? voiceStore.partialTranscript : ''}
            unavailableReason={voiceStore.unavailableReason}
            onVoiceToggle={toggleVoice}
            onStopTts={stopTts}
            onEditQueuedMessage={handleEditQueuedMessage}
            onClearQueuedMessage={handleClearQueuedMessage}
            isMobile={isMobile}
          />
        </div>

        {/* Per-pane footer — git branch + project root + model picker (desktop only) */}
        {!isMobile && (
          <PaneFooter
            paneId={paneId}
            isActive={isActive}
            onFocus={onFocus}
            onOpenModelPicker={() => setModelPickerOpen(true)}
          />
        )}
      </div>
      <ModelPicker open={modelPickerOpen} onOpenChange={setModelPickerOpen} paneId={paneId} />
    </>
  )
}
