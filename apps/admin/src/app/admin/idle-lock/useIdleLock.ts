import { useEffect, useRef, useState } from 'react'

export const IDLE_LOCK_MS = 15 * 60_000

const activityEvents = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart'
] as const

export const useIdleLock = (timeoutMs = IDLE_LOCK_MS) => {
  const [locked, setLocked] = useState(false)
  const lastActivity = useRef(0)

  useEffect(() => {
    if (locked) return
    lastActivity.current = Date.now()
    let timer = window.setTimeout(() => setLocked(true), timeoutMs)
    const onActivity = (): void => {
      lastActivity.current = Date.now()
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setLocked(true), timeoutMs)
    }
    // Background tabs throttle timers, so re-check elapsed time on return.
    const onVisible = (): void => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastActivity.current >= timeoutMs
      )
        setLocked(true)
    }
    activityEvents.forEach((name) =>
      window.addEventListener(name, onActivity, { passive: true })
    )
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      activityEvents.forEach((name) =>
        window.removeEventListener(name, onActivity)
      )
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [locked, timeoutMs])

  return { locked, unlock: () => setLocked(false) }
}
