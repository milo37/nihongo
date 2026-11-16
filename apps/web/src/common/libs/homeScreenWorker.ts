// #1045: add to home screen. The service worker has no fetch handler (see
// public/sw.js), so registering it caches nothing. Only production builds
// register it: dev and test builds run the mock API worker at the same scope.
export const registerHomeScreenWorker = (): void => {
  if (!__NIHONGO_PRODUCTION_BUILD__ || !('serviceWorker' in navigator)) return
  // A failed registration only loses home screen install; the page still works.
  navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch(() => undefined)
}
