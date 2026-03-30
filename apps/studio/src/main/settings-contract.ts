import type { AppSettings } from './settings-service.js'

export type RendererSettings = Omit<AppSettings, 'tavilyApiKey' | 'remoteAccessToken'> & { hasTavilyKey: boolean }

export function sanitizeSettingsForRenderer(settings: AppSettings): RendererSettings {
  const { tavilyApiKey, remoteAccessToken, ...rest } = settings
  return {
    ...rest,
    hasTavilyKey: typeof tavilyApiKey === 'string' && tavilyApiKey.length > 0,
  }
}

export function validateSettingsPatch(partial: Record<string, unknown>): Partial<AppSettings> {
  const validated: Partial<AppSettings> = {}

  if ('defaultModel' in partial) {
    const value = partial.defaultModel
    if (
      value === undefined
      || (
        typeof value === 'object'
        && typeof (value as { provider?: unknown }).provider === 'string'
        && typeof (value as { modelId?: unknown }).modelId === 'string'
      )
    ) {
      validated.defaultModel = value as AppSettings['defaultModel']
    } else {
      throw new Error('Invalid defaultModel setting')
    }
  }

  if ('theme' in partial) {
    if (partial.theme !== 'dark') throw new Error('Invalid theme setting')
    validated.theme = 'dark'
  }

  if ('fontSize' in partial) {
    if (typeof partial.fontSize !== 'number' || !Number.isFinite(partial.fontSize)) {
      throw new Error('Invalid fontSize setting')
    }
    validated.fontSize = partial.fontSize
  }

  if ('tavilyApiKey' in partial) {
    if (typeof partial.tavilyApiKey !== 'string') {
      throw new Error('Invalid tavilyApiKey setting')
    }
    validated.tavilyApiKey = partial.tavilyApiKey
  }

  if ('sidebarCollapsed' in partial) {
    if (typeof partial.sidebarCollapsed !== 'boolean') {
      throw new Error('Invalid sidebarCollapsed setting')
    }
    validated.sidebarCollapsed = partial.sidebarCollapsed
  }

  if ('windowBounds' in partial) {
    const value = partial.windowBounds
    if (
      value === undefined
      || (
        value !== null
        && typeof value === 'object'
        && ['x', 'y', 'width', 'height'].every((key) => typeof (value as Record<string, unknown>)[key] === 'number')
      )
    ) {
      validated.windowBounds = value as AppSettings['windowBounds']
    } else {
      throw new Error('Invalid windowBounds setting')
    }
  }

  if ('lastProjectRoot' in partial) {
    if (partial.lastProjectRoot !== undefined && typeof partial.lastProjectRoot !== 'string') {
      throw new Error('Invalid lastProjectRoot setting')
    }
    validated.lastProjectRoot = partial.lastProjectRoot
  }

  if ('lastActiveFilePath' in partial) {
    if (partial.lastActiveFilePath !== undefined && typeof partial.lastActiveFilePath !== 'string') {
      throw new Error('Invalid lastActiveFilePath setting')
    }
    validated.lastActiveFilePath = partial.lastActiveFilePath
  }

  if ('onboardingComplete' in partial) {
    if (typeof partial.onboardingComplete !== 'boolean') {
      throw new Error('Invalid onboardingComplete setting')
    }
    validated.onboardingComplete = partial.onboardingComplete
  }

  if ('voicePttShortcut' in partial) {
    const value = partial.voicePttShortcut
    if (value !== 'space' && value !== 'alt+space' && value !== 'cmd+shift+space') {
      throw new Error('Invalid voicePttShortcut setting')
    }
    validated.voicePttShortcut = value
  }

  if ('voiceAudioEnabled' in partial) {
    if (typeof partial.voiceAudioEnabled !== 'boolean') {
      throw new Error('Invalid voiceAudioEnabled setting')
    }
    validated.voiceAudioEnabled = partial.voiceAudioEnabled
  }

  if ('voiceServiceEnabled' in partial) {
    if (typeof partial.voiceServiceEnabled !== 'boolean') {
      throw new Error('Invalid voiceServiceEnabled setting')
    }
    validated.voiceServiceEnabled = partial.voiceServiceEnabled
  }

  if ('voiceModelsDownloaded' in partial) {
    if (typeof partial.voiceModelsDownloaded !== 'boolean') {
      throw new Error('Invalid voiceModelsDownloaded setting')
    }
    validated.voiceModelsDownloaded = partial.voiceModelsDownloaded
  }

  if ('voiceOptIn' in partial) {
    if (typeof partial.voiceOptIn !== 'boolean') {
      throw new Error('Invalid voiceOptIn setting')
    }
    validated.voiceOptIn = partial.voiceOptIn
  }

  if ('textToSpeechMode' in partial) {
    if (typeof partial.textToSpeechMode !== 'boolean') {
      throw new Error('Invalid textToSpeechMode setting')
    }
    validated.textToSpeechMode = partial.textToSpeechMode
  }

  if ('remoteAccessEnabled' in partial) {
    if (typeof partial.remoteAccessEnabled !== 'boolean') {
      throw new Error('Invalid remoteAccessEnabled setting')
    }
    validated.remoteAccessEnabled = partial.remoteAccessEnabled
  }

  if ('remoteAccessPort' in partial) {
    if (
      typeof partial.remoteAccessPort !== 'number'
      || !Number.isInteger(partial.remoteAccessPort)
      || partial.remoteAccessPort <= 0
      || partial.remoteAccessPort > 65535
    ) {
      throw new Error('Invalid remoteAccessPort setting')
    }
    validated.remoteAccessPort = partial.remoteAccessPort
  }

  if ('remoteAccessToken' in partial) {
    if (typeof partial.remoteAccessToken !== 'string' || partial.remoteAccessToken.length < 16) {
      throw new Error('Invalid remoteAccessToken setting: must be at least 16 characters')
    }
    validated.remoteAccessToken = partial.remoteAccessToken
  }

  if ('tailscaleServeEnabled' in partial) {
    if (typeof partial.tailscaleServeEnabled !== 'boolean') {
      throw new Error('Invalid tailscaleServeEnabled setting')
    }
    validated.tailscaleServeEnabled = partial.tailscaleServeEnabled
  }

  if ('permissionMode' in partial) {
    if (
      partial.permissionMode !== 'danger-full-access' &&
      partial.permissionMode !== 'accept-on-edit' &&
      partial.permissionMode !== 'auto'
    ) {
      throw new Error('Invalid permissionMode setting')
    }
    validated.permissionMode = partial.permissionMode
  }

  if ('autoModeRules' in partial) {
    const value = partial.autoModeRules
    if (!Array.isArray(value)) throw new Error('Invalid autoModeRules setting')
    for (const rule of value) {
      if (
        typeof rule !== 'object' ||
        rule === null ||
        typeof rule.toolName !== 'string' ||
        typeof rule.pattern !== 'string' ||
        (rule.decision !== 'allow' && rule.decision !== 'deny')
      ) {
        throw new Error('Invalid autoModeRules rule structure')
      }
    }
    validated.autoModeRules = value as AppSettings['autoModeRules']
  }

  if ('classifierProvider' in partial) {
    if (partial.classifierProvider !== 'anthropic' && partial.classifierProvider !== 'google') {
      throw new Error('Invalid classifierProvider setting')
    }
    validated.classifierProvider = partial.classifierProvider
  }

  const unknownKeys = Object.keys(partial).filter((key) => !(key in validated))
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown settings key: ${unknownKeys[0]}`)
  }

  return validated
}
