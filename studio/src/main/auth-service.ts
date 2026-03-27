/**
 * AuthService — manages LLM provider API keys for Lucent Chat Desktop.
 *
 * Reads/writes ~/.gsd/agent/auth.json using the same format as the GSD web
 * onboarding (FileOnboardingAuthStorage pattern). Validates keys via HTTP
 * before persisting.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import * as https from 'node:https'

// ============================================================================
// Types
// ============================================================================

export interface ProviderCatalogEntry {
  id: string
  label: string
  recommended?: boolean
  keyPlaceholder: string
}

export interface ProviderAuthStatus {
  id: string
  label: string
  configured: boolean
  configuredVia: 'auth_file' | 'environment' | null
  removeAllowed: boolean
  recommended?: boolean
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
  { id: 'anthropic',  label: 'Anthropic (Claude)',  recommended: true, keyPlaceholder: 'sk-ant-...' },
  { id: 'openai',     label: 'OpenAI',                                 keyPlaceholder: 'sk-...' },
  { id: 'google',     label: 'Google (Gemini)',                         keyPlaceholder: 'AI...' },
  { id: 'groq',       label: 'Groq',                                    keyPlaceholder: 'gsk_...' },
  { id: 'xai',        label: 'xAI (Grok)',                              keyPlaceholder: 'xai-...' },
  { id: 'openrouter', label: 'OpenRouter',                              keyPlaceholder: 'sk-or-...' },
  { id: 'mistral',    label: 'Mistral',                                 keyPlaceholder: 'your-key' },
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

  getProviderCatalog(): ProviderCatalogEntry[] {
    return PROVIDER_CATALOG
  }

  getProviderStatuses(): ProviderAuthStatus[] {
    const data = readAuthData(this.authPath)
    return PROVIDER_CATALOG.map((entry) => {
      const creds = getCredentials(data, entry.id)
      const hasFileAuth = creds.some((c) => c.type === 'api_key')
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

  removeApiKey(providerId: string): ProviderAuthStatus[] {
    const data = readAuthData(this.authPath)
    const existing = getCredentials(data, providerId)
    const withoutApiKeys = existing.filter((c) => c.type !== 'api_key')
    if (withoutApiKeys.length === 0) {
      delete data[providerId]
    } else {
      data[providerId] = withoutApiKeys.length === 1 ? withoutApiKeys[0] : withoutApiKeys
    }
    writeAuthData(this.authPath, data)
    return this.getProviderStatuses()
  }
}
