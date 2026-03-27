/**
 * getBridge() — unified bridge adapter.
 *
 * Returns window.bridge when running in Electron (window.__ELECTRON__ === true),
 * or a WebBridge instance when running as a PWA.
 *
 * PWA configuration is read from query params or localStorage:
 *   ?server=http://...&token=...
 *   or localStorage keys: lc_bridge_server, lc_bridge_token
 */

import type { Bridge } from '../../../preload/index'
import { WebBridge } from './web-bridge'

declare global {
  interface Window {
    __ELECTRON__?: boolean
    bridge: Bridge
  }
}

let _bridge: Bridge | null = null

/**
 * Resolve the WebBridge server URL and token from URL params or localStorage.
 */
function resolveWebBridgeConfig(): { server: string; token: string } {
  // Check URL params first (deep-link / QR code flow)
  const params = new URLSearchParams(window.location.search)
  const serverParam = params.get('server')
  const tokenParam = params.get('token')

  if (serverParam && tokenParam) {
    // Persist for future reloads
    localStorage.setItem('lc_bridge_server', serverParam)
    localStorage.setItem('lc_bridge_token', tokenParam)
    return { server: serverParam, token: tokenParam }
  }

  // Fallback to persisted values
  const server = localStorage.getItem('lc_bridge_server') ?? 'http://localhost:8788'
  const token = localStorage.getItem('lc_bridge_token') ?? ''
  return { server, token }
}

/**
 * Returns the active Bridge implementation.
 *
 * In Electron: returns window.bridge (IPC-backed).
 * In PWA/browser: returns a WebBridge instance (fetch + WebSocket).
 *
 * The result is memoized — call sites may call getBridge() on every render
 * without creating new instances.
 */
export function getBridge(): Bridge {
  if (_bridge) return _bridge

  if (window.__ELECTRON__) {
    _bridge = window.bridge
    return _bridge
  }

  // PWA mode
  const { server, token } = resolveWebBridgeConfig()
  _bridge = new WebBridge(server, token)
  return _bridge
}

/**
 * Reset the memoized bridge instance (useful for testing or token rotation).
 */
export function resetBridge(): void {
  _bridge = null
}
