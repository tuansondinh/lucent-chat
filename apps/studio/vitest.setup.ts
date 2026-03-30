import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// React 19.2.x does not export `act` from the top-level react package, but
// @testing-library/react 16 falls back to react-dom/test-utils.act which then
// calls React.act — crashing. Patch it here before any test renders.
//
// We access the module via the window.__vitest_mocker__ escape hatch or by
// directly mutating the module object (which works when vitest processes it as CJS).
import * as React from 'react'
const ReactAny = React as any
if (typeof ReactAny.act !== 'function') {
  // In vitest's happy-dom environment, ESM namespace objects are writable.
  try {
    ReactAny.act = function act(callback: () => any) {
      const result = typeof callback === 'function' ? callback() : undefined
      if (result && typeof result.then === 'function') {
        return result
      }
      return Promise.resolve()
    }
  } catch {
    // If the namespace is frozen (strict ESM), we can't patch it here.
  }
}

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Cleanup after each test
afterEach(() => {
  cleanup()
})
