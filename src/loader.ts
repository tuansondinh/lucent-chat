#!/usr/bin/env node
// GSD Startup Loader
// Copyright (c) 2026 Jeremy McSpadden <jeremy@fluxlabs.net>
import { fileURLToPath } from 'url'
import { dirname, resolve, join, relative, delimiter } from 'path'
import { existsSync, readFileSync } from 'fs'

// Fast-path: handle --version/-v and --help/-h before importing any heavy
// dependencies. This avoids loading the entire pi-coding-agent barrel import
// (~1s) just to print a version string.
const gsdRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const firstArg = args[0]

// Read package.json once — reused for version, banner, and GSD_VERSION below
let gsdVersion = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(gsdRoot, 'package.json'), 'utf-8'))
  gsdVersion = pkg.version || '0.0.0'
} catch { /* ignore */ }

if (firstArg === '--version' || firstArg === '-v') {
  process.stdout.write(gsdVersion + '\n')
  process.exit(0)
}

if (firstArg === '--help' || firstArg === '-h') {
  const { printHelp } = await import('./help-text.js')
  printHelp(gsdVersion)
  process.exit(0)
}

import { agentDir, appRoot } from './app-paths.js'
import { serializeBundledExtensionPaths } from './bundled-extension-paths.js'
import { discoverExtensionEntryPaths } from './extension-discovery.js'
import { loadRegistry, readManifestFromEntryPath, isExtensionEnabled } from './extension-registry.js'
import { renderLogo } from './logo.js'

// pkg/ is a shim directory: contains gsd's piConfig (package.json) and pi's
// theme assets (dist/modes/interactive/theme/) without a src/ directory.
// This allows config.js to:
//   1. Read piConfig.name → "gsd" (branding)
//   2. Resolve themes via dist/ (no src/ present → uses dist path)
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pkg')

// MUST be set before any dynamic import of pi SDK fires — this is what config.js
// reads to determine APP_NAME and CONFIG_DIR_NAME
process.env.PI_PACKAGE_DIR = pkgDir
process.env.PI_SKIP_VERSION_CHECK = '1'  // GSD runs its own update check in cli.ts — suppress pi's
process.title = 'voice-bridge-desktop'

// Print branded banner on first launch (before ~/.gsd/ exists)
if (!existsSync(appRoot)) {
  const cyan  = '\x1b[36m'
  const green = '\x1b[32m'
  const dim   = '\x1b[2m'
  const reset = '\x1b[0m'
  const colorCyan = (s: string) => `${cyan}${s}${reset}`
  process.stderr.write(
    renderLogo(colorCyan) +
    '\n' +
    `  Get Shit Done ${dim}v${gsdVersion}${reset}\n` +
    `  ${green}Welcome.${reset} Setting up your environment...\n\n`
  )
}

// GSD_CODING_AGENT_DIR — tells pi's getAgentDir() to return ~/.gsd/agent/ instead of ~/.gsd/agent/
process.env.GSD_CODING_AGENT_DIR = agentDir

// NODE_PATH — make gsd's own node_modules available to extensions loaded via jiti.
// Without this, extensions (e.g. browser-tools) can't resolve dependencies like
// `playwright` because jiti resolves modules from pi-coding-agent's location, not gsd's.
// Prepending gsd's node_modules to NODE_PATH fixes this for all extensions.
const gsdNodeModules = join(gsdRoot, 'node_modules')
process.env.NODE_PATH = [gsdNodeModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(delimiter)
// Force Node to re-evaluate module search paths with the updated NODE_PATH.
// Must happen synchronously before cli.js imports → extension loading.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Module } = await import('module');
(Module as any)._initPaths?.()

// GSD_VERSION — expose package version so extensions can display it
process.env.GSD_VERSION = gsdVersion

// GSD_BIN_PATH — absolute path to this loader (dist/loader.js), used by patched subagent
// to spawn gsd instead of pi when dispatching workflow tasks
process.env.GSD_BIN_PATH = process.argv[1]

// Resolve resources directory — prefers dist/resources/ (stable, set at build time)
// over src/resources/ (live working tree) — see resource-loader.ts for rationale.
const distRes = join(gsdRoot, 'dist', 'resources')
const srcRes = join(gsdRoot, 'src', 'resources')
const resourcesDir = existsSync(distRes) ? distRes : srcRes

// GSD_BUNDLED_EXTENSION_PATHS — dynamically discovered bundled extension entry points.
// Uses the shared discoverExtensionEntryPaths() to scan the bundled resources
// directory, then remaps discovered paths to agentDir (~/.gsd/agent/extensions/)
// where initResources() will sync them.
const bundledExtDir = join(resourcesDir, 'extensions')
const agentExtDir = join(agentDir, 'extensions')
const registry = loadRegistry()
const discoveredExtensionPaths = discoverExtensionEntryPaths(bundledExtDir)
  .map((entryPath) => join(agentExtDir, relative(bundledExtDir, entryPath)))
  .filter((entryPath) => {
    const manifest = readManifestFromEntryPath(entryPath)
    if (!manifest) return true  // no manifest = always load
    return isExtensionEnabled(registry, manifest.id)
  })

process.env.GSD_BUNDLED_EXTENSION_PATHS = serializeBundledExtensionPaths(discoveredExtensionPaths)

// Respect HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars for all outbound requests.
// pi-coding-agent's cli.ts sets this, but GSD bypasses that entry point — so we
// must set it here before any SDK clients are created.
// Lazy-load undici (~200ms) only when proxy env vars are actually set.
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
}

// npm workspaces automatically links @lc/* packages during `npm install` from the tarball.
// The runtime bundle is self-contained, and workspace linking is no longer needed at runtime.
// Previously this block created symlinks/copies for node_modules/@lc/*, but npm handles this now.

// Dynamic import defers ESM evaluation — config.js will see PI_PACKAGE_DIR above
await import('./cli.js')
