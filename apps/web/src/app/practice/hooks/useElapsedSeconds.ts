import { useEffect, useState } from 'react'

export const useElapsedSeconds = (startedAt: string | null): number => {
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) {
      return
    }

    const timerId = window.setInterval(() => setCurrentTime(Date.now()), 1000)
    return () => window.clearInterval(timerId)
  }, [startedAt])

  if (!startedAt) {
    return 0
  }

  return Math.max(
    0,
    Math.floor((currentTime - new Date(startedAt).getTime()) / 1000)
  )
}
