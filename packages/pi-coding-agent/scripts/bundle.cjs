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
  lstatSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  chmodSync,
  realpathSync,
  statSync,
} = require('fs')
const { join, relative, dirname, resolve } = require('path')
const { execSync } = require('child_process')
const { createHash } = require('crypto')

function removeNestedBinDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.bin') {
        rmSync(entryPath, { recursive: true, force: true })
        continue
      }
      removeNestedBinDirs(entryPath)
    }
  }
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const RUNTIME_DIR = join(__dirname, '..')
const PROJECT_ROOT = join(RUNTIME_DIR, '..', '..')

function parseBundleOutDir() {
  const outArgIndex = process.argv.indexOf('--out-dir')
  if (outArgIndex !== -1) {
    const candidate = process.argv[outArgIndex + 1]
    if (!candidate) {
      console.error('[bundle] ERROR: --out-dir requires a value.')
      process.exit(1)
    }
    return resolve(PROJECT_ROOT, candidate)
  }

  if (process.env.LUCENT_RUNTIME_BUNDLE_DIR) {
    return resolve(PROJECT_ROOT, process.env.LUCENT_RUNTIME_BUNDLE_DIR)
  }

  return join(RUNTIME_DIR, 'bundle')
}

const BUNDLE_DIR = parseBundleOutDir()

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
      copyDirRecursive(src, dest, options.filter, options)
    } else {
      copyFileSync(src, dest)
    }
  }
}

function copyDirRecursive(src, dest, filter, options = {}) {
  const srcPath = options.dereference ? realpathSync(src) : src
  const srcStat = lstatSync(src)

  if (srcStat.isSymbolicLink() && !options.dereference) {
    copyFileSync(src, dest)
    return
  }

  if (!statSync(srcPath).isDirectory()) {
    copyFileSync(srcPath, dest)
    return
  }

  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(srcPath, { withFileTypes: true })) {
    const childSrcPath = join(srcPath, entry.name)
    const destPath = join(dest, entry.name)
    if (filter && !filter(childSrcPath, destPath)) continue
    if (entry.isDirectory()) {
      copyDirRecursive(childSrcPath, destPath, filter, options)
    } else if (entry.isSymbolicLink() && options.dereference) {
      copyDirRecursive(realpathSync(childSrcPath), destPath, filter, options)
    } else {
      copyFileSync(childSrcPath, destPath)
    }
  }
}

/**
 * Write a JSON file pretty-printed.
 */
function writeJson(filePath, obj) {
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
}

// ─── Incremental check ───────────────────────────────────────────────────────
// Hash the inputs that affect bundle output. If the hash matches the stored
// .bundle-hash, skip the full wipe+copy — saves 2–5 min on repeat builds.
//
// Inputs hashed:
//   1. pnpm-lock.yaml / package-lock.json  — detects dep changes
//   2. root dist/ newest mtime             — detects compiled-output changes
//   3. this script's own mtime             — forces rebuild when bundle logic changes

function computeBundleHash() {
  const h = createHash('sha256')

  // 1. Lock file content
  for (const lockName of ['pnpm-lock.yaml', 'package-lock.json']) {
    const lockPath = join(RUNTIME_DIR, lockName)
    if (existsSync(lockPath)) {
      h.update(readFileSync(lockPath))
      break
    }
  }

  // 2. Newest mtime in root dist/ (fast — no recursion needed)
  const distDir = join(PROJECT_ROOT, 'dist')
  if (existsSync(distDir)) {
    let newest = 0
    function scanMtime(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { scanMtime(p) }
        else {
          const mt = statSync(p).mtimeMs
          if (mt > newest) newest = mt
        }
      }
    }
    scanMtime(distDir)
    h.update(String(newest))
  }

  // 3. This script's mtime
  h.update(String(statSync(__filename).mtimeMs))

  return h.digest('hex')
}

const HASH_FILE = join(BUNDLE_DIR, '.bundle-hash')
const FORCE     = process.argv.includes('--force')

if (!FORCE && existsSync(BUNDLE_DIR) && existsSync(HASH_FILE)) {
  const stored  = readFileSync(HASH_FILE, 'utf-8').trim()
  const current = computeBundleHash()
  if (stored === current) {
    console.log('[bundle] Bundle is up-to-date (inputs unchanged). Use --force to rebuild.')
    process.exit(0)
  }
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
  { dir: 'pi-agent-core', name: 'pi-agent-core' },
  { dir: 'pi-ai', name: 'pi-ai' },
  { dir: 'pi-tui', name: 'pi-tui' },
  { dir: 'native', name: 'native' },
  { dir: 'pi-coding-agent', name: 'pi-coding-agent' },
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
  '@gsd',
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
  // Build/transpile tools — compile-time only, never needed at runtime
  'tsx',           // TypeScript runner (agent is pre-compiled)
  '7zip-bin',      // electron-builder dependency, not a runtime dep
  'workbox-build', // PWA service-worker build tool
  'playwright-core', // test framework
  'esbuild',       // bundler
  '@esbuild',      // platform-specific esbuild binaries
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
      safeCpSync(scopedSrc, scopedDest, { dereference: true })
      copiedCount++
    }
  } else {
    safeCpSync(src, dest, { dereference: true })
    copiedCount++
  }
}

console.log(`  → copied ${copiedCount} node_modules entries`)

// ─── Step 9: Post-copy size optimizations ────────────────────────────────────
// Strip bloat that inflates the bundle without providing runtime value.

// 9a: Strip koffi cross-platform prebuilds (keep only mac; universal builds need
//     both darwin_arm64 and darwin_x64, everything else is dead weight).
const koffiBuildDir = join(bundleNodeModules, 'koffi', 'build', 'koffi')
if (existsSync(koffiBuildDir)) {
  const KEEP_KOFFI_PLATFORMS = new Set(['darwin_arm64', 'darwin_x64'])
  let koffiStripped = 0
  for (const entry of readdirSync(koffiBuildDir, { withFileTypes: true })) {
    if (!KEEP_KOFFI_PLATFORMS.has(entry.name)) {
      rmSync(join(koffiBuildDir, entry.name), { recursive: true, force: true })
      koffiStripped++
    }
  }
  console.log(`  [size] koffi: stripped ${koffiStripped} non-mac platform prebuilds`)

  // Strip koffi source, vendor, and docs — binaries are all that's needed at runtime
  for (const stripDir of ['src', 'vendor', 'doc']) {
    const p = join(bundleNodeModules, 'koffi', stripDir)
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true })
      console.log(`  [size] koffi: stripped ${stripDir}/`)
    }
  }
}

// 9b: Strip sql.js dist variants — keep only the Node WASM build.
//     The package ships 15 files (asm, browser, debug, worker variants);
//     Node runtime only uses sql-wasm.js + sql-wasm.wasm.
const sqlJsDistDir = join(bundleNodeModules, 'sql.js', 'dist')
if (existsSync(sqlJsDistDir)) {
  const KEEP_SQLJS = new Set(['sql-wasm.js', 'sql-wasm.wasm', 'worker.sql-wasm.js'])
  let sqlStripped = 0
  for (const entry of readdirSync(sqlJsDistDir, { withFileTypes: true })) {
    if (!KEEP_SQLJS.has(entry.name)) {
      rmSync(join(sqlJsDistDir, entry.name), { force: true })
      sqlStripped++
    }
  }
  console.log(`  [size] sql.js: stripped ${sqlStripped} unused dist variants`)
}

// 9c: Strip nested node_modules/.bin directories. These are build-time shims and
// are commonly absolute symlinks back into the workspace, which breaks app signing.
removeNestedBinDirs(bundleNodeModules)
console.log('  [size] stripped nested node_modules/.bin directories')

// ─── Step 11: Materialize workspace packages into bundle/node_modules ────────
// This avoids preserving workspace symlinks that point back out of the app
// bundle, which breaks macOS code signing verification.

console.log('[bundle] Materializing workspace packages into bundle/node_modules/@lc/ and @gsd/ ...')
const bundleLcScope = join(bundleNodeModules, '@lc')
const bundleGsdScope = join(bundleNodeModules, '@gsd')
mkdirSync(bundleLcScope, { recursive: true })
mkdirSync(bundleGsdScope, { recursive: true })

for (const { name } of wsPackages) {
  const pkgSrc  = join(BUNDLE_DIR, 'packages', name)
  if (existsSync(pkgSrc)) {
    safeCpSync(pkgSrc, join(bundleLcScope, name))
    safeCpSync(pkgSrc, join(bundleGsdScope, name))
    console.log(`  → @lc/${name}`)
    console.log(`  → @gsd/${name}`)
  }
}

// ─── Step 12: Copy Node binary ───────────────────────────────────────────────
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

// Write hash so the next run can skip if inputs haven't changed
writeFileSync(HASH_FILE, computeBundleHash(), 'utf-8')

console.log('[bundle] Bundle complete.')
console.log(`  Output: ${BUNDLE_DIR}`)
console.log(`  Node:   ${nodeDest}`)
console.log(`  Entry:  ${entrypointDest}`)
