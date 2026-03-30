/**
 * Tests for bridge.ts token URL cleanup.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

describe('bridge: token URL cleanup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    localStorage.clear()
  })

  it('calls history.replaceState to strip token when URL params are present', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

    // Simulate deep-link URL with auth params
    Object.defineProperty(window, 'location', {
      value: {
        search: '?server=http%3A%2F%2F192.168.1.1%3A8788&token=supersecrettoken',
        hostname: 'my-pwa-host.example.com',
        pathname: '/',
        href: 'https://my-pwa-host.example.com/?server=http%3A%2F%2F192.168.1.1%3A8788&token=supersecrettoken',
        origin: 'https://my-pwa-host.example.com',
      },
      writable: true,
      configurable: true,
    })

    vi.resetModules()
    // Mock WebBridge so we don't open actual WebSocket
    vi.doMock('./web-bridge', () => ({
      WebBridge: class {
        constructor() {}
        onConnectionStatusChange() { return () => {} }
      },
    }))

    vi.resetModules()
    const { getBridge, resetBridge } = await import('./bridge')
    resetBridge()
    getBridge()

    // replaceState must have been called and the new URL must not contain token or server
    expect(replaceStateSpy).toHaveBeenCalled()
    const calls = replaceStateSpy.mock.calls
    const lastCall = calls[calls.length - 1]
    const newUrl = String(lastCall?.[2] ?? '')
    expect(newUrl).not.toContain('token=')
    expect(newUrl).not.toContain('server=')
  })

  it('does NOT call replaceState when URL has no token param', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    replaceStateSpy.mockClear()

    Object.defineProperty(window, 'location', {
      value: {
        search: '',
        hostname: 'my-pwa-host.example.com',
        pathname: '/',
        href: 'https://my-pwa-host.example.com/',
        origin: 'https://my-pwa-host.example.com',
      },
      writable: true,
      configurable: true,
    })

    vi.resetModules()
    vi.doMock('./web-bridge', () => ({
      WebBridge: class {
        constructor() {}
        onConnectionStatusChange() { return () => {} }
      },
    }))

    vi.resetModules()
    const { getBridge, resetBridge } = await import('./bridge')
    resetBridge()
    replaceStateSpy.mockClear()
    getBridge()

    // Should NOT have been called since no URL params to strip
    expect(replaceStateSpy).not.toHaveBeenCalled()
  })

  it('saves token and server to localStorage from URL params', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        search: '?server=http%3A%2F%2F192.168.1.5%3A8788&token=persistedtoken',
        hostname: 'my-pwa-host.example.com',
        pathname: '/',
        href: 'https://my-pwa-host.example.com/?server=http%3A%2F%2F192.168.1.5%3A8788&token=persistedtoken',
        origin: 'https://my-pwa-host.example.com',
      },
      writable: true,
      configurable: true,
    })

    vi.resetModules()
    vi.doMock('./web-bridge', () => ({
      WebBridge: class {
        constructor() {}
        onConnectionStatusChange() { return () => {} }
      },
    }))

    vi.resetModules()
    const { getBridge, resetBridge } = await import('./bridge')
    resetBridge()
    getBridge()

    expect(localStorage.getItem('lc_bridge_token')).toBe('persistedtoken')
    expect(localStorage.getItem('lc_bridge_server')).toBe('http://192.168.1.5:8788')
  })
})
