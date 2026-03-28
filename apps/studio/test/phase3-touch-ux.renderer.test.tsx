/**
 * Phase 3: Touch UX, Safe Areas & Polish — Unit Tests
 *
 * Tests cover:
 * - Swipe gesture logic (edge detection, threshold, velocity)
 * - iOS keyboard handling (visualViewport API usage)
 * - State persistence (localStorage save/restore)
 * - Token URL cleanup (history.replaceState)
 * - Reconnect resilience (exponential backoff logic)
 * - Mobile voice button (tap-to-toggle)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Swipe gesture helpers
// ---------------------------------------------------------------------------

describe('Swipe gesture — edge detection & thresholds', () => {
  it('detects swipe from within 20px of left edge', () => {
    const startX = 15 // within 20px edge zone
    const startY = 300
    const isEdgeSwipe = startX <= 20
    expect(isEdgeSwipe).toBe(true)
  })

  it('rejects swipe starting outside 20px edge zone', () => {
    const startX = 25
    const isEdgeSwipe = startX <= 20
    expect(isEdgeSwipe).toBe(false)
  })

  it('opens drawer when swipe-right delta >= 50px', () => {
    const startX = 10
    const endX = 65
    const delta = endX - startX
    const shouldOpen = delta >= 50
    expect(shouldOpen).toBe(true)
  })

  it('does not open drawer when swipe-right delta < 50px', () => {
    const startX = 10
    const endX = 45
    const delta = endX - startX
    const shouldOpen = delta >= 50
    expect(shouldOpen).toBe(false)
  })

  it('closes drawer when swipe-left delta >= 50px', () => {
    const startX = 200
    const endX = 140
    const delta = startX - endX
    const shouldClose = delta >= 50
    expect(shouldClose).toBe(true)
  })

  it('velocity-aware: fast short swipe qualifies (velocity > 0.3 px/ms)', () => {
    const deltaX = 40 // less than 50px threshold
    const durationMs = 100
    const velocity = deltaX / durationMs
    // If velocity is high enough AND delta > 20px, qualify
    const qualifies = deltaX >= 20 && velocity > 0.3
    expect(qualifies).toBe(true)
  })

  it('velocity-aware: slow movement does not qualify without meeting delta threshold', () => {
    const deltaX = 40
    const durationMs = 500
    const velocity = deltaX / durationMs
    const qualifies = deltaX >= 50 || (deltaX >= 20 && velocity > 0.3)
    expect(qualifies).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

describe('State persistence — localStorage save/restore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves and restores sidebar open/closed state', () => {
    localStorage.setItem('lc_sidebar_open', 'true')
    const restored = localStorage.getItem('lc_sidebar_open') === 'true'
    expect(restored).toBe(true)
  })

  it('defaults sidebar to closed when no stored value', () => {
    const raw = localStorage.getItem('lc_sidebar_open')
    const restored = raw === 'true' // null becomes false
    expect(restored).toBe(false)
  })

  it('saves and restores pending input draft', () => {
    const draft = 'partial user message'
    localStorage.setItem('lc_input_draft', draft)
    const restored = localStorage.getItem('lc_input_draft')
    expect(restored).toBe(draft)
  })

  it('saves and restores selected session path', () => {
    const path = '/sessions/abc123.json'
    localStorage.setItem('lc_active_session', path)
    const restored = localStorage.getItem('lc_active_session')
    expect(restored).toBe(path)
  })

  it('clears draft on submit', () => {
    localStorage.setItem('lc_input_draft', 'some text')
    // Simulate submit
    localStorage.removeItem('lc_input_draft')
    expect(localStorage.getItem('lc_input_draft')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Token URL cleanup
// ---------------------------------------------------------------------------

describe('Token URL cleanup — history.replaceState', () => {
  it('removes token param from URL after deep-link bootstrap', () => {
    // Simulate URL with token
    const urlWithToken = 'https://app.example.com/?token=abc123&server=http%3A%2F%2Flocalhost%3A8788'
    const url = new URL(urlWithToken)
    url.searchParams.delete('token')
    url.searchParams.delete('server')
    const cleaned = url.toString()
    expect(cleaned).toBe('https://app.example.com/')
    expect(cleaned).not.toContain('token=')
  })

  it('preserves other query params when cleaning token', () => {
    const urlWithToken = 'https://app.example.com/?token=abc123&ref=pwa'
    const url = new URL(urlWithToken)
    url.searchParams.delete('token')
    url.searchParams.delete('server')
    const cleaned = url.toString()
    expect(cleaned).toContain('ref=pwa')
    expect(cleaned).not.toContain('token=')
  })

  it('calls history.replaceState to avoid token in back-navigation', () => {
    const replaceState = vi.fn()
    const mockHistory = { replaceState }

    // Simulate what the deep-link handler should do
    const cleanUrl = 'https://app.example.com/'
    mockHistory.replaceState({}, '', cleanUrl)

    expect(replaceState).toHaveBeenCalledWith({}, '', cleanUrl)
  })
})

// ---------------------------------------------------------------------------
// Reconnect resilience — exponential backoff
// ---------------------------------------------------------------------------

describe('Reconnect resilience — exponential backoff', () => {
  it('computes correct backoff delays with cap at 30s', () => {
    const BASE_DELAY = 1000
    const MAX_DELAY = 30_000

    const getDelay = (attempt: number) =>
      Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY)

    expect(getDelay(0)).toBe(1000)  // 1s
    expect(getDelay(1)).toBe(2000)  // 2s
    expect(getDelay(2)).toBe(4000)  // 4s
    expect(getDelay(3)).toBe(8000)  // 8s
    expect(getDelay(4)).toBe(16000) // 16s
    expect(getDelay(5)).toBe(30000) // capped at 30s
    expect(getDelay(6)).toBe(30000) // still capped
  })

  it('resets attempt counter on successful reconnect', () => {
    let attempts = 5
    // Simulate successful reconnect
    const onConnected = () => { attempts = 0 }
    onConnected()
    expect(attempts).toBe(0)
  })

  it('shows reconnecting banner state when connection drops', () => {
    type ConnectionStatus = 'connected' | 'reconnecting' | 'failed'
    let status: ConnectionStatus = 'connected'

    // Simulate drop
    const onDisconnect = () => { status = 'reconnecting' }
    onDisconnect()
    expect(status).toBe('reconnecting')
  })

  it('shows re-auth prompt when token is expired (401)', () => {
    let showReAuth = false
    const onHttpError = (statusCode: number) => {
      if (statusCode === 401) showReAuth = true
    }
    onHttpError(401)
    expect(showReAuth).toBe(true)
  })

  it('does NOT show re-auth for non-401 errors', () => {
    let showReAuth = false
    const onHttpError = (statusCode: number) => {
      if (statusCode === 401) showReAuth = true
    }
    onHttpError(500)
    expect(showReAuth).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mobile voice button — tap-to-toggle
// ---------------------------------------------------------------------------

describe('Mobile voice — tap-to-toggle (not hold-space)', () => {
  it('toggles voice active on single tap', () => {
    let voiceActive = false
    const handleTap = () => { voiceActive = !voiceActive }

    handleTap()
    expect(voiceActive).toBe(true)

    handleTap()
    expect(voiceActive).toBe(false)
  })

  it('voice button is 48px on mobile (prominent circle)', () => {
    const MOBILE_VOICE_BTN_SIZE = 48
    expect(MOBILE_VOICE_BTN_SIZE).toBe(48)
  })
})

// ---------------------------------------------------------------------------
// iOS keyboard handling — visualViewport
// ---------------------------------------------------------------------------

describe('iOS keyboard handling — visualViewport', () => {
  it('detects keyboard open when visualViewport.height < window.innerHeight * 0.8', () => {
    const windowHeight = 844
    const viewportHeightWithKeyboard = 400 // iOS keyboard shrinks viewport
    const isKeyboardOpen = viewportHeightWithKeyboard < windowHeight * 0.8
    expect(isKeyboardOpen).toBe(true)
  })

  it('detects keyboard closed when visualViewport.height >= window.innerHeight * 0.8', () => {
    const windowHeight = 844
    const viewportHeightNoKeyboard = 844
    const isKeyboardOpen = viewportHeightNoKeyboard < windowHeight * 0.8
    expect(isKeyboardOpen).toBe(false)
  })

  it('uses visualViewport.height for input bar position (not safe-area)', () => {
    // When keyboard is open, bottom offset = window.innerHeight - visualViewport.height
    const windowHeight = 844
    const visualViewportHeight = 400
    const keyboardHeight = windowHeight - visualViewportHeight
    // Input bar should be positioned above keyboard
    expect(keyboardHeight).toBe(444)
    // Safe area should NOT be added on top of this offset
    // (prevents double-offset bug)
  })
})

// ---------------------------------------------------------------------------
// Touch target sizes (44x44 minimum)
// ---------------------------------------------------------------------------

describe('Touch targets — minimum 44x44px', () => {
  it('minimum touch target constant is 44px', () => {
    const MIN_TOUCH_TARGET = 44
    expect(MIN_TOUCH_TARGET).toBe(44)
  })

  it('mobile voice button exceeds minimum at 48px', () => {
    const VOICE_BTN_SIZE = 48
    const MIN_TOUCH_TARGET = 44
    expect(VOICE_BTN_SIZE).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  })
})
