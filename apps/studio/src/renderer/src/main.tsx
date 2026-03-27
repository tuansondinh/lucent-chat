import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { BridgeSetup } from './components/BridgeSetup'
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
  // Localhost connections are trusted without a token
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const hasToken = Boolean(localStorage.getItem('lc_bridge_token'))

  const [connected, setConnected] = useState(isElectron || isLocalhost || hasToken)

  if (!connected) {
    return <BridgeSetup onConnect={() => setConnected(true)} />
  }

  return <App />
}

createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
