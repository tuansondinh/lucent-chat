#!/usr/bin/env node
'use strict'
/**
 * notarize.cjs — Post-build notarization for Lucent Code.
 * Runs automatically via electron-builder afterSign hook.
 */
const { execSync } = require('child_process')
const { join } = require('path')
const { existsSync } = require('fs')

function resolveNotaryProfile() {
  const candidates = ['lucent-code-notary', 'lucent-chat-notary']
  for (const profile of candidates) {
    try {
      execSync(`xcrun notarytool history --keychain-profile "${profile}"`, {
        stdio: 'ignore',
      })
      return profile
    } catch {}
  }
  throw new Error(
    '[notarize] No usable notarytool keychain profile found. Expected one of: lucent-code-notary, lucent-chat-notary.'
  )
}

module.exports = async function notarize({ appOutDir, packager }) {
  const platform = packager.platform.name
  if (platform !== 'mac') return
  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('[notarize] Skipping notarization (SKIP_NOTARIZE=true).')
    return
  }

  const appName = packager.appInfo.productFilename
  const appPath = join(appOutDir, `${appName}.app`)

  if (!existsSync(appPath)) {
    console.log(`[notarize] App not found at ${appPath}, skipping.`)
    return
  }

  // Create a zip for notarytool submission
  const zipPath = join(appOutDir, `${appName}-notarize.zip`)
  console.log(`[notarize] Zipping ${appPath}...`)
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`)

  const keychainProfile = resolveNotaryProfile()
  console.log('[notarize] Submitting to Apple notarization service...')
  execSync(
    `xcrun notarytool submit "${zipPath}" --keychain-profile "${keychainProfile}" --wait`,
    { stdio: 'inherit' }
  )

  console.log('[notarize] Stapling ticket to app...')
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' })

  // Clean up temp zip
  execSync(`rm -f "${zipPath}"`)
  console.log('[notarize] Done.')
}
