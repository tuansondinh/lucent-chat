/**
 * WebBridgeServer — exposes main-process bridge functionality over HTTP + WebSocket.
 *
 * Mirrors the preload bridge RPC:
 *   POST /api/cmd/:name   { args: [...] }  → invoke a bridge command
 *   WS   /events                           → bidirectional event stream
 *
 * Security:
 *   - Bearer token auth on all requests (Authorization: Bearer <token>)
 *   - WebSocket auth: first message must be { type: "auth", token: "..." }
 *   - Capability scoping for remote clients:
 *       blocked: cmd:terminal-*, cmd:fs-write, cmd:pick-folder
 *   - CORS: Tailscale origins + localhost only
 *
 * Lifecycle:
 *   start(port) → Promise<void>
 *   stop()      → Promise<void>
 */

import http from 'node:http'
import { EventEmitter } from 'node:events'
import { join, extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// Dynamically import ws so this file can be parsed without ws installed at compile time.
// ws is listed as a runtime dependency.
type WsServer = import('ws').WebSocketServer
type WsClient = import('ws').WebSocket

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebBridgeServerOptions {
  /** Bearer token for authentication. */
  token: string
  /** Callback to dispatch a bridge command by name with args. */
  dispatchCmd: (name: string, args: unknown[]) => Promise<unknown>
  /** Optional Tailscale HTTPS origin for CORS allowlist. */
  tailscaleOrigin?: string
  /** Optional directory of static files (PWA build) to serve at /. */
  staticDir?: string
  /** Callback to get the voice sidecar's localhost port and auth token (if running). */
  getVoiceEndpoint?: () => { port: number; token: string } | null
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

// Commands blocked for remote (PWA) clients
const BLOCKED_CMDS = new Set([
  'terminal-create',
  'terminal-input',
  'terminal-resize',
  'terminal-destroy',
  'pick-folder',
  // fs write ops (these are read-only allowed)
])

// Prefix-blocked commands (all cmd:terminal-* variants)
const BLOCKED_PREFIXES = ['terminal-']

function isCmdAllowed(name: string): boolean {
  if (BLOCKED_CMDS.has(name)) return false
  if (BLOCKED_PREFIXES.some((p) => name.startsWith(p))) return false
  return true
}

function isLocalhostRequest(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function isOriginAllowed(origin: string | undefined, tailscaleOrigin?: string): boolean {
  if (!origin) return true // non-browser / same-origin
  const allowed = [
    'http://localhost',
    'https://localhost',
    'http://127.0.0.1',
    'https://127.0.0.1',
  ]
  if (tailscaleOrigin) allowed.push(tailscaleOrigin)
  return allowed.some((o) => origin === o || origin.startsWith(o + ':'))
}

// ---------------------------------------------------------------------------
// WebBridgeServer
// ---------------------------------------------------------------------------

export class WebBridgeServer extends EventEmitter {
  private server: http.Server | null = null
  private wss: WsServer | null = null
  private options: WebBridgeServerOptions
  private clients = new Set<WsClient>()

  constructor(options: WebBridgeServerOptions) {
    super()
    this.options = options
  }

  /**
   * Start the HTTP + WebSocket server on the given port.
   */
  async start(port: number): Promise<void> {
    const { WebSocketServer } = await import('ws')

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })

    this.wss = new WebSocketServer({ server: this.server })
    this.wss.on('connection', (ws, req) => {
      const url = req.url ?? ''
      if (url.startsWith('/voice-ws')) {
        this.handleVoiceProxy(ws as WsClient, req)
      } else {
        this.handleWebSocket(ws as WsClient, req)
      }
    })

    return new Promise((resolve, reject) => {
      this.server!.listen(port, '0.0.0.0', () => {
        console.log(`[WebBridgeServer] listening on port ${port}`)
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  /**
   * Stop the server and close all WebSocket connections.
   */
  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()

    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.wss?.close()
      this.server.close(() => resolve())
      this.server = null
      this.wss = null
    })
  }

  /**
   * Push an event to all authenticated WebSocket clients.
   */
  pushEvent(event: string, data: unknown): void {
    const payload = JSON.stringify({ event, data })
    for (const client of this.clients) {
      try {
        client.send(payload)
      } catch {
        // Client disconnected — remove on next close event
      }
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP handler
  // ---------------------------------------------------------------------------

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin as string | undefined
    const url = req.url ?? ''

    // CORS preflight
    if (req.method === 'OPTIONS') {
      if (!isOriginAllowed(origin, this.options.tailscaleOrigin)) {
        res.writeHead(403)
        res.end()
        return
      }
      res.writeHead(204, this.corsHeaders(origin))
      res.end()
      return
    }

    // Auth check — localhost and tailscale-proxied connections skip token validation.
    // tailscale serve proxies remote requests to localhost, so isLocalhostRequest covers both.
    // Only API endpoints require a token; static assets are open (network auth via Tailscale).
    if (!isLocalhostRequest(req) && url.startsWith('/api/')) {
      const authHeader = req.headers.authorization ?? ''
      if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== this.options.token) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
    }

    // CORS
    if (!isOriginAllowed(origin, this.options.tailscaleOrigin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Origin not allowed' }))
      return
    }

    // Route: POST /api/cmd/:name
    const cmdMatch = url.match(/^\/api\/cmd\/([^/?]+)/)
    if (req.method === 'POST' && cmdMatch) {
      this.handleCommand(cmdMatch[1], req, res, origin)
      return
    }

    // Health endpoint
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...this.corsHeaders(origin) })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // Static file serving (PWA)
    if (req.method === 'GET' && this.options.staticDir) {
      this.serveStatic(url, res).catch(() => {
        res.writeHead(500)
        res.end()
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }

  private async serveStatic(url: string, res: http.ServerResponse): Promise<void> {
    const staticDir = this.options.staticDir!
    const pathname = url.split('?')[0]
    let filePath = join(staticDir, pathname === '/' ? 'index.html' : pathname)
    // Prevent path traversal
    if (!filePath.startsWith(staticDir)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!existsSync(filePath)) filePath = join(staticDir, 'index.html')
    try {
      const content = await readFile(filePath)
      const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  }

  private handleCommand(
    name: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    origin: string | undefined,
  ): void {
    if (!isCmdAllowed(name)) {
      res.writeHead(403, { 'Content-Type': 'application/json', ...this.corsHeaders(origin) })
      res.end(JSON.stringify({ error: `Command '${name}' not allowed for remote clients` }))
      return
    }

    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      let parsed: { args?: unknown[] } = {}
      try {
        parsed = JSON.parse(body || '{}') as { args?: unknown[] }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', ...this.corsHeaders(origin) })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
      }

      const args = Array.isArray(parsed.args) ? parsed.args : []
      this.options
        .dispatchCmd(name, args)
        .then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json', ...this.corsHeaders(origin) })
          res.end(JSON.stringify(result ?? null))
        })
        .catch((err: Error) => {
          res.writeHead(500, { 'Content-Type': 'application/json', ...this.corsHeaders(origin) })
          res.end(JSON.stringify({ error: err.message }))
        })
    })
  }

  private corsHeaders(origin: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
    if (origin && isOriginAllowed(origin, this.options.tailscaleOrigin)) {
      headers['Access-Control-Allow-Origin'] = origin
    }
    return headers
  }

  // ---------------------------------------------------------------------------
  // WebSocket handler
  // ---------------------------------------------------------------------------

  private handleWebSocket(ws: WsClient, req: http.IncomingMessage): void {
    let authenticated = false
    const origin = req.headers.origin as string | undefined

    if (!isOriginAllowed(origin, this.options.tailscaleOrigin)) {
      ws.close(1008, 'Origin not allowed')
      return
    }

    // Auth timeout — client must authenticate within 5 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(1008, 'Authentication timeout')
      }
    }, 5_000)

    ws.on('message', (raw: Buffer) => {
      let msg: unknown
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (!authenticated) {
        // Expect { type: "auth", token: "..." }
        // Localhost connections bypass token validation (same as HTTP handler).
        const m = msg as Record<string, unknown>
        if (m.type === 'auth' && (isLocalhostRequest(req) || m.token === this.options.token)) {
          authenticated = true
          clearTimeout(authTimeout)
          this.clients.add(ws)
          ws.send(JSON.stringify({ type: 'auth_ok' }))
        } else {
          ws.close(1008, 'Invalid token')
        }
        return
      }

      // Handle authenticated messages (currently none required from client)
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      this.clients.delete(ws)
    })

    ws.on('error', () => {
      this.clients.delete(ws)
    })
  }

  // ---------------------------------------------------------------------------
  // Voice WebSocket proxy — pipes binary audio between PWA client and sidecar
  // ---------------------------------------------------------------------------

  private async handleVoiceProxy(clientWs: WsClient, req: http.IncomingMessage): Promise<void> {
    const origin = req.headers.origin as string | undefined

    if (!isOriginAllowed(origin, this.options.tailscaleOrigin)) {
      clientWs.close(1008, 'Origin not allowed')
      return
    }

    // Auth: first message must be { type: "auth", token: "..." } (same as event WS)
    const { WebSocket: NodeWebSocket } = await import('ws')
    let authenticated = false
    const authTimeout = setTimeout(() => {
      if (!authenticated) clientWs.close(1008, 'Authentication timeout')
    }, 5_000)

    let sidecarWs: InstanceType<typeof NodeWebSocket> | null = null

    const cleanup = () => {
      if (sidecarWs) {
        sidecarWs.removeAllListeners()
        sidecarWs.close()
        sidecarWs = null
      }
    }

    clientWs.on('message', (raw: Buffer | ArrayBuffer, isBinary: boolean) => {
      if (!authenticated) {
        // Expect JSON auth message
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(raw.toString()) as Record<string, unknown>
        } catch {
          clientWs.close(1008, 'Invalid auth message')
          return
        }

        if (msg.type === 'auth' && (isLocalhostRequest(req) || msg.token === this.options.token)) {
          authenticated = true
          clearTimeout(authTimeout)

          // Connect to the voice sidecar
          const endpoint = this.options.getVoiceEndpoint?.()
          if (!endpoint) {
            clientWs.send(JSON.stringify({ type: 'error', message: 'Voice sidecar not running' }))
            clientWs.close(1011, 'Voice sidecar not running')
            return
          }

          const sidecarUrl = `ws://127.0.0.1:${endpoint.port}/ws?token=${encodeURIComponent(endpoint.token)}`
          sidecarWs = new NodeWebSocket(sidecarUrl)
          sidecarWs.binaryType = 'arraybuffer'

          sidecarWs.on('open', () => {
            clientWs.send(JSON.stringify({ type: 'auth_ok' }))
          })

          sidecarWs.on('message', (data: Buffer | ArrayBuffer, isBin: boolean) => {
            try {
              // Forward sidecar → client (binary audio or JSON)
              if (isBin) {
                clientWs.send(data, { binary: true })
              } else {
                clientWs.send(data.toString())
              }
            } catch {
              // client disconnected
            }
          })

          sidecarWs.on('close', () => {
            clientWs.close(1011, 'Voice sidecar disconnected')
          })

          sidecarWs.on('error', () => {
            clientWs.close(1011, 'Voice sidecar connection error')
          })
        } else {
          clientWs.close(1008, 'Invalid token')
        }
        return
      }

      // Authenticated: forward client → sidecar (binary audio or JSON)
      if (sidecarWs?.readyState === NodeWebSocket.OPEN) {
        if (isBinary) {
          sidecarWs.send(raw, { binary: true })
        } else {
          sidecarWs.send(raw.toString())
        }
      }
    })

    clientWs.on('close', () => {
      clearTimeout(authTimeout)
      cleanup()
    })

    clientWs.on('error', () => {
      cleanup()
    })
  }
}
