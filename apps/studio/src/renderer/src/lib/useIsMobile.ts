/**
 * useIsMobile — reactive hook for mobile viewport detection.
 *
 * Uses matchMedia('(max-width: 768px)') with a resize listener so the component
 * re-renders automatically when the viewport crosses the mobile breakpoint.
 *
 * Also exports useIsLandscape() for landscape-specific layout adjustments.
 */

import { useState, useEffect } from 'react'

const MOBILE_BREAKPOINT = '(max-width: 768px)'
const LANDSCAPE_QUERY = '(orientation: landscape)'

/**
 * Returns true when the viewport is 768px wide or narrower.
 * Re-renders callers when the breakpoint is crossed.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(MOBILE_BREAKPOINT).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    // Sync initial value in case it changed between render and effect
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isMobile
}

/**
 * Returns true when the device is in landscape orientation.
 * Re-renders callers when orientation changes.
 */
export function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(LANDSCAPE_QUERY).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches)
    mql.addEventListener('change', handler)
    setIsLandscape(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isLandscape
}
