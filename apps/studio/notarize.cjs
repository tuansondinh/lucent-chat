#!/usr/bin/env node
'use strict'
/**
 * notarize.cjs — Post-build notarization for Lucent Chat.
 * Runs automatically via electron-builder afterSign hook.
 */
const { execSync } = require('child_process')
const { join } = require('path')
const { existsSync } = require('fs')

module.exports = async function notarize({ appOutDir, packager }) {
  const platform = packager.platform.name
  if (platform !== 'mac') return

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

  console.log('[notarize] Submitting to Apple notarization service...')
  execSync(
    `xcrun notarytool submit "${zipPath}" --keychain-profile "lucent-chat-notary" --wait`,
    { stdio: 'inherit' }
  )

  console.log('[notarize] Stapling ticket to app...')
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' })

  // Clean up temp zip
  execSync(`rm -f "${zipPath}"`)
  console.log('[notarize] Done.')
}
