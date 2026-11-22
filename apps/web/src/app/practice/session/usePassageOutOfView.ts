import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** True once the passage has scrolled fully out of view (one-column layout). */
export const usePassageOutOfView = (
  passageRef: RefObject<HTMLElement | null>,
  hasPassage: boolean
): boolean => {
  const [isOut, setOut] = useState(false)
  useEffect(() => {
    const passage = passageRef.current
    if (!hasPassage || !passage || typeof IntersectionObserver === 'undefined')
      return
    // Only scrolling counts: a push slide (JLP-870) moves the passage off
    // to the side, which is not scrolling past it.
    const observer = new IntersectionObserver(([entry]) => {
      const box = entry?.boundingClientRect
      const view = entry?.rootBounds
      setOut(
        box && view ? box.bottom <= view.top || box.top >= view.bottom : false
      )
    })
    observer.observe(passage)
    return () => {
      observer.disconnect()
      setOut(false)
    }
  }, [hasPassage, passageRef])
  return isOut
}
