import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { RefObject } from 'react'

const weeksOf = (month: HTMLElement): HTMLElement[] => [
  ...month.querySelectorAll<HTMLElement>('.stamp-board-week')
]
const currentOf = (weeks: HTMLElement[]): number =>
  weeks.findIndex((week) => week.classList.contains('is-current'))
const topOf = (element: HTMLElement): number =>
  element.getBoundingClientRect().top

/**
 * #1155 F1: the phone's fold, played as FLIP with transform and opacity
 * only (design fold-1155 README). Opening, this week slides from its
 * folded place to its own row with the weeks above it, which come out
 * from under the weekdays, while the weeks below come up from 8px; all
 * fade in and the board's height eases once. Folding plays the same backwards on the open month, then folds.
 * 0.25s ease-out open, 0.2s ease-in fold; reduced motion (or no Web
 * Animations, as in tests) switches at once.
 */
export const useStampBoardFold = (): [
  boolean,
  () => void,
  RefObject<HTMLDivElement | null>
] => {
  const [open, setOpen] = useState(false)
  const monthRef = useRef<HTMLDivElement>(null)
  const from = useRef<{ height: number; top: number } | null>(null)
  const playing = useRef(false)

  const play = (
    month: HTMLElement,
    height: [number, number],
    shift: [number, number],
    opening: boolean
  ): Promise<unknown> => {
    const timing: KeyframeAnimationOptions = {
      duration: opening ? 250 : 200,
      easing: opening ? 'ease-out' : 'ease-in',
      fill: 'both'
    }
    const weeks = weeksOf(month)
    const current = currentOf(weeks)
    // The weeks above come out from under the weekdays, so clip the weeks.
    const clipped = [month, weeks[0].parentElement ?? month]
    for (const element of clipped) element.style.overflow = 'hidden'
    const animations = [
      month.animate(
        [{ height: `${height[0]}px` }, { height: `${height[1]}px` }],
        timing
      ),
      ...weeks.map((week, index) => {
        if (index === current)
          return week.animate(
            [
              { transform: `translateY(${shift[0]}px)` },
              { transform: `translateY(${shift[1]}px)` }
            ],
            timing
          )
        // Above: moves with this week, as one block (shift runs from start
        // to end either way). Below: up from 8px, played back to fold.
        if (index < current)
          return week.animate(
            [
              {
                opacity: opening ? 0 : 1,
                transform: `translateY(${shift[0]}px)`
              },
              // Folding, gone by 70% so nothing shows through this week.
              ...(opening ? [] : [{ opacity: 0, offset: 0.7 }]),
              {
                opacity: opening ? 1 : 0,
                transform: `translateY(${shift[1]}px)`
              }
            ],
            timing
          )
        const frames = [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' }
        ]
        return week.animate(opening ? frames : frames.reverse(), timing)
      })
    ]
    playing.current = true
    return Promise.all(animations.map((animation) => animation.finished))
      .catch(() => undefined)
      .then(() => {
        playing.current = false
        // Fold before letting go, so the last frame is the folded layout.
        if (!opening) flushSync(() => setOpen(false))
        for (const element of clipped) element.style.overflow = ''
        for (const animation of animations) animation.cancel()
      })
  }

  useLayoutEffect(() => {
    const month = monthRef.current
    const before = from.current
    from.current = null
    if (!open || !month || !before) return
    const weeks = weeksOf(month)
    void play(
      month,
      [before.height, month.offsetHeight],
      [before.top - topOf(weeks[currentOf(weeks)]), 0],
      true
    )
  }, [open])

  const toggle = (): void => {
    const month = monthRef.current
    if (
      !month ||
      typeof month.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setOpen(!open)
      return
    }
    if (playing.current) return
    const weeks = weeksOf(month)
    const current = weeks[currentOf(weeks)]
    if (!open) {
      from.current = { height: month.offsetHeight, top: topOf(current) }
      setOpen(true)
      return
    }
    // Folded, this week sits where the first week is and the board is
    // shorter by every other week.
    void play(
      month,
      [
        month.offsetHeight,
        month.offsetHeight - (weeks.length - 1) * current.offsetHeight
      ],
      [0, topOf(weeks[0]) - topOf(current)],
      false
    )
  }

  return [open, toggle, monthRef]
}
