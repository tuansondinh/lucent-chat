/**
 * useSwipeGesture — detects horizontal swipe from left edge to open/close sidebar drawer.
 *
 * Swipe-right from within 20px of the left screen edge opens the drawer.
 * Swipe-left on the drawer area closes it.
 * Uses pointer events for cross-device compatibility (touch + mouse).
 *
 * Thresholds:
 *   - Edge zone: 20px from left
 *   - Delta: >= 50px horizontal movement
 *   - Velocity fallback: >= 20px AND velocity > 0.3 px/ms qualifies even if < 50px
 */

import { useEffect, useRef } from 'react'

interface SwipeOptions {
  /** Called when a right-swipe from the left edge is detected. */
  onSwipeRight: () => void
  /** Called when a left-swipe is detected (to close). */
  onSwipeLeft: () => void
  /** Whether the drawer is currently open (affects which gesture to detect). */
  isOpen: boolean
  /** Set false to disable all gesture detection. */
  enabled?: boolean
}

const EDGE_ZONE_PX = 20
const DELTA_THRESHOLD_PX = 50
const VELOCITY_THRESHOLD = 0.3 // px/ms
const VELOCITY_MIN_DELTA = 20  // px — minimum delta before velocity matters

export function useSwipeGesture({
  onSwipeRight,
  onSwipeLeft,
  isOpen,
  enabled = true,
}: SwipeOptions): void {
  // Store gesture state in a ref so event handlers don't go stale
  const gesture = useRef<{
    active: boolean
    startX: number
    startY: number
    startTime: number
    isEdgeSwipe: boolean
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    isEdgeSwipe: false,
  })

  useEffect(() => {
    if (!enabled) return

    const handlePointerDown = (e: PointerEvent) => {
      // Only track primary pointer (ignore multi-touch)
      if (!e.isPrimary) return

      const isEdge = e.clientX <= EDGE_ZONE_PX
      // Track gesture if: (a) from edge (for open), or (b) drawer is open (for close)
      if (!isEdge && !isOpen) return

      gesture.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        startTime: performance.now(),
        isEdgeSwipe: isEdge,
      }
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!e.isPrimary || !gesture.current.active) return

      const deltaX = e.clientX - gesture.current.startX
      const deltaY = Math.abs(e.clientY - gesture.current.startY)

      // If vertical movement dominates early, cancel — this is a scroll
      if (deltaY > 30 && Math.abs(deltaX) < deltaY) {
        gesture.current.active = false
      }
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!e.isPrimary || !gesture.current.active) return

      gesture.current.active = false

      const deltaX = e.clientX - gesture.current.startX
      const deltaY = Math.abs(e.clientY - gesture.current.startY)
      const duration = performance.now() - gesture.current.startTime
      const velocity = Math.abs(deltaX) / Math.max(duration, 1)

      // Reject if vertical movement dominated
      if (deltaY > Math.abs(deltaX)) return

      const fastEnough = Math.abs(deltaX) >= VELOCITY_MIN_DELTA && velocity > VELOCITY_THRESHOLD
      const farEnough = Math.abs(deltaX) >= DELTA_THRESHOLD_PX

      if (deltaX > 0 && (farEnough || fastEnough) && gesture.current.isEdgeSwipe && !isOpen) {
        onSwipeRight()
      } else if (deltaX < 0 && (farEnough || fastEnough) && isOpen) {
        onSwipeLeft()
      }
    }

    const handlePointerCancel = () => {
      gesture.current.active = false
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [enabled, isOpen, onSwipeRight, onSwipeLeft])
}
