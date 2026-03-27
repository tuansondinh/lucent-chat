/**
 * StatusBar — fixed bar at the bottom of the app.
 *
 * Shows: current model name | voice indicator | session name | health dot + status
 */

import { Mic, FileText } from 'lucide-react'
import { formatModelDisplay } from '../lib/models'
import { btn } from '../lib/theme'

interface HealthDotProps {
  health: string
}

function HealthDot({ health }: HealthDotProps) {
  const colorClass =
    health === 'ready'
      ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]'
      : health === 'starting'
        ? 'bg-accent shadow-[0_0_4px_rgba(249,115,22,0.5)] animate-pulse'
        : health === 'crashed' || health === 'degraded'
          ? 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]'
          : 'bg-bg-tertiary'
  return <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${colorClass}`} />
}

interface Props {
  model: string
  sessionName: string
  health: string
  fileViewerOpen?: boolean
  onToggleFileViewer?: () => void
  onOpenModelPicker?: () => void
  // Voice indicator props
  voiceActive?: boolean
  voiceSpeaking?: boolean
  voiceTtsPlaying?: boolean
  /** When true, hide secondary info and file viewer toggle (mobile compact mode). */
  isMobile?: boolean
}

export function StatusBar({
  model,
  sessionName,
  health,
  fileViewerOpen,
  onToggleFileViewer,
  onOpenModelPicker,
  voiceActive,
  voiceSpeaking,
  voiceTtsPlaying,
  isMobile = false,
}: Props) {
  const APP_VERSION = '0.9.0'
  const healthLabel = health === 'ready' ? `v${APP_VERSION}` : health === 'unknown' ? 'connecting' : health

  return (
    <div className="flex items-center justify-between px-3 py-0.5 border-t border-border bg-bg-secondary text-[10px] text-text-tertiary flex-shrink-0">
      {/* Left: model — clickable to open model picker */}
      <button
        onClick={onOpenModelPicker}
        title="Switch model (⌘P)"
        className={`${btn.ghost} truncate max-w-[160px] text-left cursor-pointer disabled:cursor-default`}
        disabled={!onOpenModelPicker}
      >
        {formatModelDisplay(model, { includeProvider: true })}
      </button>

      {/* Center: voice indicator (when active) + session name + file viewer toggle */}
      <div className="flex items-center gap-2.5 min-w-0">
        {voiceActive && (
          <div className="flex items-center gap-1 text-accent">
            <Mic className={`w-3 h-3 ${voiceSpeaking ? 'animate-pulse' : ''}`} />
            <span className="text-[10px]">
              {voiceTtsPlaying ? 'Speaking' : voiceSpeaking ? 'Listening...' : 'Voice'}
            </span>
          </div>
        )}
        {!isMobile && (
          <span className="truncate max-w-[180px] text-center">{sessionName || 'New session'}</span>
        )}
        {!isMobile && (
          <button
            onClick={onToggleFileViewer}
            title="Toggle file viewer (⌘⇧F)"
            className={`${btn.ghost} flex items-center gap-1 cursor-pointer disabled:cursor-default mobile-status-bar-file-toggle`}
            disabled={!onToggleFileViewer}
          >
            <FileText className="w-2.5 h-2.5" />
            <span>{fileViewerOpen ? 'Files On' : 'Files'}</span>
          </button>
        )}
      </div>

      {/* Right: health */}
      <div className="flex items-center gap-1.5">
        <HealthDot health={health} />
        {!isMobile && (
          <span className={`capitalize ${health === 'ready' ? 'text-accent-gray' : ''}`}>{healthLabel}</span>
        )}
      </div>
    </div>
  )
}
