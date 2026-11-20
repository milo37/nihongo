import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useStudyGoal } from '@app/login/queries/studyGoalQueries'
import { useStampBoardFold } from '@app/account/hooks/useStampBoardFold'

// Each stamp sits a little crooked, as if pressed by hand (design sc10).
const TILTS = [-5, 3, -2, 4, -4, 2, -3]

const Stamp = ({ day }: { day: number }): ReactElement => (
  <span
    className="maru-stamp"
    style={{ rotate: `${TILTS[day % 7]}deg` }}
    aria-hidden="true"
  />
)

/**
 * #1154 M-2f: this month's stamps, right under the goal row. The big spot
 * is today only: Maru's stamp once today's goal is met, else a dashed
 * empty ring. Phones show this week's row of the calendar (F1); the ⌄
 * unfolds the other weeks around it. From 1024px the whole month is always
 * there (CSS). Days are Asia/Seoul days, as the server stamps them; the
 * count is only in the calendar's spoken name.
 */
export const StampBoard = ({
  userId,
  action
}: {
  userId: string
  /** #1055: the omikuji button, at the head's right end. */
  action?: ReactNode
}): ReactElement | null => {
  const { t } = useTranslation('account')
  const goal = useStudyGoal(userId)
  const [open, toggle, monthRef] = useStampBoardFold()
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
        {action}
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
