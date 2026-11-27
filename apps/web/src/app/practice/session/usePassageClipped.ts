import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/** #986: whether a folded passage runs past its three lines. */
export const usePassageClipped = (
  textRef: RefObject<HTMLDivElement | null>,
  isFolded: boolean,
  isFuriganaOn: boolean
): boolean => {
  // A passage that fits in three lines has nothing to open.
  const [isClipped, setClipped] = useState(true)
  useLayoutEffect(() => {
    const text = textRef.current
    if (!isFolded || !text || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      if (text.clientHeight > 0)
        setClipped(text.scrollHeight > text.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(text)
    return () => observer.disconnect()
  }, [isFolded, isFuriganaOn, textRef])
  return isClipped
}
