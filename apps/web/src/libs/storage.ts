import type { StateStorage } from 'zustand/middleware'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import { LEVELS } from '@common/types/domain'

export const APP_STORE_KEY = 'jlpt-drill-note-store'
export const PRACTICE_STORE_KEY = 'jlpt-drill-note-practice:v2'
export const MOCK_DATABASE_STORAGE_KEY = 'jlpt-drill-note:mock-database:v2'

type StorageChangeListener = (event: StorageEvent) => void

interface SyncStateStorage extends StateStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => boolean
  removeItem: (key: string) => void
}

interface PersistedEnvelope {
  state: Record<string, unknown>
  version?: number
}

const localStorageCache = new Map<string, string | null>()
const sessionStorageCache = new Map<string, string | null>()
const storageChangeListeners = new Set<StorageChangeListener>()
const levelSet: ReadonlySet<string> = new Set(LEVELS)
const roleSet: ReadonlySet<string> = new Set(['USER', 'ADMIN'])
let isListening = false

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const parseEnvelope = (serialized: string | null): PersistedEnvelope | null => {
  if (!serialized) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!isRecord(parsed) || !isRecord(parsed.state)) {
      return null
    }

    return {
      state: parsed.state,
      version: typeof parsed.version === 'number' ? parsed.version : undefined
    }
  } catch {
    return null
  }
}

const isPersistedUser = (value: unknown): value is AuthenticatedUser => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.role === 'string' &&
    roleSet.has(value.role) &&
    (value.targetLevel === null ||
      (typeof value.targetLevel === 'string' &&
        levelSet.has(value.targetLevel)))
  )
}

const isValidPersistedAuth = (
  value: unknown
): value is AuthenticatedUser | null => {
  return value === null || isPersistedUser(value)
}

const canUseWindow = (): boolean => typeof window !== 'undefined'

const readStorage = (
  storage: Storage | undefined,
  cache: Map<string, string | null>,
  key: string
): string | null => {
  if (cache.has(key)) {
    return cache.get(key) ?? null
  }

  if (!storage) {
    return null
  }

  try {
    const value = storage.getItem(key)
    cache.set(key, value)
    return value
  } catch {
    cache.set(key, null)
    return null
  }
}

const writeStorage = (
  storage: Storage | undefined,
  cache: Map<string, string | null>,
  key: string,
  value: string
): boolean => {
  if (!storage) {
    cache.delete(key)
    return false
  }

  try {
    storage.setItem(key, value)
    cache.set(key, value)
    return true
  } catch {
    // 실패한 값을 cache hit으로 오인하지 않고 canonical 조회에 맡깁니다.
    cache.delete(key)
    return false
  }
}

const removeStorage = (
  storage: Storage | undefined,
  cache: Map<string, string | null>,
  key: string
): void => {
  try {
    storage?.removeItem(key)
  } catch {
    // 저장소 접근이 막혀도 현재 탭 상태 초기화는 계속 진행합니다.
  }
  cache.delete(key)
}

const getLocalStorage = (): Storage | undefined => {
  if (!canUseWindow()) {
    return undefined
  }

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const getSessionStorage = (): Storage | undefined => {
  if (!canUseWindow()) {
    return undefined
  }

  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

const handleStorageChange = (event: StorageEvent): void => {
  if (event.key) {
    localStorageCache.delete(event.key)
  } else {
    localStorageCache.clear()
  }

  for (const listener of storageChangeListeners) {
    listener(event)
  }
}

const startStorageListener = (): void => {
  if (!canUseWindow() || isListening) {
    return
  }

  window.addEventListener('storage', handleStorageChange)
  isListening = true
}

const stopStorageListener = (): void => {
  if (!canUseWindow() || !isListening || storageChangeListeners.size > 0) {
    return
  }

  window.removeEventListener('storage', handleStorageChange)
  isListening = false
}

export const subscribeStorageChanges = (
  listener: StorageChangeListener
): (() => void) => {
  storageChangeListeners.add(listener)
  startStorageListener()

  return () => {
    storageChangeListeners.delete(listener)
    stopStorageListener()
  }
}

export const cachedStorage: SyncStateStorage = {
  getItem: (key): string | null =>
    readStorage(getLocalStorage(), localStorageCache, key),
  setItem: (key, value): boolean => {
    return writeStorage(getLocalStorage(), localStorageCache, key, value)
  },
  removeItem: (key): void => {
    removeStorage(getLocalStorage(), localStorageCache, key)
  }
}

export const cachedSessionStorage: SyncStateStorage = {
  getItem: (key): string | null =>
    readStorage(getSessionStorage(), sessionStorageCache, key),
  setItem: (key, value): boolean => {
    return writeStorage(getSessionStorage(), sessionStorageCache, key, value)
  },
  removeItem: (key): void => {
    removeStorage(getSessionStorage(), sessionStorageCache, key)
  }
}

const serializeEnvelope = (
  state: Record<string, unknown>,
  version: number | undefined
): string => JSON.stringify({ state, version })

export const createSplitAppStateStorage = (
  authStorage: SyncStateStorage,
  practiceStorage: SyncStateStorage
): SyncStateStorage => ({
  getItem: (key): string | null => {
    const authEnvelope = parseEnvelope(authStorage.getItem(key))

    if (authEnvelope && (authEnvelope.version ?? 0) < 2) {
      return serializeEnvelope(authEnvelope.state, authEnvelope.version)
    }

    const hasCompleteV2Auth =
      Boolean(authEnvelope) &&
      (authEnvelope?.version ?? 0) >= 2 &&
      Object.hasOwn(authEnvelope?.state ?? {}, 'currentUser') &&
      isValidPersistedAuth(authEnvelope?.state.currentUser)

    if (!hasCompleteV2Auth || !authEnvelope) {
      practiceStorage.removeItem(PRACTICE_STORE_KEY)
      return null
    }

    const practiceEnvelope = parseEnvelope(
      practiceStorage.getItem(PRACTICE_STORE_KEY)
    )

    return serializeEnvelope(
      {
        ...authEnvelope.state,
        ...(practiceEnvelope?.state ?? {})
      },
      2
    )
  },
  setItem: (key, value): boolean => {
    const envelope = parseEnvelope(value)
    if (!envelope) {
      authStorage.removeItem(key)
      practiceStorage.removeItem(PRACTICE_STORE_KEY)
      return false
    }

    const previousAuth = authStorage.getItem(key)
    const previousPractice = practiceStorage.getItem(PRACTICE_STORE_KEY)
    const {
      currentUser,
      sessionId,
      currentQuestionIndex,
      selectedAnswers,
      startedAt,
      pendingBookmarkIds
    } = envelope.state

    const authWritten = authStorage.setItem(
      key,
      serializeEnvelope({ currentUser }, envelope.version)
    )
    const practiceWritten = practiceStorage.setItem(
      PRACTICE_STORE_KEY,
      serializeEnvelope(
        {
          sessionId,
          currentQuestionIndex,
          selectedAnswers,
          startedAt,
          pendingBookmarkIds
        },
        envelope.version
      )
    )

    if (authWritten && practiceWritten) {
      return true
    }

    if (previousAuth === null) {
      authStorage.removeItem(key)
    } else {
      authStorage.setItem(key, previousAuth)
    }
    if (previousPractice === null) {
      practiceStorage.removeItem(PRACTICE_STORE_KEY)
    } else {
      practiceStorage.setItem(PRACTICE_STORE_KEY, previousPractice)
    }
    return false
  },
  removeItem: (key): void => {
    authStorage.removeItem(key)
    practiceStorage.removeItem(PRACTICE_STORE_KEY)
  }
})

export const splitAppStateStorage = createSplitAppStateStorage(
  cachedStorage,
  cachedSessionStorage
)

export const clearStorageCache = (): void => {
  localStorageCache.clear()
  sessionStorageCache.clear()
}
