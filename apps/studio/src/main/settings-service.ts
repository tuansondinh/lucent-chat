/**
 * SettingsService — persists app-level settings to disk.
 *
 * Settings file: ~/.lucent/settings.json
 * File permissions: 0o600 (contains API keys).
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// ============================================================================
// Types
// ============================================================================

export interface AppSettings {
  /** Default model to use when starting the app. */
  defaultModel?: { provider: string; modelId: string }
  /** Runtime thinking/reasoning level exposed by Pi/GSD. */
  thinkingLevel?: 'low' | 'medium' | 'high'
  /** UI theme — only dark for now. */
  theme: 'dark'
  /** Editor/chat font size in px. */
  fontSize: number
  /** Tavily API key for web search tools. */
  tavilyApiKey?: string
  /** Whether the session sidebar is collapsed. */
  sidebarCollapsed: boolean
  /** Last window bounds for position/size restore. */
  windowBounds?: { x: number; y: number; width: number; height: number }
  /** Last project root restored at app startup. */
  lastProjectRoot?: string
  /** Last active file path within the restored project. */
  lastActiveFilePath?: string
  /** Whether the user has completed first-run onboarding. */
  onboardingComplete?: boolean
  /** Push-to-talk shortcut for pane-scoped voice input. */
  voicePttShortcut?: 'space' | 'alt+space' | 'cmd+shift+space'
  /** Whether assistant TTS playback is enabled. */
  voiceAudioEnabled?: boolean
  /** Whether the Python voice sidecar is allowed to run. */
  voiceServiceEnabled?: boolean
  /** Whether voice models have already been downloaded on this machine. */
  voiceModelsDownloaded?: boolean
  /** Whether the user opted in to voice features during onboarding. */
  voiceOptIn?: boolean
  /** When true, all text responses are spoken aloud (TTS-only mode, no mic). */
  textToSpeechMode?: boolean

  // ---------------------------------------------------------------------------
  // Remote Access (PWA / Tailscale)
  // ---------------------------------------------------------------------------

  /** Whether the WebBridgeServer is enabled. */
  remoteAccessEnabled?: boolean
  /** Port for the WebBridgeServer (default: 8788). */
  remoteAccessPort?: number
  /** Bearer token for WebBridgeServer authentication. Auto-generated on first use. */
  remoteAccessToken?: string
  /** Whether to run `tailscale serve` to expose the server via HTTPS. */
  tailscaleServeEnabled?: boolean

  // ---------------------------------------------------------------------------
  // Permission mode
  // ---------------------------------------------------------------------------

  /** Agent file-mutation permission mode. danger-full-access = no approval prompts; accept-on-edit = prompt before each file change; auto = classifier-based. */
  permissionMode?: 'danger-full-access' | 'accept-on-edit' | 'auto'

  /** Rules for Auto mode. */
  autoModeRules?: Array<{ toolName: string; pattern: string; decision: 'allow' | 'deny' }>

  /** Which LLM provider to use for the Auto mode classifier. Defaults to 'anthropic'. */
  classifierProvider?: 'anthropic' | 'google'
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_PERMISSION_MODE = 'auto' as const

const DEFAULTS: AppSettings = {
  theme: 'dark',
  fontSize: 14,
  thinkingLevel: 'medium',
  sidebarCollapsed: false,
  onboardingComplete: false,
  voiceModelsDownloaded: false,
  voicePttShortcut: 'space',
  voiceAudioEnabled: true,
  voiceServiceEnabled: true,
  textToSpeechMode: false,
  remoteAccessEnabled: false,
  remoteAccessPort: 8788,
  tailscaleServeEnabled: false,
  permissionMode: 'auto',
  autoModeRules: [
    { toolName: 'bash', pattern: 'git *', decision: 'allow' },
    { toolName: 'bash', pattern: 'npm *', decision: 'allow' },
    { toolName: 'bash', pattern: 'rm *', decision: 'deny' },
    { toolName: 'bash', pattern: 'sudo *', decision: 'deny' },
    { toolName: 'bash', pattern: 'chmod *', decision: 'deny' },
  ],
}

// ============================================================================
// SettingsService
// ============================================================================

export class SettingsService {
  private readonly settingsPath: string
  private settings: AppSettings

  constructor() {
    const dir = process.env.LUCENT_CONFIG_DIR ?? join(homedir(), '.lucent')
    this.settingsPath = join(dir, 'settings.json')
    this.settings = { ...DEFAULTS }
    this.ensureDir(dir)
    this.migrateLegacySettings(dir)
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Load settings from disk synchronously, apply defaults, and return them.
   * Safe to call at startup before the event loop is busy.
   */
  load(): AppSettings {
    try {
      const raw = readFileSync(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppSettings> & { voicePttShortcut?: string }
      if (parsed.voicePttShortcut === 'alt+v') {
        parsed.voicePttShortcut = 'space'
      }
      // Merge stored values over defaults (shallow)
      this.settings = { ...DEFAULTS, ...parsed }
      if (this.settings.voiceModelsDownloaded && !hasVoiceModelsDownloaded()) {
        this.settings.voiceModelsDownloaded = false
        this.save({ voiceModelsDownloaded: false })
      }
    } catch {
      // File may not exist yet — use defaults and write them to disk
      this.settings = { ...DEFAULTS }
      this.save({})
    }
    return this.settings
  }

  /**
   * Merge a partial settings object into the current settings and write to disk.
   * File is written with 0o600 permissions to protect API keys.
   */
  save(partial: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...partial }
    const json = JSON.stringify(this.settings, null, 2)
    writeFileSync(this.settingsPath, json, { encoding: 'utf8', mode: 0o600 })
  }

  /**
   * Return current in-memory settings (does not re-read from disk).
   */
  get(): AppSettings {
    return this.settings
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Ensure the settings directory exists (create if missing).
   */
  private ensureDir(dir: string): void {
    try {
      mkdirSync(dir, { recursive: true })
      // Best-effort chmod on the directory
      try { chmodSync(dir, 0o700) } catch { /* ignore */ }
    } catch (err: any) {
      if (err?.code !== 'EEXIST') {
        console.warn('[settings-service] could not create settings dir:', err?.message)
      }
    }
  }

  /**
   * Migrate the legacy Voice Bridge Desktop settings path on first run after rename.
   */
  private migrateLegacySettings(dir: string): void {
    if (existsSync(this.settingsPath)) return

    const legacyPath = join(homedir(), '.voice-bridge-desktop', 'settings.json')
    if (!existsSync(legacyPath)) return

    try {
      copyFileSync(legacyPath, this.settingsPath)
      try { chmodSync(this.settingsPath, 0o600) } catch { /* ignore */ }
    } catch (err: any) {
      console.warn('[settings-service] could not migrate legacy settings:', err?.message)
    }
  }
}

function hasVoiceModelsDownloaded(): boolean {
  const home = homedir()

  const requiredPaths = [
    join(home, 'Library', 'Application Support', 'pywhispercpp', 'models', 'ggml-large-v3-turbo.bin'),
    join(home, '.cache', 'huggingface', 'hub', 'models--hexgrad--Kokoro-82M'),
  ]

  return requiredPaths.every((modelPath) => existsSync(modelPath))
}
