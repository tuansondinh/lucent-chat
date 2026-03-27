/**
 * AuthService — manages LLM provider API keys and OAuth credentials for Lucent Chat Desktop.
 *
 * Reads/writes ~/.gsd/agent/auth.json using the same format as the GSD web
 * onboarding (FileOnboardingAuthStorage pattern). Validates keys via HTTP
 * before persisting.
 *
 * Also supports OAuth login flows for providers like Anthropic, GitHub Copilot,
 * ChatGPT (OpenAI Codex), Google Cloud Code Assist (Gemini CLI), and Antigravity.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import * as https from 'node:https'
import { getOAuthProvider, type OAuthLoginCallbacks } from '@gsd/pi-ai/oauth'

// ============================================================================
// Types
// ============================================================================

export interface ProviderCatalogEntry {
  id: string
  label: string
  recommended?: boolean
  keyPlaceholder?: string
  supportsApiKey: boolean
  supportsOAuth: boolean
}

export interface ProviderAuthStatus {
  id: string
  label: string
  configured: boolean
  configuredVia: 'auth_file' | 'environment' | null
  removeAllowed: boolean
  recommended?: boolean
  supportsApiKey: boolean
  supportsOAuth: boolean
}

type ApiKeyCredential = { type: 'api_key'; key: string }
type StoredCredential = ApiKeyCredential | ({ type: 'oauth' } & Record<string, unknown>)
type StoredCredentialData = Record<string, StoredCredential | StoredCredential[]>

// ============================================================================
// Provider catalog and env var mapping
// ============================================================================

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic:  ['ANTHROPIC_API_KEY'],
  openai:     ['OPENAI_API_KEY'],
  google:     ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_STUDIO_KEY'],
  groq:       ['GROQ_API_KEY'],
  xai:        ['XAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  mistral:    ['MISTRAL_API_KEY'],
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'anthropic',         label: 'Anthropic (Claude)',                          recommended: true, keyPlaceholder: 'sk-ant-...', supportsApiKey: true,  supportsOAuth: true  },
  { id: 'openai',            label: 'OpenAI',                                                         keyPlaceholder: 'sk-...',     supportsApiKey: true,  supportsOAuth: false },
  { id: 'google',            label: 'Google (Gemini)',                                                 keyPlaceholder: 'AI...',      supportsApiKey: true,  supportsOAuth: false },
  { id: 'groq',              label: 'Groq',                                                            keyPlaceholder: 'gsk_...',    supportsApiKey: true,  supportsOAuth: false },
  { id: 'xai',               label: 'xAI (Grok)',                                                      keyPlaceholder: 'xai-...',    supportsApiKey: true,  supportsOAuth: false },
  { id: 'openrouter',        label: 'OpenRouter',                                                      keyPlaceholder: 'sk-or-...',  supportsApiKey: true,  supportsOAuth: false },
  { id: 'mistral',           label: 'Mistral',                                                         keyPlaceholder: 'your-key',   supportsApiKey: true,  supportsOAuth: false },
  { id: 'github-copilot',    label: 'GitHub Copilot',                                                                                supportsApiKey: false, supportsOAuth: true  },
  { id: 'openai-codex',      label: 'ChatGPT Plus/Pro',                                                                              supportsApiKey: false, supportsOAuth: true  },
  { id: 'google-gemini-cli', label: 'Google Code Assist',                                                                            supportsApiKey: false, supportsOAuth: true  },
  { id: 'google-antigravity', label: 'Antigravity',                                                                                  supportsApiKey: false, supportsOAuth: true  },
]

// ============================================================================
// Auth file helpers
// ============================================================================

function getAuthFilePath(): string {
  return join(homedir(), '.gsd', 'agent', 'auth.json')
}

function ensureAuthFile(authPath: string): void {
  const dir = dirname(authPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!existsSync(authPath)) {
    writeFileSync(authPath, '{}', 'utf-8')
    chmodSync(authPath, 0o600)
  }
}

function readAuthData(authPath: string): StoredCredentialData {
  ensureAuthFile(authPath)
  try {
    const content = readFileSync(authPath, 'utf-8')
    const parsed = JSON.parse(content)
    return (typeof parsed === 'object' && parsed !== null) ? (parsed as StoredCredentialData) : {}
  } catch {
    return {}
  }
}

function writeAuthData(authPath: string, data: StoredCredentialData): void {
  writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf-8')
  chmodSync(authPath, 0o600)
}

function getCredentials(data: StoredCredentialData, provider: string): StoredCredential[] {
  const entry = data[provider]
  if (!entry) return []
  return Array.isArray(entry) ? entry : [entry]
}

function mergeApiKey(existing: StoredCredential[], key: string): StoredCredential[] {
  const alreadyStored = existing.some(
    (c) => c.type === 'api_key' && (c as ApiKeyCredential).key === key,
  )
  if (alreadyStored) return existing
  return [...existing, { type: 'api_key', key }]
}

// ============================================================================
// HTTP validation
// ============================================================================

function validateViaHttp(
  providerId: string,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve({ ok: false, message: 'Request timed out' }), 15_000)

    const done = (result: { ok: boolean; message: string }) => {
      clearTimeout(timeoutId)
      resolve(result)
    }

    let options: https.RequestOptions

    switch (providerId) {
      case 'anthropic':
        options = {
          hostname: 'api.anthropic.com',
          path: '/v1/models',
          method: 'GET',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        }
        break
      case 'openai':
        options = {
          hostname: 'api.openai.com',
          path: '/v1/models',
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        }
        break
      case 'google':
        options = {
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models?key=${encodeURIComponent(apiKey)}`,
          method: 'GET',
        }
        break
      case 'groq':
        options = {
          hostname: 'api.groq.com',
          path: '/openai/v1/models',
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        }
        break
      case 'xai':
        options = {
          hostname: 'api.x.ai',
          path: '/v1/models',
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        }
        break
      case 'openrouter':
        options = {
          hostname: 'openrouter.ai',
          path: '/api/v1/models',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://lucent.chat',
            'X-Title': 'Lucent Chat',
          },
        }
        break
      case 'mistral':
        options = {
          hostname: 'api.mistral.ai',
          path: '/v1/models',
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        }
        break
      default:
        done({ ok: false, message: `Unknown provider: ${providerId}` })
        return
    }

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) {
          done({ ok: true, message: 'API key validated' })
        } else {
          let detail = `HTTP ${status}`
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>
            const errObj = parsed.error as Record<string, unknown> | undefined
            const msg = (errObj?.message ?? parsed.message) as string | undefined
            if (msg) detail += `: ${msg}`
          } catch { /* ignore parse errors */ }
          done({ ok: false, message: detail })
        }
      })
      res.on('error', (err: Error) => done({ ok: false, message: err.message }))
    })

    req.on('error', (err: Error) => done({ ok: false, message: err.message }))
    req.end()
  })
}

// ============================================================================
// AuthService
// ============================================================================

export class AuthService {
  private readonly authPath = getAuthFilePath()

  /** Tracks in-flight OAuth flows by provider ID. */
  private activeFlows = new Map<string, {
    abort: AbortController
    pendingInput: { resolve: (v: string) => void; reject: (e: Error) => void } | null
  }>()

  getProviderCatalog(): ProviderCatalogEntry[] {
    return PROVIDER_CATALOG
  }

  getProviderStatuses(): ProviderAuthStatus[] {
    const data = readAuthData(this.authPath)
    return PROVIDER_CATALOG.map((entry) => {
      const creds = getCredentials(data, entry.id)
      // Configured via auth file if any credential type (api_key or oauth) is stored
      const hasFileAuth = creds.some((c) => c.type === 'api_key' || c.type === 'oauth')
      const hasEnvAuth = (PROVIDER_ENV_VARS[entry.id] ?? []).some(
        (v) => Boolean(process.env[v]),
      )
      const configuredVia: ProviderAuthStatus['configuredVia'] =
        hasFileAuth ? 'auth_file' : hasEnvAuth ? 'environment' : null
      return {
        id: entry.id,
        label: entry.label,
        configured: hasFileAuth || hasEnvAuth,
        configuredVia,
        removeAllowed: configuredVia === 'auth_file',
        recommended: entry.recommended,
        supportsApiKey: entry.supportsApiKey,
        supportsOAuth: entry.supportsOAuth,
      }
    })
  }

  async validateAndSaveApiKey(
    providerId: string,
    apiKey: string,
  ): Promise<{ ok: boolean; message: string; providerStatuses: ProviderAuthStatus[] }> {
    const validation = await validateViaHttp(providerId, apiKey)
    if (!validation.ok) {
      return {
        ok: false,
        message: validation.message,
        providerStatuses: this.getProviderStatuses(),
      }
    }
    const data = readAuthData(this.authPath)
    const existing = getCredentials(data, providerId)
    const merged = mergeApiKey(existing, apiKey)
    data[providerId] = merged.length === 1 ? merged[0] : merged
    writeAuthData(this.authPath, data)
    return { ok: true, message: 'API key saved', providerStatuses: this.getProviderStatuses() }
  }

  /**
   * Remove ALL auth.json credentials for a provider (both api_key and oauth).
   * Method name kept as removeApiKey for backward compatibility with existing IPC wiring.
   */
  removeApiKey(providerId: string): ProviderAuthStatus[] {
    const data = readAuthData(this.authPath)
    delete data[providerId]
    writeAuthData(this.authPath, data)
    return this.getProviderStatuses()
  }

  /**
   * Start an OAuth login flow for the given provider.
   *
   * This method is long-running — it resolves only when the login completes,
   * is cancelled, or errors. Progress events are pushed to the renderer via
   * `pushEvent('event:oauth-progress', ...)`.
   *
   * @param providerId - The provider ID (e.g. 'anthropic', 'github-copilot')
   * @param pushEvent  - Sends IPC events to the renderer window
   * @param openBrowser - Opens a URL in the system browser (shell.openExternal)
   */
  async startOAuthLogin(
    providerId: string,
    pushEvent: (channel: string, data: unknown) => void,
    openBrowser: (url: string) => Promise<void>,
  ): Promise<{ ok: boolean; message: string; providerStatuses: ProviderAuthStatus[] }> {
    // Cancel any existing flow for this provider before starting a new one
    this.cancelOAuthFlow(providerId)

    const abort = new AbortController()
    const flowState: {
      abort: AbortController
      pendingInput: { resolve: (v: string) => void; reject: (e: Error) => void } | null
    } = { abort, pendingInput: null }
    this.activeFlows.set(providerId, flowState)

    const sendProgress = (type: string, extra?: Record<string, unknown>) => {
      pushEvent('event:oauth-progress', { providerId, type, ...extra })
    }

    /** Creates a promise that resolves when submitOAuthCode is called. */
    const makeInputPromise = () => new Promise<string>((resolve, reject) => {
      flowState.pendingInput = { resolve, reject }
      abort.signal.addEventListener('abort', () => reject(new Error('OAuth cancelled')))
    })

    try {
      const provider = getOAuthProvider(providerId)
      if (!provider) throw new Error(`No OAuth provider registered for: ${providerId}`)

      const callbacks: OAuthLoginCallbacks = {
        onAuth: ({ url, instructions }) => {
          sendProgress('open_browser', { url, instructions: instructions ?? null })
          void openBrowser(url)
        },
        onPrompt: async (prompt) => {
          sendProgress('awaiting_input', {
            message: prompt.message,
            placeholder: prompt.placeholder ?? null,
            allowEmpty: prompt.allowEmpty ?? false,
          })
          return makeInputPromise()
        },
        onProgress: (message) => {
          sendProgress('progress', { message })
        },
        onManualCodeInput: async () => {
          sendProgress('awaiting_code', {
            message: 'Paste the redirect URL from your browser:',
            placeholder: 'http://localhost:...',
          })
          return makeInputPromise()
        },
        signal: abort.signal,
      }

      const credentials = await provider.login(callbacks)

      // Save OAuth credentials: keep any existing API keys, replace any existing OAuth credential
      const data = readAuthData(this.authPath)
      const existing = getCredentials(data, providerId)
      const apiKeys = existing.filter((c) => c.type === 'api_key')
      const merged = [...apiKeys, { type: 'oauth' as const, ...credentials }]
      data[providerId] = merged.length === 1 ? merged[0] : merged
      writeAuthData(this.authPath, data)

      this.activeFlows.delete(providerId)
      return { ok: true, message: 'Authentication successful', providerStatuses: this.getProviderStatuses() }
    } catch (error) {
      this.activeFlows.delete(providerId)
      const message = error instanceof Error ? error.message : String(error)
      const isCancelled =
        abort.signal.aborted ||
        message.toLowerCase().includes('cancel') ||
        message.toLowerCase().includes('abort')
      return {
        ok: false,
        message: isCancelled ? 'Cancelled' : message,
        providerStatuses: this.getProviderStatuses(),
      }
    }
  }

  /**
   * Resolves the pending onPrompt or onManualCodeInput for an in-flight OAuth flow.
   * Call this when the user submits a code in the UI.
   */
  submitOAuthCode(providerId: string, code: string): void {
    const flow = this.activeFlows.get(providerId)
    if (flow?.pendingInput) {
      const { resolve } = flow.pendingInput
      flow.pendingInput = null
      resolve(code)
    }
  }

  /**
   * Cancels an in-flight OAuth flow by aborting its AbortController and
   * rejecting any pending input promise.
   */
  cancelOAuthFlow(providerId: string): void {
    const flow = this.activeFlows.get(providerId)
    if (flow) {
      flow.pendingInput?.reject(new Error('OAuth cancelled'))
      flow.abort.abort()
      this.activeFlows.delete(providerId)
    }
  }
}
