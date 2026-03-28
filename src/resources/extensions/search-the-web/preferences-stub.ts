/**
 * Stub for gsd preferences integration.
 *
 * In Lucent Code there is no gsd extension or preferences.md file,
 * so we always return undefined here. The search provider falls back to
 * the env var / auth.json resolution path in provider.ts.
 */

export type SearchProviderPreference = 'tavily' | 'brave' | 'ollama' | 'auto' | 'native'

/**
 * Always returns undefined — no preferences.md file in this runtime.
 * provider.ts and native-search.ts fall back to env var / auth.json.
 */
export function resolveSearchProviderFromPreferences(): SearchProviderPreference | undefined {
  return undefined
}
