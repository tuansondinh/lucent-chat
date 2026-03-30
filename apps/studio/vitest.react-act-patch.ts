/**
 * Patch React 19's missing `act` export so that @testing-library/react can work.
 */

// @ts-ignore
import * as React from 'react'

// The module namespace object from ESM imports is sealed/frozen; we can't add
// properties to it directly. Instead, patch the `react-dom/test-utils` module
// to provide its own `act` without delegating to React.act.
//
// @testing-library/react resolves `reactAct` as:
//   typeof React.act === 'function' ? React.act : DeprecatedReactTestUtils.act
//
// Since React.act is undefined, it uses DeprecatedReactTestUtils.act — which
// internally calls `React.act(callback)` and crashes.
//
// The fix: replace DeprecatedReactTestUtils.act with a working shim.

import * as ReactDOMTestUtils from 'react-dom/test-utils'

if (typeof (React as any).act !== 'function' && typeof (ReactDOMTestUtils as any).act === 'function') {
  // Overwrite the act export on the module with a shim that doesn't call React.act
  const originalAct = (ReactDOMTestUtils as any).act
  try {
    Object.defineProperty(ReactDOMTestUtils, 'act', {
      configurable: true,
      writable: true,
      value: function act(callback: () => any) {
        const result = typeof callback === 'function' ? callback() : undefined
        if (result && typeof result.then === 'function') {
          return result
        }
        return Promise.resolve()
      },
    })
  } catch {
    // If module is frozen, nothing we can do from this side
  }
}
