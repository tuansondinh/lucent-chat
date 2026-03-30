import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatPane } from '@/components/ChatPane'

const paneState = {
  messages: [],
  agentHealth: 'ready',
  isGenerating: false,
  pendingMessageCount: 0,
  isCompacting: false,
  autoCompactionEnabled: false,
  sessionEpoch: 0,
  currentModel: 'openai/gpt-5.4',
  currentSessionPath: null,
  projectRoot: '/tmp/project',
  contextUsagePct: null,
  autoModeState: { paused: false, consecutiveBlocks: 0, totalBlocks: 0 },
  permissionMode: 'accept-on-edit' as const,
  appendChunk: vi.fn(),
  finalizeMessage: vi.fn(),
  addUserMessage: vi.fn(),
  addToolCall: vi.fn(),
  finalizeToolCall: vi.fn(),
  addThinking: vi.fn(),
  appendThinkingChunk: vi.fn(),
  finalizeThinking: vi.fn(),
  startTextBlock: vi.fn(),
  finalizeTextBlock: vi.fn(),
  setHealth: vi.fn(),
  setPendingMessageCount: vi.fn(),
  setCompactionState: vi.fn(),
  addErrorMessage: vi.fn(),
  setModel: vi.fn(),
  loadHistory: vi.fn(),
  setSessionPath: vi.fn(),
  setSessionName: vi.fn(),
  setAutoModeState: vi.fn(),
  setGitBranch: vi.fn(),
  setProjectRoot: vi.fn(),
}

const paneStore = Object.assign(
  (selector?: (state: typeof paneState) => unknown) => (selector ? selector(paneState) : paneState),
  { getState: () => paneState },
)

vi.mock('@/store/pane-store', () => ({
  getPaneStore: () => paneStore,
  usePanesStore: (selector: (state: { swapPanes: typeof vi.fn }) => unknown) => selector({ swapPanes: vi.fn() }),
}))

vi.mock('@/lib/bridge', () => ({
  getBridge: () => ({
    gitListBranches: vi.fn().mockResolvedValue({ branches: ['main'], current: 'main' }),
    gitCheckoutBranch: vi.fn().mockResolvedValue('main'),
    pickFolder: vi.fn().mockResolvedValue(null),
    setPaneRoot: vi.fn().mockResolvedValue({ projectRoot: '/tmp/project' }),
    getPaneInfo: vi.fn().mockResolvedValue({ projectRoot: '/tmp/project' }),
    gitBranch: vi.fn().mockResolvedValue('main'),
    getHealth: vi.fn().mockResolvedValue({ agent: 'ready' }),
    getMessages: vi.fn().mockResolvedValue([]),
    getState: vi.fn().mockResolvedValue({ model: 'openai/gpt-5.4' }),
    newSession: vi.fn().mockResolvedValue({ cancelled: false }),
    compact: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue('turn-1'),
    abort: vi.fn().mockResolvedValue(undefined),
    setThinkingLevel: vi.fn().mockResolvedValue(undefined),
    approvalRespond: vi.fn().mockResolvedValue(undefined),
    onAgentChunk: vi.fn(() => () => {}),
    onAgentDone: vi.fn(() => () => {}),
    onToolStart: vi.fn(() => () => {}),
    onToolEnd: vi.fn(() => () => {}),
    onThinkingStart: vi.fn(() => () => {}),
    onThinkingChunk: vi.fn(() => () => {}),
    onThinkingEnd: vi.fn(() => () => {}),
    onTextBlockStart: vi.fn(() => () => {}),
    onTextBlockEnd: vi.fn(() => () => {}),
    onHealth: vi.fn(() => () => {}),
    onTurnState: vi.fn(() => () => {}),
    onError: vi.fn(() => () => {}),
    onPanePermissionModeChanged: vi.fn(() => () => {}),
    onApprovalRequest: vi.fn(() => () => {}),
  }),
}))

vi.mock('@/lib/capabilities', () => ({
  getCapabilities: () => ({ multiPane: true, splitPane: true, terminal: true, fileSystem: true, oauth: true }),
}))

vi.mock('@/lib/useVoice', () => ({
  useVoice: () => ({
    toggleVoice: vi.fn(),
    beginVoiceCapture: vi.fn(),
    finishVoiceCapture: vi.fn(),
    stopTts: vi.fn(),
    feedAgentChunk: vi.fn(),
    flushTts: vi.fn(),
  }),
}))

vi.mock('@/lib/useNotificationSound', () => ({
  useNotificationSound: () => ({ play: vi.fn() }),
}))

vi.mock('@/store/voice-store', () => ({
  useVoiceStore: () => ({
    active: false,
    activePaneId: null,
  }),
}))

vi.mock('@/lib/pane-refs', () => ({
  registerPaneElement: vi.fn(),
  registerPaneFocus: vi.fn(),
}))

vi.mock('@/components/ChatMessage', () => ({
  ChatMessage: () => <div>message</div>,
}))

vi.mock('@/components/ChatInput', () => ({
  ChatInput: React.forwardRef((_props, _ref) => <div>input</div>),
}))

vi.mock('@/components/ModelPicker', () => ({
  ModelPicker: () => null,
}))

vi.mock('@/components/ApprovalModal', () => ({
  ApprovalCard: () => null,
}))

vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  KbdGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('ChatPane hover strip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a non-zero-height hover target for pane drag and close controls', () => {
    render(
      <ChatPane
        paneId="pane-1"
        isActive
        sidebarCollapsed={false}
        voicePttShortcut="space"
        voiceAudioEnabled={false}
        textToSpeechMode={false}
        notificationSoundEnabled={false}
        onFocus={() => {}}
        onClose={() => {}}
      />,
    )

    const dragHandle = screen.getByTitle('Drag to reorder pane')
    const closeButton = screen.getByTitle('Close pane')

    expect(dragHandle.className).toContain('h-2')
    expect(dragHandle.className).toContain('hover:h-5')
    expect(closeButton.className).toContain('group-hover:opacity-100')
  })
})
