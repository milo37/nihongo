import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isMockServiceWorkerRegistration,
  unregisterMockServiceWorker
} from '@api/mockServiceWorker'

const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  'serviceWorker'
)

afterEach(() => {
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(
      window.navigator,
      'serviceWorker',
      originalServiceWorkerDescriptor
    )
  } else {
    Reflect.deleteProperty(window.navigator, 'serviceWorker')
  }
})

const createRegistration = (scriptUrl: string): ServiceWorkerRegistration => {
  return {
    active: { scriptURL: scriptUrl },
    installing: null,
    waiting: null,
    unregister: vi.fn()
  } as unknown as ServiceWorkerRegistration
}

describe('isMockServiceWorkerRegistration', () => {
  it('matches only the exact same-origin mockServiceWorker script path', () => {
    expect(
      isMockServiceWorkerRegistration(
        createRegistration('http://localhost/mockServiceWorker.js'),
        'http://localhost/practice'
      )
    ).toBe(true)
    expect(
      isMockServiceWorkerRegistration(
        createRegistration('http://localhost/assets/mockServiceWorker.js'),
        'http://localhost/practice'
      )
    ).toBe(false)
    expect(
      isMockServiceWorkerRegistration(
        createRegistration('http://localhost/mockServiceWorker.js.backup'),
        'http://localhost/practice'
      )
    ).toBe(false)
    expect(
      isMockServiceWorkerRegistration(
        createRegistration('https://example.com/mockServiceWorker.js'),
        'http://localhost/practice'
      )
    ).toBe(false)
  })

  it('checks installing and waiting workers without matching unrelated service workers', () => {
    const registration = {
      active: { scriptURL: 'http://localhost/app-worker.js' },
      installing: null,
      waiting: { scriptURL: 'http://localhost/mockServiceWorker.js' }
    } as unknown as ServiceWorkerRegistration

    expect(
      isMockServiceWorkerRegistration(registration, 'http://localhost/')
    ).toBe(true)
  })

  it('unregisters the exact mock worker without touching other registrations', async () => {
    const mockRegistration = createRegistration(
      `${window.location.origin}/mockServiceWorker.js`
    )
    const appRegistration = createRegistration(
      `${window.location.origin}/app-worker.js`
    )
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: vi
          .fn()
          .mockResolvedValue([mockRegistration, appRegistration])
      }
    })

    await unregisterMockServiceWorker()

    expect(mockRegistration.unregister).toHaveBeenCalledOnce()
    expect(appRegistration.unregister).not.toHaveBeenCalled()
  })
})
