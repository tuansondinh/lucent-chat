import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getBridge } from './lib/bridge'
import './styles/index.css'

// ---------------------------------------------------------------------------
// Service worker registration — PWA mode only (not Electron)
// ---------------------------------------------------------------------------

function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          console.warn('[SW] Registration failed:', err)
        })
    })
  }
}

// Only register the service worker when NOT running inside Electron.
// window.__ELECTRON__ is set by the Electron preload script.
if (!(window as Window & { __ELECTRON__?: unknown }).__ELECTRON__) {
  registerServiceWorker()
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root was not found')
}

function Root() {
  // In Electron, window.__ELECTRON__ is set by the preload — skip setup.
  const isElectron = Boolean((window as Window & { __ELECTRON__?: unknown }).__ELECTRON__)
  // For non-Electron (PWA/browser), use the page's own origin as the server URL.
  // tailscale serve proxies to localhost so no token is needed.
  if (!isElectron) {
    // Only set the bridge server from origin if nothing is stored yet.
    // Avoid overwriting a good stored URL (e.g. localhost:8788) just because
    // the page happens to be served from a different port (e.g. Vite preview :4173).
    if (!localStorage.getItem('lc_bridge_server')) {
      localStorage.setItem('lc_bridge_server', window.location.origin)
    }
    localStorage.removeItem('lc_bridge_token')
  }

  useEffect(() => {
    const bridge = getBridge()
    if (!bridge.onClassifierDebug) return
    return bridge.onClassifierDebug((data) => {
      console.debug('[classifier]', data)
    })
  }, [])

  return <App />
}

createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
