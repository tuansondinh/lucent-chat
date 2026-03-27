#!/usr/bin/env node
'use strict'
/**
 * validate-bundle.cjs — Validates that the @gsd/pi-coding-agent bundle is complete.
 *
 * Checks:
 *   - bundle/entrypoint.js exists
 *   - bundle/dist/ exists and contains loader.js
 *   - bundle/resources/ exists
 *   - bundle/pkg/ exists
 *   - bundle/node exists and is executable
 *   - bundle/node_modules/ exists
 *   - Required production deps are present
 *   - Workspace packages are present in bundle/packages/
 */

const { existsSync, statSync } = require('fs')
const { join } = require('path')

const RUNTIME_DIR = join(__dirname, '..')
const BUNDLE_DIR = join(RUNTIME_DIR, 'bundle')

let errors = 0
let checks = 0

function check(label, condition, hint = '') {
  checks++
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ ${label}${hint ? `\n      Hint: ${hint}` : ''}`)
    errors++
  }
}

function isExecutable(filePath) {
  try {
    const stat = statSync(filePath)
    return (stat.mode & 0o100) !== 0
  } catch {
    return false
  }
}

console.log('[validate-bundle] Validating @gsd/pi-coding-agent bundle...')
console.log(`  Bundle dir: ${BUNDLE_DIR}`)
console.log()

// 1. Bundle directory exists
check('bundle/ directory exists', existsSync(BUNDLE_DIR), 'Run: npm run bundle -w @gsd/pi-coding-agent')

if (!existsSync(BUNDLE_DIR)) {
  console.error('\n[validate-bundle] FAILED — bundle directory missing, cannot continue.')
  process.exit(1)
}

// 2. Core files
check(
  'bundle/entrypoint.js exists (top-level redirector)',
  existsSync(join(BUNDLE_DIR, 'entrypoint.js')),
  'bundle.cjs should write a thin top-level entrypoint.js redirector'
)

check(
  'bundle/dist/entrypoint.js exists (compiled entry)',
  existsSync(join(BUNDLE_DIR, 'dist', 'entrypoint.js')),
  'bundle.cjs should copy dist/loader.js to bundle/dist/entrypoint.js'
)

check(
  'bundle/dist/loader.js exists',
  existsSync(join(BUNDLE_DIR, 'dist', 'loader.js')),
  'bundle.cjs copies root dist/ → bundle/dist/'
)

check(
  'bundle/dist/cli.js exists',
  existsSync(join(BUNDLE_DIR, 'dist', 'cli.js')),
  'cli.js should be in root dist/ after build'
)

// 3. Resources
check(
  'bundle/resources/ exists',
  existsSync(join(BUNDLE_DIR, 'resources')),
  'bundle.cjs copies src/resources or dist/resources'
)

// 4. Config shim
check(
  'bundle/pkg/ exists',
  existsSync(join(BUNDLE_DIR, 'pkg')),
  'bundle.cjs copies root pkg/ into bundle/'
)

check(
  'bundle/pkg/package.json exists',
  existsSync(join(BUNDLE_DIR, 'pkg', 'package.json')),
  'pkg/package.json is the piConfig shim'
)

// 5. Node binary
check(
  'bundle/node exists',
  existsSync(join(BUNDLE_DIR, 'node')),
  'bundle.cjs copies process.execPath into bundle/node'
)

check(
  'bundle/node is executable',
  isExecutable(join(BUNDLE_DIR, 'node')),
  'chmod 0o755 was not applied to bundle/node'
)

// 6. node_modules
check(
  'bundle/node_modules/ exists',
  existsSync(join(BUNDLE_DIR, 'node_modules')),
  'bundle.cjs copies root node_modules (filtered)'
)

// 7. Required production deps
const REQUIRED_DEPS = [
  'chalk',
  'yaml',
  'undici',
  'glob',
  'ignore',
  'minimatch',
]

for (const dep of REQUIRED_DEPS) {
  check(
    `bundle/node_modules/${dep} exists`,
    existsSync(join(BUNDLE_DIR, 'node_modules', dep)),
    `Production dependency ${dep} is missing from bundle`
  )
}

// 8. Workspace packages
const REQUIRED_PACKAGES = ['agent-core', 'ai', 'tui', 'runtime']
for (const pkg of REQUIRED_PACKAGES) {
  check(
    `bundle/packages/${pkg} exists`,
    existsSync(join(BUNDLE_DIR, 'packages', pkg)),
    `Workspace package @lc/${pkg} dist output is missing`
  )

  check(
    `bundle/node_modules/@lc/${pkg} exists`,
    existsSync(join(BUNDLE_DIR, 'node_modules', '@lc', pkg)),
    `@lc/${pkg} is not linked into bundle/node_modules`
  )
}

// 9. bundle/package.json
check(
  'bundle/package.json exists',
  existsSync(join(BUNDLE_DIR, 'package.json')),
  'bundle.cjs should write a minimal package.json'
)

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log()
if (errors === 0) {
  console.log(`[validate-bundle] All ${checks} checks passed.`)
  process.exit(0)
} else {
  console.error(`[validate-bundle] FAILED — ${errors}/${checks} checks failed.`)
  process.exit(1)
}
