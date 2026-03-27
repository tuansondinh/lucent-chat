#!/usr/bin/env node
'use strict'
/**
 * Tests for bundle.cjs — validates the bundle script logic.
 * Uses node:test (no compile step needed).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } = require('fs')
const { join } = require('path')
const { execSync } = require('child_process')
const os = require('os')

const RUNTIME_DIR = join(__dirname, '..')
const BUNDLE_DIR = join(RUNTIME_DIR, 'bundle')
const BUNDLE_SCRIPT = join(__dirname, 'bundle.cjs')

// Test 1: bundle.cjs script exists
test('bundle.cjs script exists', () => {
  assert.ok(existsSync(BUNDLE_SCRIPT), `Expected bundle.cjs at ${BUNDLE_SCRIPT}`)
})

// Test 2: validate-bundle.cjs script exists
test('validate-bundle.cjs script exists', () => {
  const validateScript = join(__dirname, 'validate-bundle.cjs')
  assert.ok(existsSync(validateScript), `Expected validate-bundle.cjs at ${validateScript}`)
})

// Test 3: bundle directory structure — after bundle script runs, expected files exist
test('bundle/ directory contains dist/entrypoint.js after bundle runs', () => {
  if (!existsSync(BUNDLE_DIR)) {
    // Bundle hasn't been run yet — this is expected in a fresh clone
    // The test verifies the structure when bundle IS present
    console.log('Bundle dir not present — skipping structure check (run npm run bundle first)')
    return
  }
  const entrypoint = join(BUNDLE_DIR, 'dist', 'entrypoint.js')
  assert.ok(existsSync(entrypoint), `Expected dist/entrypoint.js in bundle dir`)
})

// Test 4: bundle directory contains node binary (if bundle exists)
test('bundle/ directory contains node binary after bundle runs', () => {
  if (!existsSync(BUNDLE_DIR)) {
    console.log('Bundle dir not present — skipping structure check (run npm run bundle first)')
    return
  }
  const nodeBin = join(BUNDLE_DIR, 'node')
  assert.ok(existsSync(nodeBin), `Expected node binary in bundle dir`)
})

// Test 5: bundle directory contains dist/ folder (if bundle exists)
test('bundle/ directory contains dist/ after bundle runs', () => {
  if (!existsSync(BUNDLE_DIR)) {
    console.log('Bundle dir not present — skipping structure check (run npm run bundle first)')
    return
  }
  const distDir = join(BUNDLE_DIR, 'dist')
  assert.ok(existsSync(distDir), `Expected dist/ in bundle dir`)
})

// Test 6: bundle directory contains resources/ folder (if bundle exists)
test('bundle/ directory contains resources/ after bundle runs', () => {
  if (!existsSync(BUNDLE_DIR)) {
    console.log('Bundle dir not present — skipping structure check (run npm run bundle first)')
    return
  }
  const resourcesDir = join(BUNDLE_DIR, 'resources')
  assert.ok(existsSync(resourcesDir), `Expected resources/ in bundle dir`)
})

// Test 7: bundle directory contains pkg/ folder (if bundle exists)
test('bundle/ directory contains pkg/ after bundle runs', () => {
  if (!existsSync(BUNDLE_DIR)) {
    console.log('Bundle dir not present — skipping structure check (run npm run bundle first)')
    return
  }
  const pkgDir = join(BUNDLE_DIR, 'pkg')
  assert.ok(existsSync(pkgDir), `Expected pkg/ in bundle dir`)
})

// Test 8: node binary is executable (if bundle exists)
test('bundle/node is executable', () => {
  if (!existsSync(BUNDLE_DIR)) {
    console.log('Bundle dir not present — skipping executable check')
    return
  }
  const nodeBin = join(BUNDLE_DIR, 'node')
  if (!existsSync(nodeBin)) {
    console.log('Bundle node binary not present — skipping executable check')
    return
  }
  // Check execute bit
  const { statSync } = require('fs')
  const stat = statSync(nodeBin)
  const isExecutable = (stat.mode & 0o100) !== 0
  assert.ok(isExecutable, 'bundle/node should be executable')
})

// Test 9: bundle/dist/entrypoint.js can be launched with bundle/node --version (if bundle exists)
test('bundle/node bundle/dist/entrypoint.js --version exits 0', () => {
  if (!existsSync(BUNDLE_DIR)) {
    console.log('Bundle dir not present — skipping standalone launch test')
    return
  }
  const nodeBin = join(BUNDLE_DIR, 'node')
  const entrypoint = join(BUNDLE_DIR, 'dist', 'entrypoint.js')
  if (!existsSync(nodeBin) || !existsSync(entrypoint)) {
    console.log('Bundle incomplete — skipping standalone launch test')
    return
  }
  try {
    const result = execSync(`"${nodeBin}" "${entrypoint}" --version`, {
      timeout: 10000,
      encoding: 'utf-8',
    })
    // Should print a version string
    assert.ok(result.trim().length > 0, 'Expected version output')
  } catch (err) {
    assert.fail(`bundle/node bundle/dist/entrypoint.js --version failed: ${err.message}`)
  }
})
