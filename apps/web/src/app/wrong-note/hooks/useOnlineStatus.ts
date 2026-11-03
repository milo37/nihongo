import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const getSnapshot = (): boolean => navigator.onLine !== false

export const useOnlineStatus = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => true)
