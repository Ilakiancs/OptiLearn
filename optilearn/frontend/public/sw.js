const CACHE_NAME = 'optilearn-v2'
const isLocalhost = ['localhost', '127.0.0.1'].includes(self.location.hostname)

async function clearOptiLearnCaches() {
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter(key => key.startsWith('optilearn-'))
      .map(key => caches.delete(key))
  )
}

self.addEventListener('install', event => {
  event.waitUntil(isLocalhost ? clearOptiLearnCaches() : caches.open(CACHE_NAME))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      await clearOptiLearnCaches()

      if (isLocalhost) {
        await self.registration.unregister()
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of clients) {
          client.navigate(client.url)
        }
        return
      }

      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', event => {
  if (isLocalhost) {
    return
  }

  // Only handle GET requests; skip API calls (always go to network)
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return
  }

  const request = event.request
  const accept = request.headers.get('accept') || ''
  const isNavigation = request.mode === 'navigate' || accept.includes('text/html')

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    )
    return
  }

  event.respondWith(
    fetch(request).then(response => {
      if (!response || response.status !== 200 || response.type === 'opaque') {
        return response
      }
      const clone = response.clone()
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
      return response
    }).catch(() => caches.match(request))
  )
})
