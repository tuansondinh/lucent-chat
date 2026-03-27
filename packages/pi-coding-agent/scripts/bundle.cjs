#!/usr/bin/env node
'use strict'
/**
 * bundle.cjs — Builds a self-contained @gsd/pi-coding-agent bundle directory.
 *
 * The bundle/ directory is consumed by apps/studio's electron-builder
 * via a single extraResources entry: { from: "../../packages/runtime/bundle", to: "runtime" }.
 *
 * Bundle layout:
 *   bundle/entrypoint.js          — main entry (copy of root dist/loader.js)
 *   bundle/dist/                  — compiled runtime JS (from root dist/)
 *   bundle/packages/              — compiled workspace packages (agent-core, ai, tui, native)
 *   bundle/resources/             — extensions, themes, skills, agents
 *   bundle/pkg/                   — piConfig shim (name, configDir, theme assets)
 *   bundle/node_modules/          — production dependencies only
 *   bundle/node                   — standalone Node binary (current platform)
 *   bundle/package.json           — minimal bundle package.json
 */

const {
  mkdirSync,
  cpSync,
  copyFileSync,
  existsSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  chmodSync,
} = require('fs')
const { join, relative, dirname } = require('path')
const { execSync } = require('child_process')

// ─── Paths ───────────────────────────────────────────────────────────────────

const RUNTIME_DIR = join(__dirname, '..')           // packages/runtime/
const PROJECT_ROOT = join(RUNTIME_DIR, '..', '..') // repo root
const BUNDLE_DIR   = join(RUNTIME_DIR, 'bundle')   // packages/runtime/bundle/

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursive directory copy with optional filter.
 * Falls back to copyDirRecursive if cpSync fails (Windows non-ASCII paths).
 */
function safeCpSync(src, dest, options = {}) {
  if (!existsSync(src)) {
    console.warn(`  [bundle] skipping missing source: ${src}`)
    return
  }
  try {
    cpSync(src, dest, { recursive: true, ...options })
  } catch {
    if (options.recursive !== false) {
      copyDirRecursive(src, dest, options.filter)
    } else {
      copyFileSync(src, dest)
    }
  }
}

function copyDirRecursive(src, dest, filter) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (filter && !filter(srcPath, destPath)) continue
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, filter)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Write a JSON file pretty-printed.
 */
function writeJson(filePath, obj) {
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
}

// ─── Step 1: Clean and recreate bundle/ ──────────────────────────────────────

console.log('[bundle] Cleaning bundle directory...')
if (existsSync(BUNDLE_DIR)) {
  rmSync(BUNDLE_DIR, { recursive: true, force: true })
}
mkdirSync(BUNDLE_DIR, { recursive: true })

// ─── Step 2: Copy root dist/ → bundle/dist/ ──────────────────────────────────
// This contains: loader.js, cli.js, app-paths.js, headless.js, etc.

console.log('[bundle] Copying root dist/ → bundle/dist/ ...')
const rootDistDir = join(PROJECT_ROOT, 'dist')
if (!existsSync(rootDistDir)) {
  console.error('[bundle] ERROR: Root dist/ not found. Run `npm run build` first.')
  process.exit(1)
}
safeCpSync(rootDistDir, join(BUNDLE_DIR, 'dist'))

// ─── Step 3: Write bundle/dist/entrypoint.js ─────────────────────────────────
// We place entrypoint.js inside bundle/dist/ (alongside loader.js and cli.js)
// so that all relative imports (./cli.js, ./app-paths.js, etc.) resolve correctly.
//
// The only patch needed: gsdRoot computation.
//   Original:  const gsdRoot = resolve(dirname(import.meta.url), '..');
//   → When at dist/loader.js: goes up one level to project root (correct for loader.js)
//   → When at bundle/dist/entrypoint.js: goes up one level to bundle/ (also correct!)
//
// pkgDir: resolve(dirname(import.meta.url), '..', 'pkg')
//   → bundle/dist/../pkg = bundle/pkg ✓
//
// So actually no patches are needed — the path math works naturally when entrypoint.js
// lives at bundle/dist/ just like loader.js lives at dist/.
// We just copy loader.js as entrypoint.js inside bundle/dist/.

console.log('[bundle] Writing bundle/dist/entrypoint.js ...')
const loaderSrc = join(BUNDLE_DIR, 'dist', 'loader.js')
const entrypointInDist = join(BUNDLE_DIR, 'dist', 'entrypoint.js')
const entrypointDest = join(BUNDLE_DIR, 'entrypoint.js')

if (!existsSync(loaderSrc)) {
  console.error('[bundle] ERROR: dist/loader.js not found in copied dist. Build may be incomplete.')
  process.exit(1)
}

// Copy loader.js to bundle/dist/entrypoint.js (same directory = same relative imports)
copyFileSync(loaderSrc, entrypointInDist)

// Also write a thin redirector at bundle/entrypoint.js for ergonomics
// (so the process-manager and docs can reference bundle/entrypoint.js at the top level)
writeFileSync(
  entrypointDest,
  `#!/usr/bin/env node
// Lucent Chat Runtime — bundle entrypoint redirector
// This script delegates to dist/entrypoint.js (the actual compiled entry).
import('./dist/entrypoint.js')
`,
  'utf-8'
)

// ─── Step 4: Copy workspace package dist/ outputs → bundle/packages/ ─────────

console.log('[bundle] Copying workspace package dists → bundle/packages/ ...')
const wsPackages = [
  { dir: 'agent-core', name: 'agent-core' },
  { dir: 'ai', name: 'ai' },
  { dir: 'tui', name: 'tui' },
  { dir: 'native', name: 'native' },
  { dir: 'runtime', name: 'runtime' },
]

for (const { dir, name } of wsPackages) {
  const pkgSrc = join(PROJECT_ROOT, 'packages', dir)
  const pkgDest = join(BUNDLE_DIR, 'packages', name)
  if (!existsSync(pkgSrc)) {
    console.warn(`  [bundle] skipping missing package: ${dir}`)
    continue
  }
  mkdirSync(pkgDest, { recursive: true })
  // Copy dist/ and package.json
  safeCpSync(join(pkgSrc, 'dist'), join(pkgDest, 'dist'))
  if (existsSync(join(pkgSrc, 'package.json'))) {
    copyFileSync(join(pkgSrc, 'package.json'), join(pkgDest, 'package.json'))
  }
  console.log(`  → packages/${name}`)
}

// ─── Step 5: Copy resources/ → bundle/resources/ ─────────────────────────────
// Use root dist/resources/ (built copy) if available, else src/resources/.

console.log('[bundle] Copying resources/ → bundle/resources/ ...')
const distResources = join(rootDistDir, 'resources')
const srcResources  = join(PROJECT_ROOT, 'src', 'resources')
const resourcesSrc  = existsSync(distResources) ? distResources : srcResources

if (existsSync(resourcesSrc)) {
  safeCpSync(resourcesSrc, join(BUNDLE_DIR, 'resources'))
} else {
  console.warn('[bundle] WARNING: No resources directory found (dist/resources or src/resources)')
  mkdirSync(join(BUNDLE_DIR, 'resources'), { recursive: true })
}

// ─── Step 6: Copy pkg/ → bundle/pkg/ ─────────────────────────────────────────

console.log('[bundle] Copying pkg/ → bundle/pkg/ ...')
const pkgSrc = join(PROJECT_ROOT, 'pkg')
if (existsSync(pkgSrc)) {
  safeCpSync(pkgSrc, join(BUNDLE_DIR, 'pkg'))
} else {
  console.warn('[bundle] WARNING: No pkg/ directory found at project root')
  mkdirSync(join(BUNDLE_DIR, 'pkg'), { recursive: true })
}

// ─── Step 7: Write minimal bundle/package.json ───────────────────────────────

console.log('[bundle] Writing bundle/package.json ...')
// Read root package version
let rootVersion = '0.0.0'
try {
  const rootPkg = require(join(PROJECT_ROOT, 'package.json'))
  rootVersion = rootPkg.version || '0.0.0'
} catch { /* ignore */ }

writeJson(join(BUNDLE_DIR, 'package.json'), {
  name: '@gsd/pi-coding-agent-bundle',
  version: rootVersion,
  description: 'Self-contained @gsd/pi-coding-agent bundle for Lucent Chat Studio',
  type: 'module',
  main: './entrypoint.js',
})

// ─── Step 8: Install / copy production node_modules ──────────────────────────
// Strategy: use npm pack + install into a temp dir to get a clean production tree.
// We install the root package and all workspace deps from a temp dir.
//
// Simpler approach: copy root node_modules, excluding dev-only packages.
// The exclusion list mirrors what Studio's electron-builder currently filters.

console.log('[bundle] Copying production node_modules ...')

const DEV_ONLY_DIRS = new Set([
  '.bin',
  '.cache',
  '.package-lock.json',
  '.modules.yaml',
  // Electron / builder toolchain — not needed at runtime
  '@electron',
  'app-builder-bin',
  'app-builder-lib',
  'builder-util',
  'builder-util-runtime',
  'dmg-builder',
  'electron',
  'electron-builder',
  'electron-osx-sign',
  'electron-publish',
  'electron-rebuild',
  'electron-vite',
  'vite',
  'vitest',
  '@vitest',
  // TypeScript dev deps
  'typescript',
  '@types',
  // Test tooling
  'jsdom',
  'happy-dom',
  'c8',
  // Studio-specific UI deps (not needed by runtime)
  '@radix-ui',
  '@phosphor-icons',
  '@xterm',
  'cmdk',
  'lucide-react',
  'node-pty',
  'react',
  'react-dom',
  'react-markdown',
  'react-resizable-panels',
  'remark-gfm',
  'shiki',
  'sonner',
  'zustand',
  'tailwindcss',
  // Workspace packages — these are in bundle/packages/ instead
  '@lc',
])

const rootNodeModules = join(PROJECT_ROOT, 'node_modules')
const bundleNodeModules = join(BUNDLE_DIR, 'node_modules')
mkdirSync(bundleNodeModules, { recursive: true })

const topLevelEntries = readdirSync(rootNodeModules, { withFileTypes: true })
let copiedCount = 0

for (const entry of topLevelEntries) {
  if (DEV_ONLY_DIRS.has(entry.name)) continue

  const src = join(rootNodeModules, entry.name)
  const dest = join(bundleNodeModules, entry.name)

  if (entry.name.startsWith('@')) {
    // Scoped package directory — filter entries within it
    if (!existsSync(src)) continue
    mkdirSync(dest, { recursive: true })
    const scopedEntries = readdirSync(src, { withFileTypes: true })
    for (const scopedEntry of scopedEntries) {
      const scopedSrc = join(src, scopedEntry.name)
      const scopedDest = join(dest, scopedEntry.name)
      safeCpSync(scopedSrc, scopedDest)
      copiedCount++
    }
  } else {
    safeCpSync(src, dest)
    copiedCount++
  }
}

console.log(`  → copied ${copiedCount} node_modules entries`)

// ─── Step 9: Link workspace packages into bundle/node_modules/@lc/ ──────────
// This makes @lc/* imports in entrypoint.js resolve correctly at runtime.

console.log('[bundle] Linking workspace packages into bundle/node_modules/@lc/ ...')
const bundleLcScope = join(bundleNodeModules, '@lc')
mkdirSync(bundleLcScope, { recursive: true })

for (const { name } of wsPackages) {
  const pkgSrc  = join(BUNDLE_DIR, 'packages', name)
  const pkgDest = join(bundleLcScope, name)
  if (existsSync(pkgSrc)) {
    safeCpSync(pkgSrc, pkgDest)
    console.log(`  → @lc/${name}`)
  }
}

// ─── Step 10: Copy Node binary ────────────────────────────────────────────────
// Use the currently-running Node binary (same version/arch as build machine).
// This ensures arm64 macOS gets an arm64 binary without downloading.

console.log('[bundle] Copying Node binary ...')
const nodeSrc  = process.execPath
const nodeDest = join(BUNDLE_DIR, 'node')

copyFileSync(nodeSrc, nodeDest)
// Ensure executable bit is set
chmodSync(nodeDest, 0o755)
console.log(`  → node binary from ${nodeSrc}`)

// ─── Done ─────────────────────────────────────────────────────────────────────

console.log('[bundle] Bundle complete.')
console.log(`  Output: ${BUNDLE_DIR}`)
console.log(`  Node:   ${nodeDest}`)
console.log(`  Entry:  ${entrypointDest}`)
