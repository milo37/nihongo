import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Set the returned flag after a seek; the next render then shows the reading
 * word if it is off screen.
 */
export const useRevealReadingWord = (
  passageRef: RefObject<HTMLElement | null>
): RefObject<boolean> => {
  const revealRef = useRef(false)
  // #1183: after a drag or key move, show the reading word once if it is off
  // screen (or under the fixed action bar). No follow while it plays.
  useEffect(() => {
    if (!revealRef.current) return
    revealRef.current = false
    const word = passageRef.current?.querySelector('.study-read-mark')
    if (!word) return
    const box = word.getBoundingClientRect()
    const seen = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    )
    if (seen && word.contains(seen)) return
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches
    word.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center'
    })
  })
  return revealRef
}
