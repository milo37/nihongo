import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
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

/**
 * #1154 M-2f: this month's stamps, right under the goal row. The big spot
 * is today only: Maru's stamp once today's goal is met, else a dashed
 * empty ring. The month calendar opens under a button on phones and is
 * always open from 1024px (CSS). Days are Asia/Seoul days, as the server
 * stamps them; the count is only in the calendar's spoken name.
 */
export const StampBoard = ({
  userId
}: {
  userId: string
}): ReactElement | null => {
  const { t } = useTranslation('account')
  const goal = useStudyGoal(userId)
  const [open, setOpen] = useState(false)
  const calendarId = useId()
  if (goal === null) return null
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
      {/* Nothing to look back on in an empty month. */}
      {stamped.size > 0 ? (
        <button
          className="stamp-board-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={calendarId}
          onClick={() => setOpen(!open)}
        >
          {t(open ? 'stampBoard.close' : 'stampBoard.open')}
          <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button>
      ) : null}
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
        {Array.from({ length: days }, (_, index) => {
          const date = index + 1
          const state =
            date === day ? ' is-today' : date > day ? ' is-later' : ''
          return (
            <span
              key={date}
              className={`stamp-board-day${state}`}
              style={date === 1 ? { gridColumnStart: lead + 1 } : undefined}
            >
              <b>{date}</b>
              {stamped.has(date) ? <Stamp day={date} /> : null}
            </span>
          )
        })}
      </div>
    </section>
  )
}
