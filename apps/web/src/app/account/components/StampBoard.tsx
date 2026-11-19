import { useId, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useStudyGoal } from '@app/login/queries/studyGoalQueries'

// Each stamp sits a little crooked, as if pressed by hand (design sc10).
const TILTS = [-5, 3, -2, 4, -4, 2, -3]

const Stamp = ({ day }: { day: number }): ReactElement => (
  <span
    className="maru-stamp"
    style={{ rotate: `${TILTS[day % 7]}deg` }}
    aria-hidden="true"
  />
)

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
const useFold = (): [boolean, () => void, RefObject<HTMLDivElement | null>] => {
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

/**
 * #1154 M-2f: this month's stamps, right under the goal row. The big spot
 * is today only: Maru's stamp once today's goal is met, else a dashed
 * empty ring. Phones show this week's row of the calendar (F1); the ⌄
 * unfolds the other weeks around it. From 1024px the whole month is always
 * there (CSS). Days are Asia/Seoul days, as the server stamps them; the
 * count is only in the calendar's spoken name.
 */
export const StampBoard = ({
  userId
}: {
  userId: string
}): ReactElement | null => {
  const { t } = useTranslation('account')
  const goal = useStudyGoal(userId)
  const [open, toggle, monthRef] = useFold()
  const calendarId = useId()
  // A3: no board without a goal; set one again and the month shows again.
  if (goal?.dailyGoal == null) return null
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Seoul'
  })
  const [year, month, day] = today.split('-').map(Number)
  const stamped = new Set(
    goal.monthStampDates
      .filter((date) => date.startsWith(today.slice(0, 8)))
      .map((date) => Number(date.slice(8)))
  )
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const weekOf = (date: number): number => Math.floor((lead + date - 1) / 7)
  const weeks = Array.from({ length: weekOf(days) + 1 }, (_, week) =>
    Array.from({ length: days }, (_, index) => index + 1).filter(
      (date) => weekOf(date) === week
    )
  )
  return (
    <section className="stamp-board" aria-labelledby={`${calendarId}-title`}>
      <div className="stamp-board-head">
        <h2 id={`${calendarId}-title`} className="stamp-board-title">
          {t('stampBoard.title', { month })}
        </h2>
        <p className="stamp-board-note">{t('stampBoard.note')}</p>
      </div>
      <div
        className="stamp-board-today"
        role="img"
        aria-label={t(
          stamped.has(day) ? 'stampBoard.stamped' : 'stampBoard.waiting'
        )}
      >
        {stamped.has(day) ? <Stamp day={day} /> : null}
      </div>
      <div ref={monthRef} className="stamp-board-month">
        <div
          id={calendarId}
          className={`stamp-board-calendar${open ? ' is-open' : ''}${
            lead + days > 35 ? ' is-six-rows' : ''
          }`}
          role="img"
          aria-label={t('stampBoard.calendar', { month, stamps: stamped.size })}
        >
          {[...t('stampBoard.weekdays')].map((weekday) => (
            <span key={weekday} className="stamp-board-weekday">
              {weekday}
            </span>
          ))}
          <div className="stamp-board-weeks">
            {weeks.map((week, index) => (
              <div
                key={week[0]}
                className={`stamp-board-week${
                  index === weekOf(day) ? ' is-current' : ''
                }`}
              >
                <div>
                  {week.map((date) => {
                    const state =
                      date === day ? ' is-today' : date > day ? ' is-later' : ''
                    return (
                      <span
                        key={date}
                        className={`stamp-board-day${state}`}
                        style={
                          date === 1 ? { gridColumnStart: lead + 1 } : undefined
                        }
                      >
                        <b>{date}</b>
                        {stamped.has(date) ? <Stamp day={date} /> : null}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Nothing to look back on in an empty month. Folded, the button
            reaches over the weekdays and this week too (CSS). */}
        {stamped.size > 0 ? (
          <button
            className="stamp-board-toggle"
            type="button"
            aria-expanded={open}
            aria-controls={calendarId}
            aria-label={t(open ? 'stampBoard.close' : 'stampBoard.open', {
              month
            })}
            onClick={toggle}
          >
            <Icon name="chevron-right" className="stamp-board-chevron" />
          </button>
        ) : null}
      </div>
    </section>
  )
}
