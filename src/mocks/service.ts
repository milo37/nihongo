const shouldEnableMocks = (): boolean =>
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === 'true'

export const enableMocking = async (): Promise<void> => {
  if (!shouldEnableMocks() || typeof window === 'undefined') {
    return
  }

  const { worker } = await import('@mocks/browser')

  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: {
      url: '/mockServiceWorker.js'
    }
  })
}
