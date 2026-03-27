/**
 * CommandPalette — fuzzy-searchable command palette opened via Cmd+K.
 *
 * Uses the `cmdk` library for command filtering and keyboard navigation.
 * Commands are grouped by category: Session, Model, View, Action.
 */

import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { Search, Plus, Cpu, PanelLeft, Settings, Square, Columns2, X, Rows2, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, FileText, Zap } from 'lucide-react'
import { Kbd, KbdGroup } from './ui/kbd'
import { getPaneStore } from '../store/pane-store'
import { getBridge } from '../lib/bridge'

// ============================================================================
// Types
// ============================================================================

interface Session {
  path: string
  name: string
}

interface Model {
  provider: string
  id: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** The active pane ID — used for fetching sessions and models. */
  activePaneId: string
  onNewSession: () => void
  onSwitchSession: (path: string) => void
  onToggleSidebar: () => void
  onSwitchModel: (provider: string, modelId: string) => void
  onStopGeneration: () => void
  onSettings: () => void
  onSplitPane: () => void
  onSplitPaneVertical: () => void
  onNavigatePane: (direction: 'up' | 'down' | 'left' | 'right') => void
  onClosePane?: () => void
  onOpenFile: (paneId: string, relativePath: string) => Promise<void>
  onRunSkill?: (trigger: string) => void
  isGenerating: boolean
  canSplit: boolean
}

// ============================================================================
// CommandPalette
// ============================================================================

export function CommandPalette({
  open,
  onClose,
  activePaneId,
  onNewSession,
  onSwitchSession,
  onToggleSidebar,
  onSwitchModel,
  onStopGeneration,
  onSettings,
  onSplitPane,
  onSplitPaneVertical,
  onNavigatePane,
  onClosePane,
  onOpenFile,
  onRunSkill,
  isGenerating,
  canSplit,
}: CommandPaletteProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [skills, setSkills] = useState<Array<{ trigger: string; name: string; description: string }>>([])
  const [loadedData, setLoadedData] = useState(false)

  const recentFiles = getPaneStore(activePaneId)((s) => s.recentFiles)

  // Load sessions, models, and skills when palette opens
  useEffect(() => {
    if (!open || loadedData) return

    const bridge = getBridge()

    Promise.allSettled([
      bridge.getSessions(activePaneId).then((list) => setSessions(list as Session[])),
      bridge.getModels(activePaneId).then((list) => setModels(list as Model[])),
      bridge.skillList ? bridge.skillList().then((list) => setSkills(list)) : Promise.resolve(),
    ]).then(() => setLoadedData(true))
  }, [open, loadedData, activePaneId])

  // Reset loaded state when closed so data refreshes on next open
  useEffect(() => {
    if (!open) setLoadedData(false)
  }, [open])

  const handleNewSession = () => {
    onNewSession()
    onClose()
  }

  const handleSwitchSession = (path: string) => {
    onSwitchSession(path)
    onClose()
  }

  const handleToggleSidebar = () => {
    onToggleSidebar()
    onClose()
  }

  const handleSwitchModel = (provider: string, modelId: string) => {
    onSwitchModel(provider, modelId)
    onClose()
  }

  const handleStopGeneration = () => {
    onStopGeneration()
    onClose()
  }

  const handleSettings = () => {
    onSettings()
    onClose()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
      label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      // Overlay backdrop
      style={{}}
    >
      <VisuallyHidden.Root>
        <h2>Command palette</h2>
      </VisuallyHidden.Root>

      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Palette panel */}
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-border bg-bg-secondary shadow-2xl overflow-hidden">
        {/* Search input row */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-text-tertiary flex-shrink-0" />
          <Command.Input
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
            autoFocus
          />
        </div>

        {/* Command list */}
        <Command.List className="max-h-80 overflow-y-auto py-1.5">
          <Command.Empty className="py-8 text-center text-sm text-text-tertiary">
            No commands found.
          </Command.Empty>

          {/* Recent Files group */}
          {recentFiles.length > 0 && (
            <Command.Group
              heading="Recent Files"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary"
            >
              {recentFiles.map((relativePath) => {
                const fileName = relativePath.split('/').pop() ?? relativePath
                return (
                  <CommandItem
                    key={relativePath}
                    icon={<FileText className="h-4 w-4" />}
                    label={fileName}
                    description={relativePath}
                    onSelect={() => {
                      void onOpenFile(activePaneId, relativePath)
                      onClose()
                    }}
                  />
                )
              })}
            </Command.Group>
          )}

          {/* Session group */}
          <Command.Group
            heading="Session"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary"
          >
            {/* New Session */}
            <CommandItem
              icon={<Plus className="h-4 w-4" />}
              label="New Session"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>N</Kbd>
                </KbdGroup>
              }
              onSelect={handleNewSession}
            />

            {/* Switch Session sub-items */}
            {sessions.map((session) => (
              <CommandItem
                key={session.path}
                icon={<PanelLeft className="h-4 w-4" />}
                label={`Switch to: ${session.name}`}
                onSelect={() => handleSwitchSession(session.path)}
              />
            ))}
          </Command.Group>

          {/* Model group */}
          <Command.Group
            heading="Model"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary"
          >
            {models.map((model) => (
              <CommandItem
                key={`${model.provider}/${model.id}`}
                icon={<Cpu className="h-4 w-4" />}
                label={`${model.provider} / ${model.id}`}
                onSelect={() => handleSwitchModel(model.provider, model.id)}
              />
            ))}
            {models.length === 0 && (
              <CommandItem
                icon={<Cpu className="h-4 w-4" />}
                label="Switch Model"
                shortcut={
                  <KbdGroup>
                    <Kbd>⌘</Kbd>
                    <Kbd>M</Kbd>
                  </KbdGroup>
                }
                onSelect={onClose}
              />
            )}
          </Command.Group>

          {/* Pane group */}
          <Command.Group
            heading="Panes"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary"
          >
            <CommandItem
              icon={<Columns2 className="h-4 w-4" />}
              label="Split Pane Horizontally"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>D</Kbd>
                </KbdGroup>
              }
              disabled={!canSplit}
              onSelect={() => { onSplitPane(); onClose() }}
            />
            <CommandItem
              icon={<Rows2 className="h-4 w-4" />}
              label="Split Pane Vertically"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⇧</Kbd>
                  <Kbd>D</Kbd>
                </KbdGroup>
              }
              disabled={!canSplit}
              onSelect={() => { onSplitPaneVertical(); onClose() }}
            />
            {onClosePane && (
              <CommandItem
                icon={<X className="h-4 w-4" />}
                label="Close Pane"
                shortcut={
                  <KbdGroup>
                    <Kbd>⌘</Kbd>
                    <Kbd>W</Kbd>
                  </KbdGroup>
                }
                onSelect={() => { onClosePane(); onClose() }}
              />
            )}
            <CommandItem
              icon={<ArrowLeft className="h-4 w-4" />}
              label="Focus Pane Left"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⌥</Kbd>
                  <Kbd>←</Kbd>
                </KbdGroup>
              }
              onSelect={() => { onNavigatePane('left'); onClose() }}
            />
            <CommandItem
              icon={<ArrowRight className="h-4 w-4" />}
              label="Focus Pane Right"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⌥</Kbd>
                  <Kbd>→</Kbd>
                </KbdGroup>
              }
              onSelect={() => { onNavigatePane('right'); onClose() }}
            />
            <CommandItem
              icon={<ArrowUp className="h-4 w-4" />}
              label="Focus Pane Up"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⌥</Kbd>
                  <Kbd>↑</Kbd>
                </KbdGroup>
              }
              onSelect={() => { onNavigatePane('up'); onClose() }}
            />
            <CommandItem
              icon={<ArrowDown className="h-4 w-4" />}
              label="Focus Pane Down"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⌥</Kbd>
                  <Kbd>↓</Kbd>
                </KbdGroup>
              }
              onSelect={() => { onNavigatePane('down'); onClose() }}
            />
          </Command.Group>

          {/* View group */}
          <Command.Group
            heading="View"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary"
          >
            <CommandItem
              icon={<PanelLeft className="h-4 w-4" />}
              label="Toggle Sidebar"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>B</Kbd>
                </KbdGroup>
              }
              onSelect={handleToggleSidebar}
            />
            <CommandItem
              icon={<Settings className="h-4 w-4" />}
              label="Settings"
              shortcut={
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>,</Kbd>
                </KbdGroup>
              }
              onSelect={handleSettings}
            />
          </Command.Group>

          {/* Skills group */}
          {skills.length > 0 && (
            <Command.Group
              heading="Skills"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary"
            >
              {skills.map((skill) => (
                <CommandItem
                  key={skill.trigger}
                  icon={<Zap className="h-4 w-4" />}
                  label={`/${skill.trigger}`}
                  description={skill.description}
                  onSelect={() => {
                    if (onRunSkill) {
                      onRunSkill(skill.trigger)
                    }
                    onClose()
                  }}
                />
              ))}
            </Command.Group>
          )}

          {/* Action group */}
          <Command.Group
            heading="Action"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary"
          >
            <CommandItem
              icon={<Square className="h-4 w-4" />}
              label="Stop Generation"
              shortcut={<Kbd>Esc</Kbd>}
              disabled={!isGenerating}
              onSelect={handleStopGeneration}
            />
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  )
}

// ============================================================================
// CommandItem — individual row in the palette
// ============================================================================

interface CommandItemProps {
  icon: React.ReactNode
  label: string
  description?: string
  shortcut?: React.ReactNode
  disabled?: boolean
  onSelect: () => void
}

function CommandItem({ icon, label, description, shortcut, disabled = false, onSelect }: CommandItemProps) {
  return (
    <Command.Item
      value={`${label} ${description ?? ''}`}
      disabled={disabled}
      onSelect={onSelect}
      className={[
        'flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg text-sm cursor-pointer select-none',
        'text-text-secondary',
        'data-[selected=true]:bg-accent/15 data-[selected=true]:text-text-primary',
        'aria-disabled:opacity-40 aria-disabled:cursor-not-allowed',
        'transition-colors',
      ].join(' ')}
    >
      <span className="text-text-tertiary flex-shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="truncate block">{label}</span>
        {description && (
          <span className="text-text-tertiary text-xs truncate block">{description}</span>
        )}
      </span>
      {shortcut && (
        <span className="flex-shrink-0 ml-auto">{shortcut}</span>
      )}
    </Command.Item>
  )
}
