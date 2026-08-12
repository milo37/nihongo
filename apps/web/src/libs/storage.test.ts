import { act } from '@testing-library/react'
import { demoUsers } from '@mocks/data/users'
import {
  APP_STORE_KEY,
  cachedSessionStorage,
  cachedStorage,
  clearStorageCache,
  createSplitAppStateStorage,
  PRACTICE_STORE_KEY,
  subscribeStorageChanges
} from '@libs/storage'
import { useAppStore } from '@store/index'

interface MemoryStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => boolean
  removeItem: (key: string) => void
}

const createMemoryStorage = (): MemoryStorage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
      return true
    },
    removeItem: (key) => values.delete(key)
  }
}

const createEnvelope = (
  sessionId: string,
  currentUser = demoUsers[0]
): string =>
  JSON.stringify({
    version: 2,
    state: {
      currentUser,
      sessionId,
      currentQuestionIndex: 1,
      selectedAnswers: { question: sessionId + '-answer' },
      startedAt: '2026-08-12T00:00:00.000Z',
      pendingBookmarkIds: {}
    }
  })

describe('storage adapters', () => {
  it('backing storage를 한 번 읽고 cache hit, set, remove를 일관되게 처리한다', () => {
    const key = 'storage-cache-test'
    window.localStorage.setItem(key, 'first')
    clearStorageCache()
    const getItem = vi.spyOn(Storage.prototype, 'getItem')

    expect(cachedStorage.getItem(key)).toBe('first')
    expect(cachedStorage.getItem(key)).toBe('first')
    expect(
      getItem.mock.calls.filter(([requestedKey]) => requestedKey === key)
    ).toHaveLength(1)

    cachedStorage.setItem(key, 'second')
    expect(window.localStorage.getItem(key)).toBe('second')
    expect(cachedStorage.getItem(key)).toBe('second')

    cachedStorage.removeItem(key)
    expect(window.localStorage.getItem(key)).toBeNull()
    expect(cachedStorage.getItem(key)).toBeNull()
  })

  it('외부 storage event가 cache를 무효화하고 unsubscribe 후 알림을 멈춘다', () => {
    const key = 'storage-event-test'
    const listener = vi.fn()
    const unsubscribe = subscribeStorageChanges(listener)
    window.localStorage.setItem(key, 'before')
    clearStorageCache()
    expect(cachedStorage.getItem(key)).toBe('before')

    window.localStorage.setItem(key, 'after')
    expect(cachedStorage.getItem(key)).toBe('before')

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          newValue: 'after',
          oldValue: 'before'
        })
      )
    })
    expect(cachedStorage.getItem(key)).toBe('after')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(listener).toHaveBeenCalledTimes(1)
    cachedStorage.removeItem(key)
  })

  it('auth는 공유하면서 서로 다른 tab session storage의 practice를 격리한다', () => {
    const sharedAuth = createMemoryStorage()
    const tabAStorage = createMemoryStorage()
    const tabBStorage = createMemoryStorage()
    const tabA = createSplitAppStateStorage(sharedAuth, tabAStorage)
    const tabB = createSplitAppStateStorage(sharedAuth, tabBStorage)

    tabA.setItem(APP_STORE_KEY, createEnvelope('session-a'))
    tabB.setItem(APP_STORE_KEY, createEnvelope('session-b'))

    const tabAReloaded = createSplitAppStateStorage(sharedAuth, tabAStorage)
    const tabAState = JSON.parse(
      tabAReloaded.getItem(APP_STORE_KEY) ?? '{}'
    ) as { state?: { sessionId?: string; currentUser?: { id?: string } } }
    const tabBState = JSON.parse(tabB.getItem(APP_STORE_KEY) ?? '{}') as {
      state?: { sessionId?: string; currentUser?: { id?: string } }
    }

    expect(tabAState.state?.sessionId).toBe('session-a')
    expect(tabBState.state?.sessionId).toBe('session-b')
    expect(tabAState.state?.currentUser?.id).toBe('demo-user')
    expect(tabBState.state?.currentUser?.id).toBe('demo-user')
  })

  it('v1 persist에서는 auth만 이전하고 tab 귀속이 없는 practice를 폐기한다', async () => {
    const user = demoUsers[0]
    expect(user).toBeDefined()
    cachedStorage.setItem(
      APP_STORE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          currentUser: user,
          sessionId: 'legacy-session',
          currentQuestionIndex: 4,
          selectedAnswers: { legacy: 'answer' },
          startedAt: '2026-08-12T00:00:00.000Z',
          pendingBookmarkIds: {}
        }
      })
    )
    cachedSessionStorage.removeItem(PRACTICE_STORE_KEY)
    clearStorageCache()

    await useAppStore.persist.rehydrate()

    expect(useAppStore.getState().currentUser?.id).toBe('demo-user')
    expect(useAppStore.getState().sessionId).toBeNull()
    expect(useAppStore.getState().selectedAnswers).toEqual({})
  })

  it('v2 auth가 없거나 손상되면 남아 있는 practice도 안전하게 폐기한다', () => {
    const authStorage = createMemoryStorage()
    const practiceStorage = createMemoryStorage()
    const splitStorage = createSplitAppStateStorage(
      authStorage,
      practiceStorage
    )
    practiceStorage.setItem(
      PRACTICE_STORE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          sessionId: 'orphan-session',
          currentQuestionIndex: 2,
          selectedAnswers: { question: 'answer' },
          startedAt: '2026-08-12T00:00:00.000Z',
          pendingBookmarkIds: {}
        }
      })
    )

    expect(splitStorage.getItem(APP_STORE_KEY)).toBeNull()
    expect(practiceStorage.getItem(PRACTICE_STORE_KEY)).toBeNull()

    authStorage.setItem(APP_STORE_KEY, '{broken')
    practiceStorage.setItem(
      PRACTICE_STORE_KEY,
      createEnvelope('orphan-session')
    )
    expect(splitStorage.getItem(APP_STORE_KEY)).toBeNull()
    expect(practiceStorage.getItem(PRACTICE_STORE_KEY)).toBeNull()

    for (const invalidCurrentUser of [
      'broken-user',
      { id: 'incomplete-user' },
      {
        ...demoUsers[0],
        role: 'SUPER_ADMIN'
      }
    ]) {
      authStorage.setItem(
        APP_STORE_KEY,
        JSON.stringify({
          version: 2,
          state: { currentUser: invalidCurrentUser }
        })
      )
      practiceStorage.setItem(
        PRACTICE_STORE_KEY,
        createEnvelope('orphan-session')
      )

      expect(splitStorage.getItem(APP_STORE_KEY)).toBeNull()
      expect(practiceStorage.getItem(PRACTICE_STORE_KEY)).toBeNull()
    }
  })

  it('손상 JSON과 storage 쓰기 실패를 cache의 성공 값으로 오인하지 않는다', () => {
    cachedStorage.setItem(APP_STORE_KEY, '{broken')
    clearStorageCache()
    const isolated = createSplitAppStateStorage(
      cachedStorage,
      cachedSessionStorage
    )
    expect(isolated.getItem(APP_STORE_KEY)).toBeNull()

    const key = 'storage-write-failure'
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      })

    expect(() => cachedStorage.setItem(key, 'not-persisted')).not.toThrow()
    expect(cachedStorage.getItem(key)).toBeNull()
    setItem.mockRestore()
    cachedStorage.removeItem(key)
  })
})
