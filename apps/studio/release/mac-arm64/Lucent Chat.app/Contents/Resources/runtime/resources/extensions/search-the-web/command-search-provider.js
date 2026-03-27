/**
 * /search-provider slash command.
 *
 * Lets users switch between tavily, brave, and auto search backends.
 * Supports direct arg (`/search-provider tavily`) or interactive select UI.
 * Tab completion provides the three valid options with key status.
 *
 * All provider logic lives in provider.ts (S01) — this is pure UI wiring.
 */
import { getTavilyApiKey, getBraveApiKey, getOllamaApiKey, getSearchProviderPreference, setSearchProviderPreference, resolveSearchProvider, } from './provider.js';
const VALID_PREFERENCES = ['tavily', 'brave', 'ollama', 'auto'];
function keyStatus(provider) {
    if (provider === 'tavily')
        return getTavilyApiKey() ? '✓' : '✗';
    if (provider === 'ollama')
        return getOllamaApiKey() ? '✓' : '✗';
    return getBraveApiKey() ? '✓' : '✗';
}
function buildSelectOptions() {
    return [
        `tavily (key: ${keyStatus('tavily')})`,
        `brave (key: ${keyStatus('brave')})`,
        `ollama (key: ${keyStatus('ollama')})`,
        `auto`,
    ];
}
function parseSelectChoice(choice) {
    if (choice.startsWith('tavily'))
        return 'tavily';
    if (choice.startsWith('brave'))
        return 'brave';
    if (choice.startsWith('ollama'))
        return 'ollama';
    return 'auto';
}
export function registerSearchProviderCommand(pi) {
    pi.registerCommand('search-provider', {
        description: 'Switch search provider (tavily, brave, ollama, auto)',
        getArgumentCompletions(prefix) {
            const trimmed = prefix.trim().toLowerCase();
            return VALID_PREFERENCES
                .filter((p) => p.startsWith(trimmed))
                .map((p) => {
                let description;
                if (p === 'auto') {
                    description = `Auto-select (tavily: ${keyStatus('tavily')}, brave: ${keyStatus('brave')}, ollama: ${keyStatus('ollama')})`;
                }
                else {
                    description = `key: ${keyStatus(p)}`;
                }
                return { value: p, label: p, description };
            });
        },
        async handler(args, ctx) {
            const trimmed = args.trim().toLowerCase();
            let chosen;
            if (trimmed && VALID_PREFERENCES.includes(trimmed)) {
                // Direct arg — apply immediately, no select UI
                chosen = trimmed;
            }
            else {
                // No arg or invalid arg — show interactive select
                const current = getSearchProviderPreference();
                const options = buildSelectOptions();
                const result = await ctx.ui.select(`Search provider (current: ${current})`, options);
                if (result === undefined) {
                    // User cancelled — bail silently
                    return;
                }
                chosen = parseSelectChoice(Array.isArray(result) ? result[0] : result);
            }
            setSearchProviderPreference(chosen);
            const effective = resolveSearchProvider();
            const isAnthropic = ctx.model?.provider === 'anthropic';
            const nativeNote = isAnthropic ? '\nNote: Native Anthropic web search is also active (automatic, no API key needed).' : '';
            ctx.ui.notify(`Search provider set to ${chosen}. Effective provider: ${effective ?? 'none (no API keys)'}${nativeNote}`, 'info');
        },
    });
}
