const MOCK_SERVICE_WORKER_PATH = '/mockServiceWorker.js'

export const enableMocking = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return
  }

  const [{ worker }, { mockPassageAudioEntries }, { registerPassageAudio }] =
    await Promise.all([
      import('@mocks/browser'),
      import('@mocks/data/passageAudio'),
      import('@app/practice/session/passageAudio/passageAudioSource')
    ])
  // #1183: until the learner API sends audio keys, the mock tells the app.
  for (const [passage, key] of mockPassageAudioEntries())
    registerPassageAudio(passage, key)

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
