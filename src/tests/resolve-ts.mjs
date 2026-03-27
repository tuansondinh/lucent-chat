/**
 * Node.js ESM register hook — remaps .js imports to .ts when the .js file
 * doesn't exist but a .ts counterpart does. Required because TypeScript's
 * NodeNext module resolution convention uses .js extensions in import paths,
 * but node --experimental-strip-types does not do this remapping natively.
 *
 * Usage: node --import ./src/tests/resolve-ts.mjs --experimental-strip-types ...
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(new URL('./resolve-ts-hooks.mjs', import.meta.url))
