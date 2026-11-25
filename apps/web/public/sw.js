// #1045: the service worker that lets the site be added to the home screen
// and, later, receive the daily push (#1046). It has no fetch handler on
// purpose: pages, files and API calls always go to the network, so nothing is
// cached offline and a new release shows on the next load.
/* global self, URL */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// #1046: the daily goal push. The server sends { kind, title?, body, url };
// without a title the app name heads it.
self.addEventListener('push', (event) => {
  let message = null
  try {
    message = event.data ? event.data.json() : null
  } catch {
    message = null
  }
  if (!message || typeof message.body !== 'string') return
  event.waitUntil(
    self.registration.showNotification(
      typeof message.title === 'string' ? message.title : '하루마루',
      {
        body: message.body,
        icon: '/icons/icon-192.png',
        data: { url: typeof message.url === 'string' ? message.url : '/' }
      }
    )
  )
})

// Tapping it opens the page in this site's window if one is open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin)
  if (url.origin !== self.location.origin) return
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((client) => 'navigate' in client)
        if (open)
          return open.navigate(url.href).then((client) => client?.focus())
        return self.clients.openWindow(url.href)
      })
  )
})
