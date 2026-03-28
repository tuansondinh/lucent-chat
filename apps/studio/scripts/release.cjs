#!/usr/bin/env node
'use strict'
/**
 * release.cjs — One-command release script for Lucent Chat.
 *
 * Usage:
 *   npm run release:arm64              # build → sign → zip → GitHub release
 *   npm run release:arm64 -- --dry-run # skip GitHub release upload
 *   npm run release:arm64 -- --notarize # also notarize with Apple (adds ~5 min)
 *
 * Prerequisites (one-time setup):
 *   - Developer ID Application cert installed in keychain
 *   - `gh` CLI authenticated
 *   - For --notarize: xcrun notarytool store-credentials "lucent-chat-notary"
 */

const { execSync } = require('child_process')
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

const STUDIO_DIR  = join(__dirname, '..')
const RELEASE_DIR = join(STUDIO_DIR, 'release')
const IDENTITY    = 'B13085D091A12F7B4F11805BFE9E52C8FEDF730B'
const REPO        = 'tuansondinh/lucent-chat'

const args      = process.argv.slice(2)
const DRY_RUN   = args.includes('--dry-run')
const NOTARIZE  = args.includes('--notarize')

const pkg     = JSON.parse(readFileSync(join(STUDIO_DIR, 'package.json'), 'utf-8'))
const version = pkg.version
const appName = 'Lucent Chat'
const appPath = join(RELEASE_DIR, 'mac-arm64', `${appName}.app`)
const zipPath = join(RELEASE_DIR, `${appName}-${version}-arm64-mac.zip`)

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: STUDIO_DIR, ...opts })
}

// ─── Step 1: Build ────────────────────────────────────────────────────────────
console.log(`\n[release] Building Lucent Chat v${version} (arm64)...`)
run('npm run build')
run('npm run bundle-runtime')
run(`CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder -m --arm64`)

// ─── Step 2: Sign ─────────────────────────────────────────────────────────────
console.log('\n[release] Signing app...')
if (!existsSync(appPath)) {
  console.error(`[release] ERROR: App not found at ${appPath}`)
  process.exit(1)
}
run(`codesign --sign "${IDENTITY}" --deep --force \
  --entitlements "${join(STUDIO_DIR, 'entitlements.mac.plist')}" \
  "${appPath}"`)
run(`codesign --verify --verbose=1 "${appPath}"`)

// ─── Step 3: Notarize (optional) ──────────────────────────────────────────────
if (NOTARIZE) {
  console.log('\n[release] Notarizing with Apple (this takes 2–5 min)...')
  const notarizeZip = join(RELEASE_DIR, 'mac-arm64', `${appName}-notarize.zip`)
  run(`ditto -c -k --keepParent "${appPath}" "${notarizeZip}"`)
  run(`xcrun notarytool submit "${notarizeZip}" --keychain-profile "lucent-chat-notary" --wait`)
  run(`xcrun stapler staple "${appPath}"`)
  run(`rm -f "${notarizeZip}"`)
}

// ─── Step 4: Zip ──────────────────────────────────────────────────────────────
console.log('\n[release] Creating ZIP...')
run(`cd "${join(RELEASE_DIR, 'mac-arm64')}" && zip -r --symlinks "${zipPath}" "${appName}.app"`)
console.log(`[release] ZIP: ${zipPath}`)

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

const notes = `macOS arm64 (Apple Silicon).

### Install
1. Unzip the ZIP file
2. Move **${appName}.app** to /Applications
3. First launch: right-click → Open (or System Settings → Privacy & Security → Open Anyway)`

run(`gh release create v${version} "${zipPath}" \
  --repo ${REPO} \
  --title "${appName} v${version}" \
  --notes ${JSON.stringify(notes)}`)

console.log(`\n[release] Done! https://github.com/${REPO}/releases/tag/v${version}`)
