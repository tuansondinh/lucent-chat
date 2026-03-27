/**
 * SubagentBlock — collapsible inline block for subagent execution.
 *
 * Collapsed: single summary line with agent type badge, status, and duration.
 * Expanded: full nested tool call trace from the child agent.
 *
 * Left border accent indicates running/done/error state.
 */

import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, Loader2, Check, X, Bot } from 'lucide-react'
import { cn } from '../lib/utils'
import type { SubagentBlock as SubagentBlockType } from '../store/chat'

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(startedAt: number, endedAt?: number): string {
  const ms = (endedAt ?? Date.now()) - startedAt
  if (ms < 1000) return `${ms}ms`
  const s = (ms / 1000).toFixed(1)
  return `${s}s`
}

function agentTypeLabel(agentType: string): string {
  switch (agentType) {
    case 'worker': return 'Worker'
    case 'scout': return 'Scout'
    case 'researcher': return 'Researcher'
    default: return agentType.charAt(0).toUpperCase() + agentType.slice(1)
  }
}

// ============================================================================
// SubagentBlock
// ============================================================================

interface Props {
  block: SubagentBlockType
}

export function SubagentBlock({ block }: Props) {
  const [expanded, setExpanded] = useState(block.status === 'running')

  // Collapse when done/error
  useEffect(() => {
    if (block.status !== 'running') {
      setExpanded(false)
    }
  }, [block.status])

  const borderColor =
    block.status === 'running'
      ? 'border-l-accent'
      : block.status === 'done'
        ? 'border-l-green-500'
        : 'border-l-red-500'

  const statusIcon =
    block.status === 'running' ? (
      <Loader2 className="size-3 animate-spin text-accent flex-shrink-0" />
    ) : block.status === 'done' ? (
      <Check className="size-3 text-green-400 flex-shrink-0" />
    ) : (
      <X className="size-3 text-red-400 flex-shrink-0" />
    )

  const statusLabel =
    block.status === 'running' ? 'running' : block.status === 'done' ? 'done' : 'error'

  const duration = formatDuration(block.startedAt, block.endedAt)
  const typeLabel = agentTypeLabel(block.agentType)

  return (
    <div
      className={cn(
        'my-2 rounded-md overflow-hidden border border-border/50 border-l-2',
        borderColor,
      )}
      data-testid="subagent-block"
      data-status={block.status}
    >
      {/* Header — always visible, click to expand/collapse */}
      <button
        className={cn(
          'flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left transition-colors',
          'bg-bg-tertiary/70 hover:bg-bg-tertiary',
          'text-text-secondary',
        )}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Expand/collapse chevron */}
        <span className="text-text-tertiary flex-shrink-0">
          {expanded
            ? <ChevronDown className="size-3" />
            : <ChevronRight className="size-3" />
          }
        </span>

        {/* Status icon */}
        {statusIcon}

        {/* Agent type badge */}
        <span
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold flex-shrink-0',
            'bg-accent/10 text-accent/80 border border-accent/20',
          )}
        >
          <Bot className="size-2.5" />
          {typeLabel}
        </span>

        {/* Prompt preview */}
        <span className="truncate flex-1 text-text-tertiary font-mono">
          {block.prompt.length > 60 ? block.prompt.slice(0, 60) + '…' : block.prompt}
        </span>

        {/* Status + duration */}
        <span className="flex-shrink-0 text-text-tertiary text-[10px]">
          {statusLabel} · {duration}
        </span>
      </button>

      {/* Expanded content — full trace */}
      {expanded && (
        <div className="border-t border-border/30 bg-bg-primary/60 p-2 space-y-1">
          {block.children.length === 0 ? (
            <p className="text-[11px] text-text-tertiary italic px-1">
              {block.status === 'running' ? 'Agent working...' : 'No output recorded.'}
            </p>
          ) : (
            (block.children as unknown[]).map((child, idx) => (
              <div key={idx} className="text-[11px] font-mono text-text-secondary px-1">
                {JSON.stringify(child)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// UnknownBlock — forward-compat fallback for unknown block types
// ============================================================================

interface UnknownBlockProps {
  block: { type: string; id: string; [key: string]: unknown }
}

export function UnknownBlockFallback({ block }: UnknownBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-2 rounded-md border border-border/30 overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left bg-bg-tertiary/40 hover:bg-bg-tertiary/60 text-text-tertiary transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span>{expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}</span>
        <span className="font-mono">[{block.type}]</span>
        <span className="text-text-tertiary/60 text-[10px]">unknown block type</span>
      </button>
      {expanded && (
        <div className="border-t border-border/20 p-2 bg-bg-primary/40">
          <pre className="text-[10px] text-text-tertiary font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(block, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
