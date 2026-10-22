const MOCK_SERVICE_WORKER_PATH = '/mockServiceWorker.js'

export const enableMocking = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return
  }

  const { worker } = await import('@mocks/browser')

  await worker.start({
    onUnhandledRequest: (request, print) => {
      const pathname = new URL(request.url).pathname

      if (pathname.startsWith('/api/')) {
        print.error()
      }
    },
    serviceWorker: {
      url: MOCK_SERVICE_WORKER_PATH
    }
  })
}
