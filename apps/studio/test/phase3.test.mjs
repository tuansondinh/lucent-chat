/**
 * Phase 3 tests — PWA + Mobile + Tailscale
 *
 * Tests:
 *  - bridge adapter exports getBridge and WebBridge
 *  - WebBridgeServer file exists with required exports
 *  - TailscaleService file exists with required exports
 *  - PWA vite config exists
 *  - manifest.webmanifest exists with required fields
 *  - service worker file exists
 *  - Mobile CSS exists with media queries
 *  - Settings has remoteAccess fields
 *  - preload sets window.__ELECTRON__ = true
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = new URL('..', import.meta.url).pathname

// Helper to read a file relative to studio/
async function read(rel) {
  return readFile(base + rel, 'utf8')
}

// ---- Bridge adapter ----

test('bridge.ts exports getBridge function', async () => {
  const src = await read('src/renderer/src/lib/bridge.ts')
  assert.match(src, /export function getBridge/)
  assert.match(src, /window\.__ELECTRON__/)
  assert.match(src, /window\.bridge/)
  assert.match(src, /WebBridge/)
})

test('web-bridge.ts exports WebBridge class implementing Bridge interface', async () => {
  const src = await read('src/renderer/src/lib/web-bridge.ts')
  assert.match(src, /export class WebBridge/)
  assert.match(src, /prompt\(/)
  assert.match(src, /getSettings\(/)
  assert.match(src, /onAgentChunk\(/)
})

// ---- Preload sets __ELECTRON__ ----

test('preload sets window.__ELECTRON__ = true', async () => {
  const src = await read('src/preload/index.ts')
  // Accepts either direct assignment or contextBridge.exposeInMainWorld('__ELECTRON__', true)
  const hasDirectAssign = /window\.__ELECTRON__\s*=\s*true/.test(src)
  const hasContextBridge = /__ELECTRON__.*true/.test(src)
  assert.ok(hasDirectAssign || hasContextBridge, 'preload must set __ELECTRON__ to true')
})

// ---- WebBridgeServer ----

test('web-bridge-server.ts exports WebBridgeServer class', async () => {
  const src = await read('src/main/web-bridge-server.ts')
  assert.match(src, /export class WebBridgeServer/)
  assert.match(src, /start\(/)
  assert.match(src, /stop\(/)
  // Must have bearer token auth
  assert.match(src, /Authorization/)
  // Must have capability scoping — no terminal or fs write ops for remote
  assert.match(src, /terminal/)
  assert.match(src, /CORS|cors|origin/i)
})

// ---- TailscaleService ----

test('tailscale-service.ts exports TailscaleService class', async () => {
  const src = await read('src/main/tailscale-service.ts')
  assert.match(src, /export class TailscaleService/)
  assert.match(src, /enableServe\(/)
  assert.match(src, /getServeStatus\(/)
  assert.match(src, /tailscale/)
})

// ---- PWA vite config ----

test('vite.pwa.config.ts exists', async () => {
  const src = await read('vite.pwa.config.ts')
  assert.match(src, /pwa/)
  assert.match(src, /dist\/pwa/)
})

// ---- manifest.webmanifest ----

test('manifest.webmanifest has required PWA fields', async () => {
  const raw = await read('src/renderer/public/manifest.webmanifest')
  const manifest = JSON.parse(raw)
  assert.equal(manifest.name, 'Lucent Chat')
  assert.ok(manifest.icons?.length >= 2, 'must have at least 2 icons')
  const sizes = manifest.icons.map(i => i.sizes)
  assert.ok(sizes.some(s => s.includes('192')), 'must have 192x192 icon')
  assert.ok(sizes.some(s => s.includes('512')), 'must have 512x512 icon')
  assert.equal(manifest.display, 'standalone')
  assert.ok(manifest.theme_color, 'must have theme_color')
})

// ---- Service worker ----

test('sw.js service worker exists and handles install/fetch', async () => {
  const src = await read('src/renderer/public/sw.js')
  assert.match(src, /install/)
  assert.match(src, /fetch/)
  assert.match(src, /cache/i)
})

// ---- Mobile CSS ----

test('renderer CSS has mobile media query for bottom nav at <768px', async () => {
  const src = await read('src/renderer/src/styles/index.css')
  // At least one mobile breakpoint or bottom-nav style
  assert.match(src, /@media[^{]*768/)
})

// ---- Settings has remote access fields ----

test('settings-service.ts has remoteAccess fields', async () => {
  const src = await read('src/main/settings-service.ts')
  assert.match(src, /remoteAccessEnabled/)
  assert.match(src, /remoteAccessPort/)
  assert.match(src, /remoteAccessToken/)
})

// ---- Settings UI has Remote Access section ----

test('Settings.tsx has Remote Access tab or section', async () => {
  const src = await read('src/renderer/src/components/Settings.tsx')
  assert.match(src, /[Rr]emote.?[Aa]ccess|remote-access|remoteAccess/)
})
