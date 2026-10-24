const MOCK_SERVICE_WORKER_PATH = '/mockServiceWorker.js'

export const isMockServiceWorkerRegistration = (
  registration: ServiceWorkerRegistration,
  baseUrl = window.location.href
): boolean => {
  const workers = [
    registration.installing,
    registration.waiting,
    registration.active
  ]

  return workers.some((serviceWorker) => {
    if (!serviceWorker) {
      return false
    }

    const scriptUrl = new URL(serviceWorker.scriptURL, baseUrl)
    const currentOrigin = new URL(baseUrl).origin

    return (
      scriptUrl.origin === currentOrigin &&
      scriptUrl.pathname === MOCK_SERVICE_WORKER_PATH
    )
  })
}

export const unregisterMockServiceWorker = async (): Promise<void> => {
  if (typeof window === 'undefined' || !('serviceWorker' in window.navigator)) {
    return
  }

  const registrations = await window.navigator.serviceWorker.getRegistrations()
  const mockRegistrations = registrations.filter((registration) =>
    isMockServiceWorkerRegistration(registration)
  )

  await Promise.all(
    mockRegistrations.map(async (registration) => registration.unregister())
  )
}
