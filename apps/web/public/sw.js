// #1045: the service worker that lets the site be added to the home screen
// and, later, receive the daily push (#1046). It has no fetch handler on
// purpose: pages, files and API calls always go to the network, so nothing is
// cached offline and a new release shows on the next load.
/* global self */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
