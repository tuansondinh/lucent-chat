/**
 * SkillProgressBlock — shows skill execution progress inline in chat.
 *
 * Collapsed: shows skill name, step N/M, status badge.
 * Expanded: shows each step with status icon + output preview.
 */

import { useState } from 'react'
import { ChevronRight, ChevronDown, CheckCircle, XCircle, Loader2, Circle, Zap } from 'lucide-react'
import type { SkillBlock, SkillStepState } from '../store/chat'
import { cn } from '../lib/utils'

// ============================================================================
// Types
// ============================================================================

interface Props {
  block: SkillBlock
}

// ============================================================================
// SkillProgressBlock
// ============================================================================

export function SkillProgressBlock({ block }: Props) {
  const [expanded, setExpanded] = useState(block.status === 'running')

  const completedSteps = block.steps.filter((s) => s.status === 'done').length
  const currentStep = block.steps.findIndex((s) => s.status === 'running')
  const displayStep = currentStep !== -1 ? currentStep + 1 : completedSteps

  const statusColor = (() => {
    switch (block.status) {
      case 'running': return 'text-accent border-accent/40 bg-accent/5'
      case 'done': return 'text-green-400 border-green-400/40 bg-green-400/5'
      case 'error': return 'text-red-400 border-red-400/40 bg-red-400/5'
      case 'aborted': return 'text-text-tertiary border-border bg-bg-tertiary'
    }
  })()

  return (
    <div className={cn('my-2 rounded-lg border', statusColor)}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:opacity-80 transition-opacity"
      >
        <Zap className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="flex-1 min-w-0 text-sm font-medium truncate">{block.skillName}</span>
        <span className="text-xs text-text-tertiary flex-shrink-0">
          {block.status === 'running'
            ? `Step ${displayStep}/${block.totalSteps}`
            : block.status === 'done'
              ? `${block.totalSteps}/${block.totalSteps} steps`
              : block.status === 'error'
                ? 'Failed'
                : 'Aborted'}
        </span>
        <StatusBadge status={block.status} />
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" />
        )}
      </button>

      {/* Step details */}
      {expanded && (
        <div className="border-t border-inherit px-3 py-2 space-y-1.5">
          {block.steps.map((step) => (
            <StepRow key={step.index} step={step} totalSteps={block.totalSteps} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// StepRow — individual step with icon + optional output preview
// ============================================================================

function StepRow({ step, totalSteps }: { step: SkillStepState; totalSteps: number }) {
  const [showOutput, setShowOutput] = useState(false)

  const icon = (() => {
    switch (step.status) {
      case 'running': return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent flex-shrink-0" />
      case 'done': return <CheckCircle className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
      case 'error': return <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
      case 'aborted': return <XCircle className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" />
      default: return <Circle className="h-3.5 w-3.5 text-text-tertiary flex-shrink-0" />
    }
  })()

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs text-text-secondary">
          Step {step.index + 1}/{totalSteps}
        </span>
        {step.status === 'error' && step.error && (
          <span className="text-xs text-red-400 truncate max-w-xs">{step.error}</span>
        )}
        {step.output && (
          <button
            onClick={() => setShowOutput((v) => !v)}
            className="ml-auto text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {showOutput ? 'hide' : 'show output'}
          </button>
        )}
      </div>
      {showOutput && step.output && (
        <div className="ml-5 rounded bg-bg-tertiary px-2 py-1 text-[11px] text-text-secondary font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
          {step.output.slice(0, 500)}{step.output.length > 500 ? '…' : ''}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// StatusBadge
// ============================================================================

function StatusBadge({ status }: { status: SkillBlock['status'] }) {
  const label = (() => {
    switch (status) {
      case 'running': return 'Running'
      case 'done': return 'Done'
      case 'error': return 'Failed'
      case 'aborted': return 'Aborted'
    }
  })()

  const cls = (() => {
    switch (status) {
      case 'running': return 'bg-accent/20 text-accent'
      case 'done': return 'bg-green-400/20 text-green-400'
      case 'error': return 'bg-red-400/20 text-red-400'
      case 'aborted': return 'bg-bg-tertiary text-text-tertiary'
    }
  })()

  return (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0', cls)}>
      {label}
    </span>
  )
}
