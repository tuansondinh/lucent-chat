#!/usr/bin/env node
'use strict'
/**
 * release.cjs — One-command release script for Lucent Code.
 *
 * Usage:
 *   npm run release:arm64               # build unsigned arm64 zip → GitHub release
 *   npm run release:arm64 -- --dry-run  # skip GitHub release upload
 *   npm run release:arm64 -- --notarize # sign + notarize with Apple
 *
 * Prerequisites (one-time setup):
 *   - `gh` CLI authenticated
 *   - For --notarize: Developer ID Application cert installed in keychain
 *   - For --notarize: xcrun notarytool store-credentials "lucent-code-notary"
 */

const { execSync } = require('child_process')
const { existsSync, readFileSync, rmSync } = require('fs')
const { join } = require('path')

const STUDIO_DIR  = join(__dirname, '..')
const RELEASE_DIR = join(STUDIO_DIR, 'release')
const REPO        = 'tuansondinh/lucent-code'

const args      = process.argv.slice(2)
const DRY_RUN   = args.includes('--dry-run')
const NOTARIZE  = args.includes('--notarize')
const WITHOUT_AUDIO = args.includes('--without-audio')
const pkg     = JSON.parse(readFileSync(join(STUDIO_DIR, 'package.json'), 'utf-8'))
const version = pkg.version
const appName = 'Lucent Code'
const appPath = join(RELEASE_DIR, 'mac-arm64', `${appName}.app`)
const zipPath = join(RELEASE_DIR, `${appName}-${version}-arm64-mac.zip`)

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: STUDIO_DIR, ...opts })
}

// ─── Step 1: Build ────────────────────────────────────────────────────────────
console.log(`\n[release] Building ${appName} v${version} (arm64)...`)
run('npm run build')
run(WITHOUT_AUDIO ? 'npm run bundle-audio-service:none' : 'npm run bundle-audio-service')
run('npm run bundle-runtime')
rmSync(appPath, { recursive: true, force: true })
const builderEnv = NOTARIZE
  ? 'CSC_IDENTITY_AUTO_DISCOVERY=true'
  : 'SKIP_NOTARIZE=true CSC_IDENTITY_AUTO_DISCOVERY=false'
const builderArgs = NOTARIZE ? '-m --arm64' : '-m --arm64 --config.mac.identity=null'
run(`${builderEnv} npx electron-builder ${builderArgs}`)

if (!existsSync(appPath)) {
  console.error(`[release] ERROR: App not found at ${appPath}`)
  process.exit(1)
}

// ─── Step 3: Notarize (optional) ──────────────────────────────────────────────
if (NOTARIZE) {
  console.log('\n[release] Notarized build requested; electron-builder handled signing and afterSign notarization.')
} else {
  console.log('\n[release] Unsigned build requested; signing and notarization skipped.')
}

// ─── Step 4: ZIP artifact ─────────────────────────────────────────────────────
if (!existsSync(zipPath)) {
  console.error(`[release] ERROR: ZIP not found at ${zipPath}`)
  process.exit(1)
}
console.log(`\n[release] ZIP: ${zipPath}`)

// ─── Step 5: GitHub Release ───────────────────────────────────────────────────
if (DRY_RUN) {
  console.log('\n[release] --dry-run: skipping GitHub release.')
  process.exit(0)
}

console.log(`\n[release] Creating GitHub release v${version}...`)

// Tag
try {
  run(`git tag v${version}`)
  run(`git push origin v${version}`)
} catch {
  console.warn(`[release] Tag v${version} already exists, continuing...`)
}

const installNotes = NOTARIZE
  ? `macOS arm64 (Apple Silicon).

### Install
1. Unzip the ZIP file
2. Move **${appName}.app** to /Applications`
  : `macOS arm64 (Apple Silicon).

### Install
1. Unzip the ZIP file
2. Move **${appName}.app** to /Applications
3. First launch: right-click → Open (or System Settings → Privacy & Security → Open Anyway)

This build is unsigned and not notarized.${WITHOUT_AUDIO ? '\n\nVoice features are not included in this build.' : ''}`

run(`gh release create v${version} "${zipPath}" \
  --repo ${REPO} \
  --title "${appName} v${version}" \
  --notes ${JSON.stringify(installNotes)}`)

console.log(`\n[release] Done! https://github.com/${REPO}/releases/tag/v${version}`)
