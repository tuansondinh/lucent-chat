/**
 * pane-refs — module-level registry for pane DOM elements and focus callbacks.
 * Used for spatial navigation (Cmd+Arrow) and real keyboard focus.
 */

// ============================================================================
// DOM element registry (for spatial navigation)
// ============================================================================

const paneElements = new Map<string, HTMLElement>()

export function registerPaneElement(paneId: string, el: HTMLElement | null): void {
  if (el) paneElements.set(paneId, el)
  else paneElements.delete(paneId)
}

export function getPaneElement(paneId: string): HTMLElement | undefined {
  return paneElements.get(paneId)
}

// ============================================================================
// Focus callback registry (for moving keyboard focus to textarea)
// ============================================================================

const paneFocusFns = new Map<string, () => void>()

export function registerPaneFocus(paneId: string, fn: (() => void) | null): void {
  if (fn) paneFocusFns.set(paneId, fn)
  else paneFocusFns.delete(paneId)
}

export function focusPane(paneId: string): void {
  paneFocusFns.get(paneId)?.()
}

// ============================================================================
// Spatial navigation
// ============================================================================

export type Direction = 'up' | 'down' | 'left' | 'right'

export function findPaneInDirection(activePaneId: string, direction: Direction): string | null {
  const activeEl = paneElements.get(activePaneId)
  if (!activeEl) return null
  const activeRect = activeEl.getBoundingClientRect()

  type Candidate = { id: string; rect: DOMRect }
  const candidates: Candidate[] = []

  for (const [id, el] of paneElements) {
    if (id === activePaneId) continue
    const rect = el.getBoundingClientRect()
    const isCandidate =
      (direction === 'right' && rect.left > activeRect.right - 1) ||
      (direction === 'left'  && rect.right < activeRect.left + 1) ||
      (direction === 'down'  && rect.top > activeRect.bottom - 1) ||
      (direction === 'up'    && rect.bottom < activeRect.top + 1)
    if (isCandidate) candidates.push({ id, rect })
  }

  if (candidates.length === 0) return null

  // First pass: prefer candidates with orthogonal overlap
  const isHorizontal = direction === 'left' || direction === 'right'
  const withOverlap = candidates.filter(({ rect }) => {
    if (isHorizontal) {
      return rect.top < activeRect.bottom && rect.bottom > activeRect.top
    } else {
      return rect.left < activeRect.right && rect.right > activeRect.left
    }
  })

  const pool = withOverlap.length > 0 ? withOverlap : candidates

  // Score by primary axis distance, break ties with secondary axis distance
  let best: Candidate | null = null
  let bestScore = Infinity
  for (const c of pool) {
    const primaryDist = isHorizontal
      ? Math.abs(direction === 'right' ? c.rect.left - activeRect.right : activeRect.left - c.rect.right)
      : Math.abs(direction === 'down'  ? c.rect.top - activeRect.bottom : activeRect.top - c.rect.bottom)
    const secondaryDist = isHorizontal
      ? Math.abs((c.rect.top + c.rect.height / 2) - (activeRect.top + activeRect.height / 2))
      : Math.abs((c.rect.left + c.rect.width / 2) - (activeRect.left + activeRect.width / 2))
    const score = primaryDist + secondaryDist * 0.5
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }

  return best?.id ?? null
}
