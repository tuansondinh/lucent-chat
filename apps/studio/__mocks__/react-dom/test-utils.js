/**
 * Manual mock for react-dom/test-utils.
 * Provides a working `act` shim for React 19 + @testing-library/react 16.
 * React 19 does not export `act` from the top-level react package,
 * so @testing-library/react falls back here and calls React.act — which fails.
 */
'use strict'

function act(callback) {
  const result = typeof callback === 'function' ? callback() : undefined
  if (result && typeof result.then === 'function') {
    return result
  }
  return Promise.resolve()
}

module.exports = { act }
