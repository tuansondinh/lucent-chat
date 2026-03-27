import type { Highlighter } from 'shiki'

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null

/**
 * Returns a singleton Shiki highlighter, loading it lazily on first call.
 * Subsequent calls return the same promise/instance.
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter
  if (highlighterPromise) return highlighterPromise

  highlighterPromise = import('shiki').then(async (mod) => {
    const hl = await mod.createHighlighter({
      themes: ['github-dark-default'],
      langs: [
        'typescript', 'tsx', 'javascript', 'jsx',
        'python', 'rust', 'go', 'java',
        'c', 'cpp', 'shell', 'bash', 'json', 'jsonc',
        'yaml', 'toml', 'sql', 'html', 'css', 'scss',
        'markdown', 'diff', 'dockerfile',
        'graphql', 'xml', 'swift', 'kotlin', 'ruby', 'php',
      ],
    })
    highlighter = hl
    return hl
  })

  return highlighterPromise
}
