/**
 * languageMap — maps file extensions to CodeMirror language support.
 *
 * IMPORTANT: The extension-to-language mapping is shared between FileViewer
 * (Shiki read-only highlighting) and CodeEditor (CodeMirror editable mode) to
 * prevent drift. The `extensionToLanguage` function in FileViewer still handles
 * the Shiki language names. This module maps the same extensions to CM6
 * LanguageSupport objects.
 *
 * Only the languages that have a CodeMirror 6 language pack are mapped here.
 * Unknown extensions return null (no syntax highlighting in edit mode).
 */

import type { LanguageSupport } from '@codemirror/language'

// Lazy-loaded language support — imports are deferred until first use.
// This keeps the initial bundle small.

async function loadJS(): Promise<LanguageSupport> {
  const { javascript } = await import('@codemirror/lang-javascript')
  return javascript({ jsx: false, typescript: false })
}

async function loadTS(): Promise<LanguageSupport> {
  const { javascript } = await import('@codemirror/lang-javascript')
  return javascript({ jsx: false, typescript: true })
}

async function loadJSX(): Promise<LanguageSupport> {
  const { javascript } = await import('@codemirror/lang-javascript')
  return javascript({ jsx: true, typescript: false })
}

async function loadTSX(): Promise<LanguageSupport> {
  const { javascript } = await import('@codemirror/lang-javascript')
  return javascript({ jsx: true, typescript: true })
}

async function loadPython(): Promise<LanguageSupport> {
  const { python } = await import('@codemirror/lang-python')
  return python()
}

async function loadJSON(): Promise<LanguageSupport> {
  const { json } = await import('@codemirror/lang-json')
  return json()
}

async function loadHTML(): Promise<LanguageSupport> {
  const { html } = await import('@codemirror/lang-html')
  return html()
}

async function loadCSS(): Promise<LanguageSupport> {
  const { css } = await import('@codemirror/lang-css')
  return css()
}

async function loadMarkdown(): Promise<LanguageSupport> {
  const { markdown } = await import('@codemirror/lang-markdown')
  return markdown()
}

async function loadRust(): Promise<LanguageSupport> {
  const { rust } = await import('@codemirror/lang-rust')
  return rust()
}

async function loadCpp(): Promise<LanguageSupport> {
  const { cpp } = await import('@codemirror/lang-cpp')
  return cpp()
}

async function loadJava(): Promise<LanguageSupport> {
  const { java } = await import('@codemirror/lang-java')
  return java()
}

async function loadSQL(): Promise<LanguageSupport> {
  const { sql } = await import('@codemirror/lang-sql')
  return sql()
}

type LanguageLoader = () => Promise<LanguageSupport>

/**
 * Maps a file path (by extension) to a lazy loader for the corresponding
 * CodeMirror LanguageSupport instance, or null for unknown/unsupported types.
 *
 * The extension set matches the `extensionToLanguage` mapping in FileViewer.tsx
 * to prevent the two from drifting.
 */
export function getLanguageLoader(path: string): LanguageLoader | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, LanguageLoader> = {
    // JavaScript / TypeScript
    js: loadJS,
    mjs: loadJS,
    cjs: loadJS,
    jsx: loadJSX,
    ts: loadTS,
    tsx: loadTSX,
    // Python
    py: loadPython,
    // Data / config
    json: loadJSON,
    jsonc: loadJSON,
    // Web
    html: loadHTML,
    htm: loadHTML,
    css: loadCSS,
    scss: loadCSS,
    // Docs
    md: loadMarkdown,
    mdx: loadMarkdown,
    // Systems
    rs: loadRust,
    c: loadCpp,
    h: loadCpp,
    cc: loadCpp,
    cpp: loadCpp,
    hpp: loadCpp,
    java: loadJava,
    // Database
    sql: loadSQL,
  }
  return map[ext] ?? null
}
