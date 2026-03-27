/**
 * Stub for gsd preferences integration.
 *
 * In voice-bridge-desktop there is no gsd extension or preferences.md file,
 * so we always return undefined here. The search provider falls back to
 * the env var / auth.json resolution path in provider.ts.
 */
/**
 * Always returns undefined — no preferences.md file in this runtime.
 * provider.ts and native-search.ts fall back to env var / auth.json.
 */
export function resolveSearchProviderFromPreferences() {
    return undefined;
}
