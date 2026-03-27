/**
 * Unit tests for capabilities.ts — Phase 1 PWA Infrastructure
 *
 * Tests the getCapabilities() function for both Electron and PWA contexts.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'

describe('getCapabilities()', () => {
  afterEach(() => {
    // Restore window.__ELECTRON__
    Object.defineProperty(window, '__ELECTRON__', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    vi.resetModules()
  })

  it('returns all capabilities as true in Electron context', async () => {
    Object.defineProperty(window, '__ELECTRON__', {
      value: { ipc: {} },
      writable: true,
      configurable: true,
    })

    vi.resetModules()
    const { getCapabilities } = await import('./capabilities')
    const caps = getCapabilities()

    expect(caps.terminal).toBe(true)
    expect(caps.fileSystem).toBe(true)
    expect(caps.oauth).toBe(true)
    expect(caps.multiPane).toBe(true)
    expect(caps.splitPane).toBe(true)
  })

  it('returns limited capabilities in PWA context', async () => {
    Object.defineProperty(window, '__ELECTRON__', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    vi.resetModules()
    const { getCapabilities } = await import('./capabilities')
    const caps = getCapabilities()

    expect(caps.terminal).toBe(false)
    expect(caps.fileSystem).toBe(false)
    expect(caps.oauth).toBe(false)
    expect(caps.multiPane).toBe(false)
    expect(caps.splitPane).toBe(false)
  })

  it('returns object with all required keys', async () => {
    vi.resetModules()
    const { getCapabilities } = await import('./capabilities')
    const caps = getCapabilities()

    expect(caps).toHaveProperty('terminal')
    expect(caps).toHaveProperty('fileSystem')
    expect(caps).toHaveProperty('oauth')
    expect(caps).toHaveProperty('multiPane')
    expect(caps).toHaveProperty('splitPane')
  })

  it('returns booleans for all capability values', async () => {
    vi.resetModules()
    const { getCapabilities } = await import('./capabilities')
    const caps = getCapabilities()

    for (const val of Object.values(caps)) {
      expect(typeof val).toBe('boolean')
    }
  })
})

describe('iOS standalone detection', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('exports isStandaloneMode function', async () => {
    const mod = await import('./capabilities')
    expect(typeof mod.isStandaloneMode).toBe('function')
  })

  it('isStandaloneMode returns false when navigator.standalone is undefined', async () => {
    vi.resetModules()
    const { isStandaloneMode } = await import('./capabilities')
    // happy-dom does not set navigator.standalone, defaults to false
    expect(isStandaloneMode()).toBe(false)
  })
})
