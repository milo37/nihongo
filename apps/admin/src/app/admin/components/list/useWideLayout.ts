import { useSyncExternalStore } from 'react'

// Tailwind `md`: tables and filter chips from here, cards and a sheet below.
const WIDE_QUERY = '(min-width: 768px)'

const media = (): MediaQueryList | undefined =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_QUERY)
    : undefined

const subscribe = (onChange: () => void): (() => void) => {
  const query = media()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** One layout is mounted at a time so controls are never duplicated. */
export const useWideLayout = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? true,
    () => true
  )
