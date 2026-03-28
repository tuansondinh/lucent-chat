/**
 * useIOSKeyboard — detects iOS soft keyboard open/close via the visualViewport API.
 *
 * When the virtual keyboard appears on iOS, `window.visualViewport.height` shrinks
 * while `window.innerHeight` stays the same. We use this to:
 *   1. Detect whether the keyboard is open.
 *   2. Compute the keyboard height so the input bar can be pinned above it.
 *   3. Scroll the chat area to the bottom when the keyboard opens.
 *
 * IMPORTANT: When the keyboard is open, we use `visualViewport.height` as the source
 * of truth for input positioning — NOT safe-area-inset-bottom. This prevents the
 * double-offset bug where both safe-area and keyboard offset are applied.
 */

import { useEffect, useState, useCallback } from 'react'

export interface IOSKeyboardState {
  /** True when the soft keyboard is currently visible. */
  isKeyboardOpen: boolean
  /** The keyboard height in pixels (0 when keyboard is closed). */
  keyboardHeight: number
  /** The visible viewport height (shrinks when keyboard is open). */
  visibleHeight: number
}

const KEYBOARD_THRESHOLD_RATIO = 0.8 // keyboard is open when viewport < 80% of innerHeight

export function useIOSKeyboard(): IOSKeyboardState {
  const [state, setState] = useState<IOSKeyboardState>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    visibleHeight: typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 0,
  })

  const handleViewportChange = useCallback(() => {
    const vv = window.visualViewport
    if (!vv) return

    // Use screen.height as the stable reference — unlike window.innerHeight,
    // screen.height never changes when the soft keyboard opens on Android Chrome.
    const screenHeight = window.screen.height
    const viewportHeight = vv.height
    const isKeyboardOpen = viewportHeight < screenHeight * KEYBOARD_THRESHOLD_RATIO
    const keyboardHeight = isKeyboardOpen ? screenHeight - viewportHeight : 0

    setState({
      isKeyboardOpen,
      keyboardHeight,
      visibleHeight: viewportHeight,
    })
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    // Use visualViewport resize event for reliable keyboard detection
    vv.addEventListener('resize', handleViewportChange)
    vv.addEventListener('scroll', handleViewportChange)

    // Initialize with current state
    handleViewportChange()

    return () => {
      vv.removeEventListener('resize', handleViewportChange)
      vv.removeEventListener('scroll', handleViewportChange)
    }
  }, [handleViewportChange])

  return state
}
