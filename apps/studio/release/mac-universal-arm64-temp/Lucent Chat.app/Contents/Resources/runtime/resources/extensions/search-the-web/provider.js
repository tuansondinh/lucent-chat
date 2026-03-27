/**
 * Search provider selection and preference management.
 *
 * Single source of truth for which search backend (Tavily vs Brave) to use.
 * Reads API keys from process.env at call time (not module load time) so
 * hot-reloaded keys work. Preference is stored in auth.json under the
 * synthetic provider key `search_provider` as { type: "api_key", key: "tavily" | "brave" | "auto" }.
 *
 * @see S01-RESEARCH.md for the storage decision rationale (D002).
 */
import { AuthStorage } from '@lc/runtime';
import { homedir } from 'os';
import { join } from 'path';
import { resolveSearchProviderFromPreferences } from './preferences-stub.js';
// Compute authFilePath locally instead of importing from app-paths.ts,
// because extensions are copied to ~/.gsd/agent/extensions/ at runtime
// where the relative import '../../../app-paths.ts' doesn't resolve.
const gsdHome = process.env.GSD_HOME || join(homedir(), '.gsd');
const authFilePath = join(gsdHome, 'agent', 'auth.json');
const VALID_PREFERENCES = new Set(['tavily', 'brave', 'ollama', 'auto']);
const PREFERENCE_KEY = 'search_provider';
/** Returns the Tavily API key from the environment, or empty string if not set. */
export function getTavilyApiKey() {
    return process.env.TAVILY_API_KEY || '';
}
/** Returns the Brave API key from the environment, or empty string if not set. */
export function getBraveApiKey() {
    return process.env.BRAVE_API_KEY || '';
}
/** Standard headers for Brave Search API requests. */
export function braveHeaders() {
    return {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": getBraveApiKey(),
    };
}
/** Returns the Ollama API key from the environment, or empty string if not set. */
export function getOllamaApiKey() {
    return process.env.OLLAMA_API_KEY || '';
}
/**
 * Read the user's search provider preference from auth.json.
 * Returns 'auto' if no preference is stored or the stored value is invalid.
 *
 * @param authPath — Override auth.json path (for testing).
 */
export function getSearchProviderPreference(authPath) {
    const auth = AuthStorage.create(authPath ?? authFilePath);
    const cred = auth.get(PREFERENCE_KEY);
    if (cred?.type === 'api_key' && typeof cred.key === 'string' && VALID_PREFERENCES.has(cred.key)) {
        return cred.key;
    }
    return 'auto';
}
/**
 * Write the user's search provider preference to auth.json.
 * Uses AuthStorage to go through file locking.
 *
 * @param pref — The preference to store.
 * @param authPath — Override auth.json path (for testing).
 */
export function setSearchProviderPreference(pref, authPath) {
    const auth = AuthStorage.create(authPath ?? authFilePath);
    auth.remove(PREFERENCE_KEY);
    auth.set(PREFERENCE_KEY, { type: 'api_key', key: pref });
}
/**
 * Resolve which search provider to use based on available API keys and user preference.
 *
 * Logic:
 * 1. If an explicit override is given, use it — but only if that provider's key exists.
 *    If the key doesn't exist, fall through to the other provider.
 * 2. Otherwise, read the stored preference.
 * 3. If preference is 'auto': prefer Tavily, then Brave.
 * 4. If preference is a specific provider: use it if key exists, else fall back to the other.
 * 5. Return null if neither key is available — explicit signal for "no provider".
 *
 * @param overridePreference — Optional override (e.g. from a tool parameter).
 */
export function resolveSearchProvider(overridePreference) {
    const tavilyKey = getTavilyApiKey();
    const braveKey = getBraveApiKey();
    const ollamaKey = getOllamaApiKey();
    const hasTavily = tavilyKey.length > 0;
    const hasBrave = braveKey.length > 0;
    const hasOllama = ollamaKey.length > 0;
    // Determine effective preference
    let pref;
    if (overridePreference && VALID_PREFERENCES.has(overridePreference)) {
        pref = overridePreference;
    }
    else {
        // preferences.md takes priority over auth.json
        const mdPref = resolveSearchProviderFromPreferences();
        if (mdPref && mdPref !== 'auto' && mdPref !== 'native') {
            pref = mdPref;
        }
        else if (overridePreference !== undefined && !VALID_PREFERENCES.has(overridePreference)) {
            pref = 'auto';
        }
        else {
            pref = getSearchProviderPreference();
        }
    }
    // Resolve based on preference
    if (pref === 'auto') {
        if (hasTavily)
            return 'tavily';
        if (hasBrave)
            return 'brave';
        if (hasOllama)
            return 'ollama';
        return null;
    }
    if (pref === 'tavily') {
        if (hasTavily)
            return 'tavily';
        if (hasBrave)
            return 'brave';
        if (hasOllama)
            return 'ollama';
        return null;
    }
    if (pref === 'brave') {
        if (hasBrave)
            return 'brave';
        if (hasTavily)
            return 'tavily';
        if (hasOllama)
            return 'ollama';
        return null;
    }
    if (pref === 'ollama') {
        if (hasOllama)
            return 'ollama';
        if (hasTavily)
            return 'tavily';
        if (hasBrave)
            return 'brave';
        return null;
    }
    return null;
}
