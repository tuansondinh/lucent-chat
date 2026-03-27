/**
 * ESM loader hook — remaps .js imports to .ts when the .js file doesn't
 * exist but a .ts counterpart does.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js') && (specifier.startsWith('./') || specifier.startsWith('../'))) {
    const parentURL = context.parentURL
    if (parentURL) {
      const tsSpecifier = specifier.slice(0, -3) + '.ts'
      const tsUrl = new URL(tsSpecifier, parentURL)
      try {
        const tsPath = fileURLToPath(tsUrl)
        if (existsSync(tsPath)) {
          return nextResolve(tsSpecifier, context)
        }
      } catch {
        // Not a file URL, fall through
      }
    }
  }
  return nextResolve(specifier, context)
}
