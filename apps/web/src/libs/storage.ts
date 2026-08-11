import type { StateStorage } from 'zustand/middleware'

const storageCache = new Map<string, string | null>()
let isListening = false

const canUseStorage = (): boolean => {
  return (
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  )
}

const ensureStorageListener = (): void => {
  if (!canUseStorage() || isListening) {
    return
  }

  window.addEventListener('storage', (event) => {
    if (event.key) {
      storageCache.delete(event.key)
      return
    }

    storageCache.clear()
  })
  isListening = true
}

export const cachedStorage: StateStorage = {
  getItem: (key): string | null => {
    ensureStorageListener()
    if (storageCache.has(key)) {
      return storageCache.get(key) ?? null
    }

    if (!canUseStorage()) {
      return null
    }

    const value = window.localStorage.getItem(key)
    storageCache.set(key, value)
    return value
  },
  setItem: (key, value): void => {
    if (canUseStorage()) {
      window.localStorage.setItem(key, value)
    }
    storageCache.set(key, value)
  },
  removeItem: (key): void => {
    if (canUseStorage()) {
      window.localStorage.removeItem(key)
    }
    storageCache.delete(key)
  }
}

export const clearStorageCache = (): void => {
  storageCache.clear()
}
