const shouldEnableMocks = (): boolean => {
  const explicitSetting = import.meta.env.VITE_ENABLE_MOCKS

  if (explicitSetting === 'false') {
    return false
  }

  return import.meta.env.DEV || explicitSetting === 'true'
}

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
