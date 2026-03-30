/**
 * Global setup for vitest — runs in Node.js before any test files are loaded.
 * Patches React 19's missing `act` export so that @testing-library/react 16 works.
 */
import { createRequire } from 'module'

export function setup() {
  const require = createRequire(import.meta.url)
  
  // React 19.2.x does not export `act` from the top-level react package.
  // @testing-library/react 16 checks `React.act` and falls back to
  // `react-dom/test-utils.act` which then calls `React.act` — circular crash.
  // Inject a working `act` shim directly into the require cache.
  const reactModule = require('react')
  if (typeof reactModule.act !== 'function') {
    reactModule.act = function act(callback: () => any) {
      const result = typeof callback === 'function' ? callback() : undefined
      if (result && typeof result.then === 'function') {
        return result
      }
      return Promise.resolve()
    }
  }
}
