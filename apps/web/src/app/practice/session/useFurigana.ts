import { useSyncExternalStore } from 'react'
import { cachedStorage } from '@nihongo/browser/libs/storage'

const FURIGANA_KEY = 'harumaru:furigana:v1'

// #1182: off by default and kept on this device only. Held in memory too,
// so a browser that blocks storage keeps the choice until the page reloads.
let isOn: boolean | undefined
const listeners = new Set<() => void>()

const read = (): boolean =>
  (isOn ??= cachedStorage.getItem(FURIGANA_KEY) === '1')

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setFurigana = (on: boolean): void => {
  isOn = on
  cachedStorage.setItem(FURIGANA_KEY, on ? '1' : '0')
  for (const listener of listeners) listener()
}

/** Whether the passage furigana is turned on. */
export const useFurigana = (): boolean =>
  useSyncExternalStore(subscribe, read, () => false)

/** Tests only: forget the value read from storage. */
export const resetFuriganaForTest = (): void => {
  isOn = undefined
}
