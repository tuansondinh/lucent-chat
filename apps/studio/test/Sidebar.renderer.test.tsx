import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Sidebar } from '@/components/Sidebar'

const bridgeMock = {
  getSessions: vi.fn(),
  switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
  renameSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@/store/pane-store', () => ({
  getPaneStore: () => () => ({
    currentModel: 'gpt-5.4',
    currentSessionName: 'Example Session',
  }),
}))

vi.mock('@/store/file-tree-store', () => ({
  getFileTreeStore: () => (selector: (state: { changedFiles: unknown[] }) => unknown) => selector({ changedFiles: [] }),
}))

vi.mock('@/lib/bridge', () => ({
  getBridge: () => bridgeMock,
}))

vi.mock('@/components/FileTree', () => ({
  FileTree: () => <div>file tree</div>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

describe('Sidebar session actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeMock.getSessions.mockResolvedValue([
      {
        path: '/tmp/example.jsonl',
        name: 'Example Session',
        modified: Date.now(),
        project: {
          projectRoot: '/tmp/project',
          sessionPath: '/tmp/example.jsonl',
          sessionName: 'Example Session',
          firstPrompt: 'Example Session',
        },
      },
    ])
  })

  it('keeps the delete controls anchored to the right side of the session row', async () => {
    render(
      <Sidebar
        collapsed={false}
        onToggleCollapse={() => {}}
        currentSessionPath={null}
        activePaneId="pane-1"
        view="sessions"
        onViewChange={() => {}}
        onNewSession={() => {}}
        onSwitchSession={() => {}}
        onRefresh={() => {}}
        voiceAudioEnabled={false}
        onVoiceAudioEnabledChange={() => {}}
      />,
    )

    const sessionButton = await screen.findByRole('button', { name: /example session/i })
    const renameButton = screen.getByRole('button', { name: /rename session/i })
    const deleteButton = screen.getByRole('button', { name: /delete session/i })

    expect(sessionButton.className).not.toContain('pr-16')
    expect(deleteButton.parentElement?.className).toContain('flex')
    expect(deleteButton.parentElement?.className).not.toContain('absolute')
    expect(renameButton.className).toContain('opacity-0')
    expect(renameButton.className).toContain('group-hover:opacity-100')
    expect(deleteButton.className).toContain('opacity-0')
    expect(deleteButton.className).toContain('group-hover:opacity-100')
  })

  it('opens the rename dialog from the inline rename button', async () => {
    render(
      <Sidebar
        collapsed={false}
        onToggleCollapse={() => {}}
        currentSessionPath={null}
        activePaneId="pane-1"
        view="sessions"
        onViewChange={() => {}}
        onNewSession={() => {}}
        onSwitchSession={() => {}}
        onRefresh={() => {}}
        voiceAudioEnabled={false}
        onVoiceAudioEnabledChange={() => {}}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /rename session/i }))

    expect(screen.getByText('Rename Session')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Example Session')).toBeInTheDocument()
  })

  it('deletes a session from the inline trash button', async () => {
    render(
      <Sidebar
        collapsed={false}
        onToggleCollapse={() => {}}
        currentSessionPath={null}
        activePaneId="pane-1"
        view="sessions"
        onViewChange={() => {}}
        onNewSession={() => {}}
        onSwitchSession={() => {}}
        onRefresh={() => {}}
        voiceAudioEnabled={false}
        onVoiceAudioEnabledChange={() => {}}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /delete session/i }))

    await waitFor(() => {
      expect(bridgeMock.deleteSession).toHaveBeenCalledWith('pane-1', '/tmp/example.jsonl')
    })
  })
})
