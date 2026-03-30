/**
 * Mock for react-dom/test-utils that provides a working `act` shim
 * for React 19 compatibility in tests.
 *
 * React 19 removed `act` from the top-level react package exports, but
 * @testing-library/react 16 falls back to react-dom/test-utils.act which
 * then calls React.act — which doesn't exist in this build.
 */

export function act(callback: () => any): any {
  const result = typeof callback === 'function' ? callback() : undefined
  if (result && typeof result.then === 'function') {
    return result
  }
  return Promise.resolve()
}
