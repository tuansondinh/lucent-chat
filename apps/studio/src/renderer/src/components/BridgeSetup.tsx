/**
 * BridgeSetup — shown in browser/PWA mode when no bridge token is configured.
 * Lets the user paste the token shown in the Electron app console.
 */

import { useState } from 'react'

interface Props {
  onConnect: () => void
}

export function BridgeSetup({ onConnect }: Props) {
  const [server, setServer] = useState(
    localStorage.getItem('lc_bridge_server') ?? 'http://localhost:8788'
  )
  const [token, setToken] = useState(localStorage.getItem('lc_bridge_token') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const handleConnect = async () => {
    const trimmedServer = server.trim().replace(/\/$/, '')
    const trimmedToken = token.trim()
    if (!trimmedToken) {
      setError('Token is required')
      return
    }

    setTesting(true)
    setError(null)

    try {
      const res = await fetch(`${trimmedServer}/api/cmd/get-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${trimmedToken}`,
        },
        body: JSON.stringify([]),
      })
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`)
      }
      localStorage.setItem('lc_bridge_server', trimmedServer)
      localStorage.setItem('lc_bridge_token', trimmedToken)
      onConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-bg-secondary border border-border rounded-xl p-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-text-primary text-xl font-semibold">Connect to Lucent Code</h1>
          <p className="text-text-secondary text-sm">
            Enter the token shown in the Electron app console when it starts.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-text-secondary text-xs font-medium uppercase tracking-wide">
              Server URL
            </label>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-text-primary text-sm outline-none focus:border-accent"
              placeholder="http://localhost:8788"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-text-secondary text-xs font-medium uppercase tracking-wide">
              Token
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2.5 text-text-primary text-sm font-mono outline-none focus:border-accent"
              placeholder="Paste token from console…"
              autoFocus
            />
            <p className="text-text-tertiary text-xs">
              Look for <code className="text-accent">token: xxxxxxxx</code> in the Electron app terminal output.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={handleConnect}
          disabled={testing}
          className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
        >
          {testing ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
