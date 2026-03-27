/**
 * Lucent Chat — Service Worker
 *
 * Strategy: App Shell Cache (cache-first for static assets, network-first for API).
 *
 * Cache versioning: bump CACHE_VERSION when deploying to bust old caches.
 */

const CACHE_VERSION = 'v1'
const CACHE_NAME = `lucent-chat-${CACHE_VERSION}`

// App shell assets to precache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
]

// ---------------------------------------------------------------------------
// Install — precache the app shell
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL)
    }).then(() => {
      // Skip waiting so the new SW activates immediately
      return self.skipWaiting()
    })
  )
})

// ---------------------------------------------------------------------------
// Activate — clean up old caches
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim()
    })
  )
})

// ---------------------------------------------------------------------------
// Fetch — cache-first for static assets, passthrough for API
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Do not intercept cross-origin requests (bridge API, WS connections)
  if (url.origin !== self.location.origin) {
    return
  }

  // Passthrough for /api/* and /events (bridge server)
  if (url.pathname.startsWith('/api/') || url.pathname === '/events') {
    return
  }

  // Cache-first for everything else (app shell, static assets)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached

      return fetch(event.request).then((response) => {
        // Only cache successful GET responses
        if (
          event.request.method === 'GET' &&
          response.status === 200 &&
          response.type !== 'opaque'
        ) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone)
          })
        }
        return response
      }).catch(() => {
        // Offline fallback — return the cached index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html')
        }
        return new Response('Offline', { status: 503 })
      })
    })
  )
})
