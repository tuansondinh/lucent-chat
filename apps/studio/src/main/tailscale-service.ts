/**
 * TailscaleService — wraps the tailscale CLI to provide:
 *   - Host detection (via `tailscale status --json`)
 *   - Serve tunnel setup (`tailscale serve --bg http://localhost:<port>`)
 *   - Serve status query
 *
 * Gracefully handles:
 *   - Tailscale not installed
 *   - Tailscale signed out
 *   - Port conflicts in `tailscale serve`
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'

const execFileAsync = promisify(execFile)

// Common paths where Tailscale CLI might be installed
const TAILSCALE_PATHS = [
  'tailscale',                               // in PATH
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  // macOS app binary
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
]

export interface TailscaleStatus {
  available: boolean
  signedIn: boolean
  hostname: string | null
  tailnetName: string | null
  /** Full MagicDNS hostname, e.g. myhost.tail12345.ts.net */
  magicDnsHostname: string | null
  error?: string
}

export interface ServeStatus {
  active: boolean
  httpsUrl: string | null
  port: number | null
  error?: string
}

export class TailscaleService {
  private cliPath: string | null = null

  // ---------------------------------------------------------------------------
  // CLI path detection
  // ---------------------------------------------------------------------------

  private async detectCliPath(): Promise<string | null> {
    if (this.cliPath) return this.cliPath

    for (const path of TAILSCALE_PATHS) {
      try {
        if (path === 'tailscale') {
          // Try running it from PATH
          await execFileAsync('tailscale', ['version'], { timeout: 3_000 })
          this.cliPath = 'tailscale'
          return this.cliPath
        }
        if (existsSync(path)) {
          this.cliPath = path
          return this.cliPath
        }
      } catch {
        // Not found at this path
      }
    }

    return null
  }

  private async exec(args: string[], timeoutMs = 5_000): Promise<string> {
    const cli = await this.detectCliPath()
    if (!cli) throw new Error('tailscale CLI not found')

    const { stdout } = await execFileAsync(cli, args, {
      timeout: timeoutMs,
      encoding: 'utf8',
    })
    return stdout.trim()
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get the current Tailscale node status.
   * Returns availability, sign-in state, and hostname info.
   */
  async getStatus(): Promise<TailscaleStatus> {
    const cli = await this.detectCliPath()
    if (!cli) {
      return { available: false, signedIn: false, hostname: null, tailnetName: null, magicDnsHostname: null, error: 'Tailscale not installed' }
    }

    try {
      const json = await this.exec(['status', '--json'])
      const status = JSON.parse(json) as {
        BackendState?: string
        Self?: {
          HostName?: string
          DNSName?: string
          TailscaleIPs?: string[]
        }
        MagicDNSSuffix?: string
        CurrentTailnet?: { Name?: string }
      }

      if (status.BackendState === 'NeedsLogin' || status.BackendState === 'Stopped') {
        return { available: true, signedIn: false, hostname: null, tailnetName: null, magicDnsHostname: null, error: 'Not signed in to Tailscale' }
      }

      const hostname = status.Self?.HostName ?? null
      const dnsName = status.Self?.DNSName ?? null
      // DNSName often has a trailing dot, strip it
      const magicDnsHostname = dnsName ? dnsName.replace(/\.$/, '') : null
      const tailnetName = status.CurrentTailnet?.Name ?? null

      return { available: true, signedIn: true, hostname, tailnetName, magicDnsHostname }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { available: true, signedIn: false, hostname: null, tailnetName: null, magicDnsHostname: null, error: message }
    }
  }

  /**
   * Enable `tailscale serve` to tunnel traffic from port to the internet.
   * Runs: tailscale serve --bg http://localhost:<port>
   */
  async enableServe(port: number): Promise<ServeStatus> {
    try {
      await this.exec(['serve', '--bg', `http://localhost:${port}`], 10_000)
      return this.getServeStatus(port)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      // Detect port conflict
      if (message.includes('already in use') || message.includes('conflict') || message.includes('already exists')) {
        return { active: false, httpsUrl: null, port, error: `Serve port conflict: ${message}` }
      }
      return { active: false, httpsUrl: null, port, error: message }
    }
  }

  /**
   * Disable `tailscale serve` for the given port.
   */
  async disableServe(port: number): Promise<void> {
    try {
      await this.exec(['serve', '--remove', `https://localhost:${port}`], 5_000)
    } catch {
      // Best effort — might already be removed
    }
  }

  /**
   * Get the current serve status for a given port.
   * Returns the HTTPS URL if active.
   */
  async getServeStatus(port: number): Promise<ServeStatus> {
    try {
      const statusResult = await this.getStatus()
      if (!statusResult.available || !statusResult.signedIn) {
        return { active: false, httpsUrl: null, port, error: statusResult.error }
      }

      const serveJson = await this.exec(['serve', 'status', '--json'], 5_000)
      const serve = JSON.parse(serveJson) as Record<string, unknown>

      // Check if our port is in the serve config
      const portStr = String(port)
      const isActive = Object.keys(serve).some((k) => k.includes(portStr))

      let httpsUrl: string | null = null
      if (isActive && statusResult.magicDnsHostname) {
        httpsUrl = `https://${statusResult.magicDnsHostname}`
      }

      return { active: isActive, httpsUrl, port }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { active: false, httpsUrl: null, port, error: message }
    }
  }
}
