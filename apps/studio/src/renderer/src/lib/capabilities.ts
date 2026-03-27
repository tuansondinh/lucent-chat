/**
 * capabilities.ts — Runtime capability audit for Electron vs PWA contexts.
 *
 * In Electron: all capabilities are available (terminal, file system, OAuth, multi-pane).
 * In PWA: capabilities are limited — shell-only, no terminal, no OAuth, no multi-pane splits.
 *
 * Usage:
 *   import { getCapabilities } from './capabilities'
 *   const { terminal, multiPane } = getCapabilities()
 */

export interface Capabilities {
  /** True when a terminal emulator can be opened (Electron only). */
  terminal: boolean
  /** True when full file system read/write is available (Electron only). */
  fileSystem: boolean
  /** True when OAuth provider flows can be launched (Electron only). */
  oauth: boolean
  /** True when the multi-pane split layout is available. */
  multiPane: boolean
  /** True when individual pane splits can be added/removed. */
  splitPane: boolean
}

/**
 * Returns the current runtime capabilities based on execution context.
 *
 * Reads `window.__ELECTRON__` to distinguish Electron from PWA mode.
 * In Electron all capabilities are enabled; in PWA mode only shell features work.
 */
export function getCapabilities(): Capabilities {
  const isElectron = Boolean((window as Window & { __ELECTRON__?: unknown }).__ELECTRON__)

  return {
    terminal: isElectron,
    fileSystem: isElectron,
    oauth: isElectron,
    multiPane: isElectron,
    splitPane: isElectron,
  }
}

// ---------------------------------------------------------------------------
// iOS / Safari install prompt helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the app is running in standalone PWA mode
 * (launched from the home screen, not from a browser tab).
 *
 * On iOS Safari, `navigator.standalone` is set to `true` when launched from home screen.
 * On other platforms, the standard `matchMedia('(display-mode: standalone)')` is used.
 */
export function isStandaloneMode(): boolean {
  // iOS Safari
  if ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone) {
    return true
  }
  // Standard PWA check
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(display-mode: standalone)').matches
  }
  return false
}

/**
 * Returns true when the user is on iOS Safari and NOT in standalone mode,
 * meaning they can benefit from "Add to Home Screen" guidance.
 */
export function shouldShowIOSInstallPrompt(): boolean {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  return isIOS && isSafari && !isStandaloneMode()
}
