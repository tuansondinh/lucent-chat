import type { HighlighterCore } from 'shiki/core'

let highlighter: HighlighterCore | null = null
let highlighterPromise: Promise<HighlighterCore> | null = null

/**
 * Returns a singleton Shiki highlighter using the pure-JS regex engine (no WASM).
 * This is required because the default oniguruma engine uses WebAssembly, which is
 * blocked by the app's Content-Security-Policy (missing wasm-unsafe-eval).
 */
export async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter
  if (highlighterPromise) return highlighterPromise

  highlighterPromise = Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ]).then(async ([core, jsEngine]) => {
    const hl = await core.createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-dark-default'),
      ],
      langs: [
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/tsx'),
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/jsx'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/rust'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/java'),
        import('@shikijs/langs/c'),
        import('@shikijs/langs/cpp'),
        import('@shikijs/langs/shell'),
        import('@shikijs/langs/bash'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/jsonc'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/toml'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/scss'),
        import('@shikijs/langs/markdown'),
        import('@shikijs/langs/diff'),
        import('@shikijs/langs/dockerfile'),
        import('@shikijs/langs/graphql'),
        import('@shikijs/langs/xml'),
        import('@shikijs/langs/swift'),
        import('@shikijs/langs/kotlin'),
        import('@shikijs/langs/ruby'),
        import('@shikijs/langs/php'),
      ],
      engine: jsEngine.createJavaScriptRegexEngine(),
    })
    highlighter = hl
    return hl
  })

  return highlighterPromise
}
